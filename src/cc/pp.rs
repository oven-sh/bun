//! The C preprocessor (C11 6.10): a token -> token stage between the lexer and the parser.
//!
//! Macro expansion works the way GCC's does, because real code depends on its exact
//! behaviour: each expansion is a context on a stack, a macro is disabled while its context
//! is on the stack, and an identifier that names a disabled macro when it is read is
//! marked "do not expand" for good (C11 6.10.3.4p2). This file holds the token plumbing,
//! macro definitions and expansion; `pp_directive.rs` handles directives and `#include`,
//! `pp_expr.rs` evaluates `#if`.

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;

use crate::lexer::Lexer;
use crate::token::{Loc, PpKind, PpToken, Punct, Res, TokenSource, display_bytes, err};
use crate::types::Target;

/// One entry of the file table: a file that contributed tokens, or the name `#line` gave to
/// part of one.
pub(crate) struct SourceFile {
    pub(crate) name: Rc<str>,
    pub(crate) contents: Rc<[u8]>,
    /// The entry whose contents these are, under the name it was read by: itself, except for
    /// an entry `#line` made.
    pub(crate) read_as: u32,
    /// Where the `#include` that brought the file in is.
    pub(crate) included_at: Option<Loc>,
}

/// Every file that contributed tokens; `Loc::file` indexes it.
#[derive(Default)]
pub(crate) struct FileTable {
    pub(crate) files: Vec<SourceFile>,
    /// Non-fatal diagnostics (`#warning`), in source order.
    pub(crate) warnings: Vec<(Loc, String)>,
    /// `#pragma comment(lib, "name")`, in source order without duplicates.
    pub(crate) libraries: Vec<String>,
    /// The files read from disk that were not found in a system include directory.
    pub(crate) read: Vec<String>,
}

impl FileTable {
    pub(crate) fn add(&mut self, name: &str, contents: Rc<[u8]>, included_at: Option<Loc>) -> u32 {
        let id = self.files.len() as u32;
        self.files.push(SourceFile {
            name: Rc::from(name),
            contents,
            read_as: id,
            included_at,
        });
        id
    }

    /// `#line` in `file` names what follows `name`.
    pub(crate) fn add_presumed(&mut self, name: &str, file: u32) -> u32 {
        let Some(read) = self.files.get(file as usize) else {
            return file;
        };
        let presumed = SourceFile {
            name: Rc::from(name),
            contents: Rc::clone(&read.contents),
            read_as: read.read_as,
            included_at: read.included_at,
        };
        self.files.push(presumed);
        (self.files.len() - 1) as u32
    }

    pub(crate) fn name(&self, id: u32) -> &str {
        self.files
            .get(id as usize)
            .map_or("<unknown>", |file| &*file.name)
    }
}

/// Maximum nesting of `#include`.
pub(crate) const MAX_INCLUDE_DEPTH: usize = 200;
/// Maximum nesting of macro-argument pre-expansion.
const MAX_EXPANSION_DEPTH: u32 = 400;
/// Tokens macro expansion may produce in one translation unit before it is declared runaway.
const MAX_EXPANDED_TOKENS: u64 = 10_000_000;
/// Maximum depth of the expansion context stack.
const MAX_CONTEXTS: usize = 20_000;

/// A preprocessing token plus its macro-expansion state.
#[derive(Clone)]
pub(crate) struct PTok {
    pub(crate) tok: PpToken,
    /// The identifier named a macro that was being expanded when it was read; it is never
    /// expanded afterwards.
    pub(crate) no_expand: bool,
    /// The white space in front of the token is that of the macro name or parameter it
    /// replaced, not its own. (A header name glued from tokens only has the latter.)
    pub(crate) inherited_space: bool,
}

impl PTok {
    pub(crate) fn plain(tok: PpToken) -> PTok {
        PTok {
            tok,
            no_expand: false,
            inherited_space: false,
        }
    }

    /// The token as it takes part in a header name built by macros.
    pub(crate) fn for_header_name(mut self) -> PpToken {
        if self.inherited_space {
            self.tok.has_leading_space = false;
        }
        self.tok
    }

    pub(crate) fn is_punct(&self, p: Punct) -> bool {
        self.tok.kind == PpKind::Punct(p)
    }

    pub(crate) fn ident(&self) -> Option<&[u8]> {
        if self.tok.kind == PpKind::Ident {
            Some(&self.tok.text)
        } else {
            None
        }
    }

    pub(crate) fn is_eof(&self) -> bool {
        self.tok.kind == PpKind::Eof
    }
}

/// Tokens waiting to be read: the result of a macro expansion, or an isolated token list.
struct Context {
    tokens: Vec<PTok>,
    pos: usize,
    /// The macro whose expansion this is; it stays disabled until the context is used up.
    macro_name: Option<Rc<str>>,
    /// Ends in an end-of-file token that is returned forever (an isolated list).
    sticky_eof: bool,
}

/// The spelling of a token as source text.
pub(crate) fn spelling(tok: &PpToken) -> &[u8] {
    match tok.kind {
        PpKind::Punct(p) => p.spelling().as_bytes(),
        // Printed by `preprocess` with `#pragma ` in front, on a line of its own.
        _ => &tok.text,
    }
}

// ───────────────────────────── macros ─────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Builtin {
    File,
    Line,
    Counter,
    IncludeLevel,
    BaseFile,
    Date,
    Time,
    /// `__TIMESTAMP__`: a date and time, as `asctime` writes them.
    Timestamp,
}

pub(crate) struct Macro {
    pub(crate) name: Rc<str>,
    /// `None` for an object-like macro.
    pub(crate) params: Option<Vec<Rc<str>>>,
    /// Name of the parameter that receives the variable arguments (`__VA_ARGS__` or a GNU
    /// named one); it is the last entry of `params`.
    pub(crate) variadic: bool,
    pub(crate) body: Vec<PpToken>,
    pub(crate) builtin: Option<Builtin>,
}

impl Macro {
    fn param_index(&self, tok: &PpToken) -> Option<usize> {
        if tok.kind != PpKind::Ident {
            return None;
        }
        let params = self.params.as_ref()?;
        let mut i = 0;
        while i < params.len() {
            if params[i].as_bytes() == tok.text.as_slice() {
                return Some(i);
            }
            i += 1;
        }
        None
    }

    /// Two definitions are compatible when the parameters match and the replacement lists
    /// have the same tokens with the same whitespace separation (C11 6.10.3p2).
    pub(crate) fn same_definition(&self, other: &Macro) -> bool {
        if self.params != other.params
            || self.variadic != other.variadic
            || self.body.len() != other.body.len()
        {
            return false;
        }
        for (i, (a, b)) in self.body.iter().zip(&other.body).enumerate() {
            if a.kind != b.kind || spelling(a) != spelling(b) {
                return false;
            }
            if i > 0 && a.has_leading_space != b.has_leading_space {
                return false;
            }
        }
        true
    }
}

/// One file being read.
pub(crate) struct Frame {
    pub(crate) lexer: Lexer,
    /// A token read ahead while collecting a directive's line.
    pub(crate) peeked: Option<PpToken>,
    pub(crate) path: Rc<str>,
    /// Index in the search path where this file was found, for `#include_next`.
    pub(crate) found_at: Option<usize>,
    pub(crate) conds: Vec<Cond>,
    /// `#line` adjustments: added to physical line numbers, and an optional presumed file.
    pub(crate) line_delta: i64,
    pub(crate) presumed_file: Option<u32>,
}

pub(crate) struct Cond {
    pub(crate) loc: Loc,
    /// The enclosing group is being processed.
    pub(crate) parent_active: bool,
    /// Some branch of this `#if` chain has already been taken.
    pub(crate) taken: bool,
    /// The current branch is being processed.
    pub(crate) active: bool,
    pub(crate) seen_else: bool,
}

#[derive(Clone)]
pub(crate) enum SearchDir {
    Dir(Rc<str>),
    /// The compiler's own headers, embedded in the binary.
    Builtin,
}

pub(crate) struct Preprocessor {
    pub(crate) files: Rc<RefCell<FileTable>>,
    pub(crate) target: Target,
    /// Microsoft C: a Windows target with no GNU C version claimed.
    pub(crate) msvc: bool,
    pub(crate) macros: BTreeMap<Rc<str>, Rc<Macro>>,
    pub(crate) frames: Vec<Frame>,
    /// Macro expansions in progress, innermost last.
    contexts: Vec<Context>,
    /// Macros whose expansion is on `contexts`.
    disabled: BTreeSet<Rc<str>>,
    depth: u32,
    expanded_tokens: u64,
    pub(crate) counter: u64,
    /// `<...>` search path; `"..."` additionally looks next to the including file first.
    pub(crate) search: Vec<SearchDir>,
    pub(crate) pragma_once: BTreeSet<Rc<str>>,
    /// `#pragma push_macro("name")`: the definitions saved for each name, oldest first
    /// (`None`: the name was not a macro).
    pub(crate) pushed_macros: BTreeMap<Rc<str>, Vec<Option<Rc<Macro>>>>,
    /// A pragma for the parser, to be delivered as the next token.
    pub(crate) pending_pragma: Option<PpToken>,
    pub(crate) file_cache: BTreeMap<Rc<str>, Option<Rc<[u8]>>>,
    pub(crate) base_file: Rc<str>,
    /// Seconds since the Unix epoch for `__DATE__`/`__TIME__`.
    pub(crate) now: u64,
}

impl Preprocessor {
    pub(crate) fn new(
        files: Rc<RefCell<FileTable>>,
        target: Target,
        search: Vec<SearchDir>,
        base_file: &str,
    ) -> Preprocessor {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_secs());
        Preprocessor {
            files,
            target,
            msvc: false,
            macros: BTreeMap::new(),
            frames: Vec::new(),
            contexts: Vec::new(),
            disabled: BTreeSet::new(),
            depth: 0,
            expanded_tokens: 0,
            counter: 0,
            search,
            pragma_once: BTreeSet::new(),
            pushed_macros: BTreeMap::new(),
            pending_pragma: None,
            file_cache: BTreeMap::new(),
            base_file: Rc::from(base_file),
            now,
        }
    }

    /// Starts reading `source` as the file `path`.
    pub(crate) fn push_source(
        &mut self,
        path: &str,
        source: Rc<[u8]>,
        found_at: Option<usize>,
        included_at: Option<Loc>,
    ) {
        let file = self
            .files
            .borrow_mut()
            .add(path, Rc::clone(&source), included_at);
        self.frames.push(Frame {
            lexer: Lexer::new(source, file),
            peeked: None,
            path: Rc::from(path),
            found_at,
            conds: Vec::new(),
            line_delta: 0,
            presumed_file: None,
        });
    }

    pub(crate) fn is_defined(&self, name: &[u8]) -> bool {
        match std::str::from_utf8(name) {
            Ok(s) => self.macros.contains_key(s) || is_pp_operator(name),
            Err(_) => false,
        }
    }

    // ───────────────────────────── token plumbing ─────────────────────────────

    pub(crate) fn unread(&mut self, tok: PTok) {
        self.contexts.push(Context {
            tokens: vec![tok],
            pos: 0,
            macro_name: None,
            sticky_eof: false,
        });
    }

    fn pop_context(&mut self) {
        if let Some(context) = self.contexts.pop() {
            if let Some(name) = context.macro_name {
                self.disabled.remove(&name);
            }
        }
    }

    /// The next token before macro expansion: from the innermost unfinished context, else
    /// the next from the file stack (directives are processed on the way).
    pub(crate) fn next_raw(&mut self) -> Res<PTok> {
        let mut tok = loop {
            let Some(context) = self.contexts.last_mut() else {
                break self.next_from_files()?;
            };
            match context.tokens.get(context.pos) {
                Some(t) => {
                    let t = t.clone();
                    if !(context.sticky_eof && t.is_eof()) {
                        context.pos += 1;
                    }
                    break t;
                }
                // A finished expansion re-enables its macro.
                None => self.pop_context(),
            }
        };
        if let Some(name) = tok.ident() {
            if std::str::from_utf8(name).is_ok_and(|n| self.disabled.contains(n)) {
                tok.no_expand = true;
            }
        }
        Ok(tok)
    }

    /// Runs `f` with `tokens` as the only input.
    pub(crate) fn with_isolated_input<T>(
        &mut self,
        mut tokens: Vec<PTok>,
        f: impl FnOnce(&mut Self) -> Res<T>,
    ) -> Res<T> {
        tokens.push(PTok::plain(eof_token(Loc::default())));
        let depth = self.contexts.len();
        self.contexts.push(Context {
            tokens,
            pos: 0,
            macro_name: None,
            sticky_eof: true,
        });
        let result = f(self);
        while self.contexts.len() > depth {
            self.pop_context();
        }
        result
    }

    /// Fully macro-expands a token list on its own (a macro argument).
    fn expand_list(&mut self, tokens: Vec<PTok>, loc: Loc) -> Res<Vec<PTok>> {
        self.depth += 1;
        if self.depth > MAX_EXPANSION_DEPTH {
            return err(loc, "macro expansion is nested too deeply");
        }
        let result = self.with_isolated_input(tokens, |pp| {
            let mut out = Vec::new();
            loop {
                let t = pp.next_expanded()?;
                if t.is_eof() {
                    return Ok(out);
                }
                out.push(t);
            }
        });
        self.depth -= 1;
        result
    }

    /// The next token after macro expansion.
    pub(crate) fn next_expanded(&mut self) -> Res<PTok> {
        loop {
            let t = self.next_raw()?;
            let Some(name) = t.ident() else { return Ok(t) };
            let microsoft_pragma =
                name == b"__pragma" && self.target.os == crate::types::Os::Windows;
            if name == b"_Pragma" || microsoft_pragma {
                if self.pragma_operator(t.tok.loc, microsoft_pragma)? {
                    if let Some(pragma) = self.pending_pragma.take() {
                        return Ok(PTok::plain(pragma));
                    }
                    continue;
                }
                return Ok(t);
            }
            let Ok(name) = std::str::from_utf8(name) else {
                return Ok(t);
            };
            let Some(mac) = self.macros.get(name).cloned() else {
                return Ok(t);
            };
            if t.no_expand {
                return Ok(t);
            }
            if let Some(builtin) = mac.builtin {
                let replacement = self.builtin_value(builtin, &t.tok);
                return Ok(PTok::plain(replacement));
            }
            if mac.params.is_none() {
                let body = self.substitute(&mac, &[], &t)?;
                self.push_expansion(&mac, body, t.tok.loc)?;
                continue;
            }
            // A function-like macro name is only an invocation if `(` follows.
            let next = self.next_raw()?;
            if !next.is_punct(Punct::LParen) {
                self.unread(next);
                return Ok(t);
            }
            let args = self.collect_args(&mac, &t)?;
            let body = self.substitute(&mac, &args, &t)?;
            self.push_expansion(&mac, body, t.tok.loc)?;
        }
    }

    fn push_expansion(&mut self, mac: &Macro, body: Vec<PTok>, loc: Loc) -> Res<()> {
        self.expanded_tokens += body.len() as u64 + 1;
        if self.expanded_tokens > MAX_EXPANDED_TOKENS {
            return err(loc, "macro expansion produces too many tokens");
        }
        if self.contexts.len() > MAX_CONTEXTS {
            return err(loc, "macro expansion is nested too deeply");
        }
        self.disabled.insert(Rc::clone(&mac.name));
        self.contexts.push(Context {
            tokens: body,
            pos: 0,
            macro_name: Some(Rc::clone(&mac.name)),
            sticky_eof: false,
        });
        Ok(())
    }

    /// `_Pragma("...")`: the string is destringized and handled like a `#pragma` line.
    /// Microsoft's `__pragma(...)` has the line itself between the parentheses.
    /// Returns false if this is not the operator.
    fn pragma_operator(&mut self, loc: Loc, microsoft: bool) -> Res<bool> {
        let open = self.next_raw()?;
        if !open.is_punct(Punct::LParen) {
            self.unread(open);
            return Ok(false);
        }
        let mut operand: Vec<PpToken> = Vec::new();
        let mut depth = 1;
        loop {
            let t = self.next_raw()?;
            if t.is_eof() {
                return err(open.tok.loc, "unterminated _Pragma");
            }
            if t.is_punct(Punct::LParen) {
                depth += 1;
            } else if t.is_punct(Punct::RParen) {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            operand.push(t.tok);
        }
        if microsoft {
            for t in &mut operand {
                t.loc = loc;
            }
            self.pragma(&operand, loc);
            return Ok(true);
        }
        let [literal] = operand.as_slice() else {
            return Ok(true);
        };
        if literal.kind != PpKind::StrLit {
            return Ok(true);
        }
        // Drop an encoding prefix and the quotes; `\"` and `\\` lose their backslash.
        let text = &literal.text;
        let Some(start) = (0..text.len()).find(|&i| text[i] == b'"') else {
            return Ok(true);
        };
        let inner = &text[start + 1..text.len().saturating_sub(1).max(start + 1)];
        let mut source = Vec::with_capacity(inner.len());
        let mut i = 0;
        while i < inner.len() {
            if inner[i] == b'\\' && matches!(inner.get(i + 1), Some(b'"' | b'\\')) {
                i += 1;
            }
            source.push(inner[i]);
            i += 1;
        }
        let mut lexer = crate::lexer::Lexer::new(Rc::from(source), loc.file);
        let mut line = Vec::new();
        loop {
            let mut t = lexer.next_token()?;
            if t.kind == PpKind::Eof {
                break;
            }
            t.loc = loc;
            line.push(t);
        }
        self.pragma(&line, loc);
        Ok(true)
    }

    /// Collects the arguments of an invocation of `mac`; the opening parenthesis has been
    /// read. Returns the arguments and the closing parenthesis.
    fn collect_args(&mut self, mac: &Macro, name: &PTok) -> Res<Vec<Vec<PTok>>> {
        let params = mac.params.as_deref().unwrap_or(&[]);
        let mut args: Vec<Vec<PTok>> = vec![Vec::new()];
        let mut depth = 0u32;
        loop {
            let mut t = self.next_raw()?;
            if t.is_eof() {
                return err(
                    name.tok.loc,
                    format!("unterminated argument list invoking macro '{}'", mac.name),
                );
            }
            if t.is_punct(Punct::LParen) {
                depth += 1;
            } else if t.is_punct(Punct::RParen) {
                if depth == 0 {
                    break;
                }
                depth -= 1;
            } else if t.is_punct(Punct::Comma) && depth == 0 {
                // Commas stop separating once the variable arguments have started.
                let in_variadic = mac.variadic && args.len() == params.len();
                if !in_variadic {
                    args.push(Vec::new());
                    continue;
                }
            }
            // A line break inside an argument counts as a space.
            if t.tok.at_start_of_line {
                t.tok.at_start_of_line = false;
                t.tok.has_leading_space = true;
            }
            if let Some(last) = args.last_mut() {
                last.push(t);
            }
        }
        // `F()` is no arguments for a macro without parameters, one empty argument otherwise.
        if params.is_empty() && args.len() == 1 && args[0].is_empty() {
            args.clear();
        }
        // The variable arguments may be omitted entirely.
        if mac.variadic && args.len() + 1 == params.len() {
            args.push(Vec::new());
        }
        if args.len() != params.len() {
            return err(
                name.tok.loc,
                format!(
                    "macro '{}' requires {} arguments, but {} given",
                    mac.name,
                    params.len(),
                    args.len()
                ),
            );
        }
        Ok(args)
    }

    /// Builds the replacement of `mac` invoked by `invocation` with `args`.
    fn substitute(&mut self, mac: &Macro, args: &[Vec<PTok>], invocation: &PTok) -> Res<Vec<PTok>> {
        let mut expanded: Vec<Option<Vec<PTok>>> = vec![None; args.len()];
        let mut out =
            self.substitute_tokens(mac, &mac.body, args, &mut expanded, invocation.tok.loc)?;
        // The expansion takes the place of the macro name.
        if let Some(first) = out.first_mut() {
            first.tok.at_start_of_line = invocation.tok.at_start_of_line;
            first.tok.has_leading_space = invocation.tok.has_leading_space;
            first.inherited_space = true;
        }
        Ok(out)
    }

    /// If `body[i]` starts a `__VA_OPT__ ( ... )` group of a variadic macro, the index of
    /// its closing parenthesis.
    fn va_opt_group(mac: &Macro, body: &[PpToken], i: usize) -> Option<usize> {
        if !mac.variadic || body.get(i)?.kind != PpKind::Ident || body[i].text != b"__VA_OPT__" {
            return None;
        }
        if body.get(i + 1)?.kind != PpKind::Punct(Punct::LParen) {
            return None;
        }
        let mut depth = 0usize;
        for (j, t) in body.iter().enumerate().skip(i + 1) {
            match t.kind {
                PpKind::Punct(Punct::LParen) => depth += 1,
                PpKind::Punct(Punct::RParen) => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(j);
                    }
                }
                _ => {}
            }
        }
        None
    }

    /// The replacement of a `__VA_OPT__(...)` group whose contents are `body[open + 1..close]`:
    /// its substituted contents if the variable argument expands to any tokens, else nothing.
    fn substitute_va_opt(
        &mut self,
        mac: &Macro,
        contents: &[PpToken],
        args: &[Vec<PTok>],
        expanded: &mut Vec<Option<Vec<PTok>>>,
        loc: Loc,
    ) -> Res<Vec<PTok>> {
        let Some(p) = mac.params.as_ref().map(|ps| ps.len() - 1) else {
            return Ok(Vec::new());
        };
        if expanded[p].is_none() {
            expanded[p] = Some(self.expand_list(args[p].clone(), loc)?);
        }
        if expanded[p].as_ref().is_none_or(Vec::is_empty) {
            return Ok(Vec::new());
        }
        self.substitute_tokens(mac, contents, args, expanded, loc)
    }

    fn substitute_tokens(
        &mut self,
        mac: &Macro,
        body: &[PpToken],
        args: &[Vec<PTok>],
        expanded: &mut Vec<Option<Vec<PTok>>>,
        loc: Loc,
    ) -> Res<Vec<PTok>> {
        let variadic_index = if mac.variadic {
            mac.params.as_ref().map(|p| p.len() - 1)
        } else {
            None
        };
        let mut out: Vec<PTok> = Vec::with_capacity(body.len());
        // The left operand of the next `##` was an empty argument (a placemarker).
        let mut lhs_placemarker = false;
        let from_body = |tok: &PpToken| -> PTok {
            let mut tok = tok.clone();
            tok.loc = loc;
            PTok::plain(tok)
        };
        let mut i = 0;
        while i < body.len() {
            let t = &body[i];
            let next_is_paste = body
                .get(i + 1)
                .is_some_and(|n| n.kind == PpKind::Punct(Punct::HashHash));
            // # __VA_OPT__(...)
            if mac.params.is_some() && t.kind == PpKind::Punct(Punct::Hash) {
                if let Some(close) = Self::va_opt_group(mac, body, i + 1) {
                    let group =
                        self.substitute_va_opt(mac, &body[i + 3..close], args, expanded, loc)?;
                    let mut s = stringify(&group, loc);
                    s.has_leading_space = t.has_leading_space;
                    out.push(PTok::plain(s));
                    lhs_placemarker = false;
                    i = close + 1;
                    continue;
                }
            }
            // # parameter
            if mac.params.is_some() && t.kind == PpKind::Punct(Punct::Hash) {
                if let Some(p) = body.get(i + 1).and_then(|n| mac.param_index(n)) {
                    let mut s = stringify(&args[p], loc);
                    s.has_leading_space = t.has_leading_space;
                    out.push(PTok::plain(s));
                    lhs_placemarker = false;
                    i += 2;
                    continue;
                }
            }
            // lhs ## rhs
            if t.kind == PpKind::Punct(Punct::HashHash) && i > 0 {
                let Some(rhs) = body.get(i + 1) else { break };
                let mut after_rhs = i + 2;
                let va_opt = match Self::va_opt_group(mac, body, i + 1) {
                    Some(close) => {
                        after_rhs = close + 1;
                        Some(self.substitute_va_opt(
                            mac,
                            &body[i + 3..close],
                            args,
                            expanded,
                            loc,
                        )?)
                    }
                    None => None,
                };
                let rhs_tokens: Vec<PTok> = match mac.param_index(rhs) {
                    _ if va_opt.is_some() => va_opt.unwrap_or_default(),
                    Some(p) => {
                        // GNU: `, ## __VA_ARGS__` drops the comma when there are no variable arguments.
                        if Some(p) == variadic_index
                            && out.last().is_some_and(|l| l.is_punct(Punct::Comma))
                            && !lhs_placemarker
                        {
                            if args[p].is_empty() {
                                out.pop();
                            } else {
                                out.extend(args[p].iter().cloned());
                            }
                            i += 2;
                            continue;
                        }
                        args[p].clone()
                    }
                    None => vec![from_body(rhs)],
                };
                // Pasting with a placemarker (an empty `rhs_tokens`) leaves the other operand unchanged.
                if rhs_tokens.is_empty() {
                } else if lhs_placemarker || out.is_empty() {
                    out.extend(rhs_tokens);
                    lhs_placemarker = false;
                } else {
                    let mut rest = rhs_tokens.into_iter();
                    if let (Some(lhs), Some(first)) = (out.pop(), rest.next()) {
                        out.push(paste(&lhs, &first, loc)?);
                    }
                    out.extend(rest);
                }
                i = after_rhs;
                continue;
            }
            if let Some(close) = Self::va_opt_group(mac, body, i) {
                let mut group =
                    self.substitute_va_opt(mac, &body[i + 2..close], args, expanded, loc)?;
                let followed_by_paste = body
                    .get(close + 1)
                    .is_some_and(|n| n.kind == PpKind::Punct(Punct::HashHash));
                lhs_placemarker = followed_by_paste && group.is_empty();
                inherit_spacing(&mut group, t);
                out.extend(group);
                i = close + 1;
                continue;
            }
            if let Some(p) = mac.param_index(t) {
                if next_is_paste {
                    // Operands of ## are not macro-expanded first.
                    if args[p].is_empty() {
                        lhs_placemarker = true;
                    } else {
                        lhs_placemarker = false;
                        let start = out.len();
                        out.extend(args[p].iter().cloned());
                        inherit_spacing(&mut out[start..], t);
                    }
                } else {
                    if expanded[p].is_none() {
                        expanded[p] = Some(self.expand_list(args[p].clone(), loc)?);
                    }
                    let start = out.len();
                    if let Some(tokens) = &expanded[p] {
                        out.extend(tokens.iter().cloned());
                    }
                    inherit_spacing(&mut out[start..], t);
                    lhs_placemarker = false;
                }
                i += 1;
                continue;
            }
            out.push(from_body(t));
            lhs_placemarker = false;
            i += 1;
        }
        Ok(out)
    }

    fn builtin_value(&mut self, builtin: Builtin, at: &PpToken) -> PpToken {
        let number = |v: u64| (PpKind::Number, v.to_string().into_bytes());
        let string = |s: &str| {
            let mut text = vec![b'"'];
            for &b in s.as_bytes() {
                if b == b'"' || b == b'\\' {
                    text.push(b'\\');
                }
                text.push(b);
            }
            text.push(b'"');
            (PpKind::StrLit, text)
        };
        let (kind, text) = match builtin {
            Builtin::Line => number(u64::from(at.loc.line)),
            Builtin::File => string(self.files.borrow().name(at.loc.file)),
            Builtin::Counter => {
                self.counter += 1;
                number(self.counter - 1)
            }
            Builtin::IncludeLevel => number(self.frames.len().saturating_sub(1) as u64),
            Builtin::BaseFile => string(&self.base_file),
            Builtin::Date => string(&format_date(self.now)),
            Builtin::Time => string(&format_time(self.now)),
            Builtin::Timestamp => {
                const DAYS: [&str; 7] = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"];
                let date = format_date(self.now);
                let (month_and_day, year) = date.split_at(date.len().saturating_sub(5));
                string(&format!(
                    "{} {} {}{}",
                    DAYS[(self.now / 86_400 % 7) as usize],
                    month_and_day,
                    format_time(self.now),
                    year
                ))
            }
        };
        PpToken {
            kind,
            text,
            ..at.clone()
        }
    }
}

/// What `defined` and `#ifdef` say yes to without a macro of that name. (`__has_warning`
/// still works inside `#if`; it is not announced because code that finds it defined goes
/// on to use it in ordinary text, where only Clang expands it.)
fn is_pp_operator(name: &[u8]) -> bool {
    matches!(
        name,
        b"__has_include"
            | b"__has_include_next"
            | b"__has_attribute"
            | b"__has_builtin"
            | b"__has_feature"
            | b"__has_extension"
            | b"__has_cpp_attribute"
            | b"__has_c_attribute"
    )
}

pub(crate) fn eof_token(loc: Loc) -> PpToken {
    PpToken {
        kind: PpKind::Eof,
        text: Vec::new(),
        loc,
        at_start_of_line: true,
        has_leading_space: false,
    }
}

/// The first token substituted for a parameter is spaced like the parameter was.
fn inherit_spacing(tokens: &mut [PTok], param: &PpToken) {
    if let Some(first) = tokens.first_mut() {
        first.tok.has_leading_space = param.has_leading_space;
        first.tok.at_start_of_line = false;
        first.inherited_space = true;
    }
}

/// The `#` operator (C11 6.10.3.2).
fn stringify(arg: &[PTok], loc: Loc) -> PpToken {
    let mut text = vec![b'"'];
    for (i, t) in arg.iter().enumerate() {
        if i > 0 && (t.tok.has_leading_space || t.tok.at_start_of_line) {
            text.push(b' ');
        }
        let quoted = matches!(t.tok.kind, PpKind::StrLit | PpKind::CharLit);
        for &b in spelling(&t.tok) {
            if quoted && (b == b'"' || b == b'\\') {
                text.push(b'\\');
            }
            text.push(b);
        }
    }
    text.push(b'"');
    PpToken {
        kind: PpKind::StrLit,
        text,
        loc,
        at_start_of_line: false,
        has_leading_space: false,
    }
}

/// The `##` operator: the concatenated spelling must lex as exactly one token.
fn paste(lhs: &PTok, rhs: &PTok, loc: Loc) -> Res<PTok> {
    let mut text = spelling(&lhs.tok).to_vec();
    text.extend_from_slice(spelling(&rhs.tok));
    let mut lexer = Lexer::new(Rc::from(text.as_slice()), loc.file);
    let first = lexer.next_token()?;
    let second = lexer.next_token()?;
    if first.kind == PpKind::Eof || second.kind != PpKind::Eof || first.kind == PpKind::Other {
        return err(
            loc,
            format!(
                "pasting \"{}\" and \"{}\" does not give a valid preprocessing token",
                display_bytes(spelling(&lhs.tok)),
                display_bytes(spelling(&rhs.tok))
            ),
        );
    }
    Ok(PTok {
        tok: PpToken {
            kind: first.kind,
            text: first.text,
            loc,
            at_start_of_line: lhs.tok.at_start_of_line,
            has_leading_space: lhs.tok.has_leading_space,
        },
        no_expand: false,
        inherited_space: lhs.inherited_space,
    })
}

/// Days since 1970-01-01 to (year, month, day), proleptic Gregorian.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(month <= 2), month, day)
}

fn format_date(now: u64) -> String {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let (year, month, day) = civil_from_days((now / 86_400) as i64);
    format!("{} {:2} {}", MONTHS[(month as usize - 1) % 12], day, year)
}

fn format_time(now: u64) -> String {
    let s = now % 86_400;
    format!("{:02}:{:02}:{:02}", s / 3600, s % 3600 / 60, s % 60)
}

impl TokenSource for Preprocessor {
    fn next_token(&mut self) -> Res<PpToken> {
        Ok(self.next_expanded()?.tok)
    }
}
