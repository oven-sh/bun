//! Preprocessor directives: conditionals, `#define`, `#include` and friends.

use std::rc::Rc;

use crate::pp::{
    Builtin, Cond, MAX_INCLUDE_DEPTH, Macro, PTok, Preprocessor, SearchDir, eof_token, spelling,
};
use crate::token::{Loc, PpKind, PpToken, Punct, Res, TokenSource, display_bytes, err};

/// The compiler's own headers.
const BUILTIN_HEADERS: &[(&str, &str)] = &[
    ("float.h", include_str!("include/float.h")),
    ("iso646.h", include_str!("include/iso646.h")),
    ("limits.h", include_str!("include/limits.h")),
    ("stdalign.h", include_str!("include/stdalign.h")),
    ("stdarg.h", include_str!("include/stdarg.h")),
    ("stdbool.h", include_str!("include/stdbool.h")),
    ("stddef.h", include_str!("include/stddef.h")),
    ("stdint.h", include_str!("include/stdint.h")),
    ("stdnoreturn.h", include_str!("include/stdnoreturn.h")),
    ("stdatomic.h", include_str!("include/stdatomic.h")),
];

/// Intrinsic headers that exist only for one architecture.
const X86_HEADERS: &[(&str, &str)] = &[
    ("xmmintrin.h", include_str!("include/xmmintrin.h")),
    ("emmintrin.h", include_str!("include/emmintrin.h")),
    ("tmmintrin.h", include_str!("include/tmmintrin.h")),
    ("smmintrin.h", include_str!("include/smmintrin.h")),
    ("immintrin.h", include_str!("include/immintrin.h")),
    ("cpuid.h", include_str!("include/cpuid.h")),
];

const ARM64_HEADERS: &[(&str, &str)] = &[
    ("arm_neon.h", include_str!("include/arm_neon.h")),
    ("arm_acle.h", include_str!("include/arm_acle.h")),
];

const BUILTIN_DIR: &str = "<builtin>";

fn builtin_header(name: &str, arch: crate::types::Arch) -> Option<&'static str> {
    let for_arch = match arch {
        crate::types::Arch::X86_64 => X86_HEADERS,
        crate::types::Arch::Aarch64 => ARM64_HEADERS,
    };
    BUILTIN_HEADERS
        .iter()
        .chain(for_arch)
        .find(|(n, _)| *n == name)
        .map(|(_, text)| *text)
}

/// `path` without `.` components and with `dir/..` removed, so that different spellings
/// of one file compare equal. Symbolic links are not followed.
fn same_file_key(path: &str) -> String {
    let absolute = path.starts_with('/');
    let mut parts: Vec<&str> = Vec::new();
    let mut start = 0;
    let bytes = path.as_bytes();
    for end in 0..=bytes.len() {
        if end < bytes.len() && bytes[end] != b'/' && bytes[end] != b'\\' {
            continue;
        }
        let part = &path[start..end];
        start = end + 1;
        match part {
            "" | "." => {}
            ".." if parts.last().is_some_and(|p| *p != "..") => {
                parts.pop();
            }
            ".." if absolute => {}
            other => parts.push(other),
        }
    }
    let joined = parts.join("/");
    if absolute {
        format!("/{joined}")
    } else {
        joined
    }
}

fn directory_of(path: &str) -> &str {
    let bytes = path.as_bytes();
    let mut i = bytes.len();
    while i > 0 {
        if bytes[i - 1] == b'/' || bytes[i - 1] == b'\\' {
            return &path[..i - 1];
        }
        i -= 1;
    }
    ""
}

fn join(dir: &str, name: &str) -> String {
    if dir.is_empty() {
        name.to_string()
    } else {
        format!("{dir}/{name}")
    }
}

impl Preprocessor<'_> {
    fn read_frame_token(&mut self) -> Res<Option<PpToken>> {
        let Some(frame) = self.frames.last_mut() else {
            return Ok(None);
        };
        let mut tok = match frame.peeked.take() {
            Some(t) => t,
            None => {
                let mut t = frame.lexer.next_token()?;
                if frame.line_delta != 0 {
                    t.loc.line = (i64::from(t.loc.line) + frame.line_delta).max(0) as u32;
                }
                if let Some(file) = frame.presumed_file {
                    t.loc.file = file;
                }
                t
            }
        };
        if tok.kind == PpKind::Eof {
            tok.at_start_of_line = true;
        }
        Ok(Some(tok))
    }

    /// The rest of the current line of the current file.
    fn read_line(&mut self) -> Res<Vec<PpToken>> {
        let mut line = Vec::new();
        loop {
            let Some(tok) = self.read_frame_token()? else {
                return Ok(line);
            };
            if tok.at_start_of_line {
                if let Some(frame) = self.frames.last_mut() {
                    frame.peeked = Some(tok);
                }
                return Ok(line);
            }
            line.push(tok);
        }
    }

    fn active(&self) -> bool {
        self.frames
            .last()
            .and_then(|f| f.conds.last())
            .is_none_or(|c| c.active)
    }

    /// The next token from the file stack that belongs to an active group.
    pub(crate) fn next_from_files(&mut self) -> Res<PTok> {
        loop {
            let Some(tok) = self.read_frame_token()? else {
                return Ok(PTok::plain(eof_token(Loc::default())));
            };
            if tok.kind == PpKind::Eof {
                let Some(frame) = self.frames.last() else {
                    return Ok(PTok::plain(tok));
                };
                if let Some(cond) = frame.conds.last() {
                    return err(cond.loc, "unterminated conditional directive");
                }
                if self.frames.len() == 1 {
                    // Keep the last frame so later reads keep returning end of file.
                    if let Some(frame) = self.frames.last_mut() {
                        frame.peeked = Some(tok.clone());
                    }
                    return Ok(PTok::plain(tok));
                }
                self.frames.pop();
                continue;
            }
            if tok.at_start_of_line && tok.kind == PpKind::Punct(Punct::Hash) {
                self.directive(tok.loc)?;
                if let Some(pragma) = self.pending_pragma.take() {
                    return Ok(PTok::plain(pragma));
                }
                continue;
            }
            if !self.active() {
                continue;
            }
            return Ok(PTok::plain(tok));
        }
    }

    fn directive(&mut self, hash_loc: Loc) -> Res<()> {
        // `#include <...>` needs the lexer in header-name mode, so peek at the name first.
        let Some(name_tok) = self.read_frame_token()? else {
            return Ok(());
        };
        if name_tok.at_start_of_line {
            // The null directive.
            if let Some(frame) = self.frames.last_mut() {
                frame.peeked = Some(name_tok);
            }
            return Ok(());
        }
        let name = if name_tok.kind == PpKind::Ident {
            name_tok.text.as_slice()
        } else {
            b"" as &[u8]
        };
        let active = self.active();
        match name {
            b"if" | b"ifdef" | b"ifndef" => {
                let line = self.read_line()?;
                let value = if !active {
                    false
                } else {
                    match name {
                        b"if" => self.eval_condition(line, name_tok.loc)?,
                        _ => {
                            let defined = self.defined_operand(&line, name_tok.loc)?;
                            defined == (name == b"ifdef")
                        }
                    }
                };
                if let Some(frame) = self.frames.last_mut() {
                    frame.conds.push(Cond {
                        loc: hash_loc,
                        parent_active: active,
                        taken: value,
                        active: active && value,
                        seen_else: false,
                    });
                }
                Ok(())
            }
            b"elif" | b"elifdef" | b"elifndef" => {
                let line = self.read_line()?;
                let Some(cond) = self.frames.last().and_then(|f| f.conds.last()) else {
                    return err(hash_loc, format!("#{} without #if", display_bytes(name)));
                };
                if cond.seen_else {
                    return err(hash_loc, format!("#{} after #else", display_bytes(name)));
                }
                let evaluate = cond.parent_active && !cond.taken;
                let value = if !evaluate {
                    false
                } else {
                    match name {
                        b"elif" => self.eval_condition(line, name_tok.loc)?,
                        _ => self.defined_operand(&line, name_tok.loc)? == (name == b"elifdef"),
                    }
                };
                if let Some(cond) = self.frames.last_mut().and_then(|f| f.conds.last_mut()) {
                    cond.active = evaluate && value;
                    cond.taken |= value;
                }
                Ok(())
            }
            b"else" => {
                self.read_line()?;
                let Some(cond) = self.frames.last_mut().and_then(|f| f.conds.last_mut()) else {
                    return err(hash_loc, "#else without #if");
                };
                if cond.seen_else {
                    return err(hash_loc, "#else after #else");
                }
                cond.seen_else = true;
                cond.active = cond.parent_active && !cond.taken;
                cond.taken = true;
                Ok(())
            }
            b"endif" => {
                self.read_line()?;
                let popped = self.frames.last_mut().and_then(|f| f.conds.pop());
                if popped.is_none() {
                    return err(hash_loc, "#endif without #if");
                }
                Ok(())
            }
            _ if !active => {
                self.read_line()?;
                Ok(())
            }
            b"include" | b"include_next" | b"import" => {
                self.include(name == b"include_next", name_tok.loc)
            }
            b"define" => {
                let line = self.read_line()?;
                self.define(line, name_tok.loc)
            }
            b"undef" => {
                let line = self.read_line()?;
                match line.as_slice() {
                    [t] if t.kind == PpKind::Ident => {
                        if let Ok(n) = std::str::from_utf8(&t.text) {
                            self.macros.remove(n);
                        }
                        Ok(())
                    }
                    _ => err(name_tok.loc, "#undef expects a single macro name"),
                }
            }
            b"error" => {
                let line = self.read_line()?;
                err(
                    hash_loc,
                    format!("#error {}", display_bytes(&join_spellings(&line))),
                )
            }
            b"line" => {
                let line = self.read_line()?;
                self.line_directive(line, name_tok.loc)
            }
            b"pragma" => {
                let line = self.read_line()?;
                if let [t] = line.as_slice() {
                    if t.kind == PpKind::Ident && t.text == b"once" {
                        if let Some(frame) = self.frames.last() {
                            self.pragma_once
                                .insert(Rc::from(same_file_key(&frame.path)));
                        }
                    }
                }
                self.pragma(&line, hash_loc);
                Ok(())
            }
            b"warning" => {
                let line = self.read_line()?;
                let message = format!("#warning {}", display_bytes(&join_spellings(&line)));
                self.files.borrow_mut().warnings.push((hash_loc, message));
                Ok(())
            }
            b"ident" | b"sccs" | b"assert" | b"unassert" => {
                self.read_line()?;
                Ok(())
            }
            _ => {
                if name_tok.kind == PpKind::Number {
                    // `# 33 "file"`: a line marker as written by other preprocessors.
                    let mut line = vec![name_tok.clone()];
                    line.extend(self.read_line()?);
                    return self.line_directive(line, name_tok.loc);
                }
                self.read_line()?;
                err(
                    name_tok.loc,
                    format!(
                        "invalid preprocessing directive #{}",
                        display_bytes(spelling(&name_tok))
                    ),
                )
            }
        }
    }

    /// The operand of `#ifdef`/`#ifndef`/`#elifdef`.
    /// `#pragma comment(lib, "name")`: records the library; every other pragma is ignored.
    /// The pragmas that mean something here, from a `#pragma` line or a `_Pragma` operator;
    /// all others are ignored.
    pub(crate) fn pragma(&mut self, line: &[PpToken], loc: Loc) {
        self.pragma_comment_lib(line);
        let is = |t: &PpToken, text: &[u8]| t.kind == PpKind::Ident && t.text == text;
        let punct = |t: &PpToken, p: Punct| t.kind == PpKind::Punct(p);
        let Some((first, rest)) = line.split_first() else {
            return;
        };
        if is(first, b"redefine_extname") {
            // The operands are macro-expanded; the new name may be spelled as strings.
            let tokens: Vec<PTok> = rest.iter().cloned().map(PTok::plain).collect();
            let expanded = self.with_isolated_input(tokens, |pp| {
                let mut out = Vec::new();
                loop {
                    let t = pp.next_expanded()?;
                    if t.is_eof() {
                        return Ok(out);
                    }
                    out.push(t.tok);
                }
            });
            let Ok(expanded) = expanded else { return };
            let Some((old, new)) = expanded.split_first() else {
                return;
            };
            let mut symbol = Vec::new();
            for t in new {
                match t.kind {
                    PpKind::Ident if new.len() == 1 => symbol.extend_from_slice(&t.text),
                    PpKind::StrLit if t.text.len() >= 2 && t.text[0] == b'"' => {
                        symbol.extend_from_slice(&t.text[1..t.text.len() - 1]);
                    }
                    _ => return,
                }
            }
            if old.kind == PpKind::Ident && !symbol.is_empty() {
                let mut text = b"redefine_extname ".to_vec();
                text.extend_from_slice(&old.text);
                text.push(b' ');
                text.extend_from_slice(&symbol);
                self.pending_pragma = Some(PpToken {
                    kind: PpKind::Pragma,
                    text,
                    loc,
                    at_start_of_line: true,
                    has_leading_space: false,
                });
            }
            return;
        }
        if let (true, [name]) = (is(first, b"weak"), rest) {
            if name.kind == PpKind::Ident {
                let mut text = b"weak ".to_vec();
                text.extend_from_slice(&name.text);
                self.pending_pragma = Some(PpToken {
                    kind: PpKind::Pragma,
                    text,
                    loc,
                    at_start_of_line: true,
                    has_leading_space: false,
                });
            }
            return;
        }
        if let (true, [state]) = (is(first, b"ms_struct"), rest) {
            // `reset` goes back to what the target does, and no target this is set for does.
            let text: &[u8] = if is(state, b"on") {
                b"ms_struct on"
            } else if is(state, b"off") || is(state, b"reset") {
                b"ms_struct off"
            } else {
                return;
            };
            self.pending_pragma = Some(PpToken {
                kind: PpKind::Pragma,
                text: text.to_vec(),
                loc,
                at_start_of_line: true,
                has_leading_space: false,
            });
            return;
        }
        let inner = match rest {
            [open, inner @ .., close]
                if punct(open, Punct::LParen) && punct(close, Punct::RParen) =>
            {
                inner
            }
            _ => return,
        };
        if is(first, b"push_macro") || is(first, b"pop_macro") {
            let [name] = inner else { return };
            if name.kind != PpKind::StrLit || name.text.len() < 2 || name.text[0] != b'"' {
                return;
            }
            let Ok(name) = std::str::from_utf8(&name.text[1..name.text.len() - 1]) else {
                return;
            };
            let name: Rc<str> = Rc::from(name);
            if is(first, b"push_macro") {
                let saved = self.macros.get(&name).cloned();
                self.pushed_macros.entry(name).or_default().push(saved);
            } else if let Some(saved) = self.pushed_macros.get_mut(&name).and_then(Vec::pop) {
                match saved {
                    Some(mac) => {
                        self.macros.insert(name, mac);
                    }
                    None => {
                        self.macros.remove(&name);
                    }
                }
            }
            return;
        }
        if !is(first, b"pack") {
            return;
        }
        // pack() | pack(n) | pack(push[, name][, n]) | pack(pop[, name])
        fn number(t: &PpToken) -> Option<&[u8]> {
            (t.kind == PpKind::Number && t.text.iter().all(u8::is_ascii_digit))
                .then_some(&t.text[..])
        }
        let mut text: Vec<u8> = b"pack ".to_vec();
        let mut words = inner.iter().filter(|t| !punct(t, Punct::Comma));
        match words.next() {
            None => text.extend_from_slice(b"set default"),
            Some(t) if is(t, b"pop") => text.extend_from_slice(b"pop"),
            Some(t) if is(t, b"push") => {
                text.extend_from_slice(b"push ");
                match words.filter_map(number).next_back() {
                    Some(n) => text.extend_from_slice(n),
                    None => text.extend_from_slice(b"default"),
                }
            }
            Some(t) => match number(t) {
                Some(n) => {
                    text.extend_from_slice(b"set ");
                    text.extend_from_slice(n);
                }
                None => return,
            },
        }
        self.pending_pragma = Some(PpToken {
            kind: PpKind::Pragma,
            text,
            loc,
            at_start_of_line: true,
            has_leading_space: false,
        });
    }

    fn pragma_comment_lib(&mut self, line: &[PpToken]) {
        let is = |t: &PpToken, text: &[u8]| t.kind == PpKind::Ident && t.text == text;
        let [comment, open, lib, comma, name, close] = line else {
            return;
        };
        let shape_ok = is(comment, b"comment")
            && open.kind == PpKind::Punct(Punct::LParen)
            && is(lib, b"lib")
            && comma.kind == PpKind::Punct(Punct::Comma)
            && name.kind == PpKind::StrLit
            && close.kind == PpKind::Punct(Punct::RParen);
        if !shape_ok || name.text.len() < 2 || name.text[0] != b'"' {
            return;
        }
        let library = display_bytes(&name.text[1..name.text.len() - 1]);
        let mut files = self.files.borrow_mut();
        if !library.is_empty() && !files.libraries.contains(&library) {
            files.libraries.push(library);
        }
    }

    fn defined_operand(&self, line: &[PpToken], loc: Loc) -> Res<bool> {
        match line.first() {
            Some(t) if t.kind == PpKind::Ident => Ok(self.is_defined(&t.text)),
            _ => err(loc, "expected a macro name"),
        }
    }

    fn line_directive(&mut self, line: Vec<PpToken>, loc: Loc) -> Res<()> {
        let directive_end = line.last().map_or(loc.line, |t| t.loc.line);
        let tokens: Vec<PTok> = line.into_iter().map(PTok::plain).collect();
        let expanded = self.with_isolated_input(tokens, |pp| {
            let mut out = Vec::new();
            loop {
                let t = pp.next_expanded()?;
                if t.is_eof() {
                    return Ok(out);
                }
                out.push(t.tok);
            }
        })?;
        let Some(number) = expanded.first().filter(|t| t.kind == PpKind::Number) else {
            return err(loc, "#line expects a line number");
        };
        let mut value: i64 = 0;
        for &b in &number.text {
            if !b.is_ascii_digit() {
                return err(loc, "#line expects a decimal line number");
            }
            value = (value * 10 + i64::from(b - b'0')).min(i64::from(u32::MAX));
        }
        let file = match expanded.get(1) {
            Some(t) if t.kind == PpKind::StrLit && t.text.len() >= 2 => {
                let name = display_bytes(&t.text[1..t.text.len() - 1]);
                Some(self.files.borrow_mut().add(&name))
            }
            Some(_) => return err(loc, "invalid file name in #line"),
            None => None,
        };
        if let Some(frame) = self.frames.last_mut() {
            // The line after the directive gets number `value`, whether or not anything is
            // on it.
            let physical_next = i64::from(directive_end) - frame.line_delta + 1;
            let old_delta = frame.line_delta;
            frame.line_delta = value - physical_next;
            if let Some(t) = &mut frame.peeked {
                t.loc.line = (i64::from(t.loc.line) - old_delta + frame.line_delta).max(0) as u32;
                if let Some(file) = file {
                    t.loc.file = file;
                }
            }
            if file.is_some() {
                frame.presumed_file = file;
            }
        }
        Ok(())
    }

    // ───────────────────────────── #define ─────────────────────────────

    fn define(&mut self, line: Vec<PpToken>, loc: Loc) -> Res<()> {
        let mut tokens = line.into_iter();
        let Some(name_tok) = tokens.next().filter(|t| t.kind == PpKind::Ident) else {
            return err(loc, "macro name must be an identifier");
        };
        let Ok(name_str) = std::str::from_utf8(&name_tok.text) else {
            return err(name_tok.loc, "macro name is not valid UTF-8");
        };
        if name_str == "defined" {
            return err(name_tok.loc, "'defined' cannot be used as a macro name");
        }
        // glibc's <sys/cdefs.h> erases `__attribute__` for compilers that are not GCC, Clang
        // or TinyCC. This compiler implements attributes (packed, aligned, vector_size), so
        // the keyword stays a keyword.
        if name_str == "__attribute__" {
            return Ok(());
        }
        let name: Rc<str> = Rc::from(name_str);
        let mut rest: Vec<PpToken> = tokens.collect();
        let mut params = None;
        let mut variadic = false;
        // Function-like only when `(` touches the name.
        if rest
            .first()
            .is_some_and(|t| t.kind == PpKind::Punct(Punct::LParen) && !t.has_leading_space)
        {
            let mut list: Vec<Rc<str>> = Vec::new();
            let mut i = 1;
            let mut closed = false;
            let mut expect_name = true;
            while i < rest.len() {
                let t = &rest[i];
                i += 1;
                match t.kind {
                    PpKind::Punct(Punct::RParen) if list.is_empty() || !expect_name || variadic => {
                        closed = true;
                        break;
                    }
                    PpKind::Punct(Punct::Ellipsis) if expect_name && !variadic => {
                        list.push(Rc::from("__VA_ARGS__"));
                        variadic = true;
                        expect_name = false;
                    }
                    PpKind::Punct(Punct::Ellipsis)
                        if !expect_name && !variadic && !list.is_empty() =>
                    {
                        // GNU named variable arguments: `args...`.
                        variadic = true;
                    }
                    PpKind::Ident if expect_name && !variadic => {
                        let Ok(p) = std::str::from_utf8(&t.text) else {
                            return err(t.loc, "parameter name is not valid UTF-8");
                        };
                        if p == "__VA_ARGS__" {
                            return err(t.loc, "__VA_ARGS__ cannot be a parameter name");
                        }
                        if list.iter().any(|existing| &**existing == p) {
                            return err(t.loc, format!("duplicate macro parameter '{p}'"));
                        }
                        list.push(Rc::from(p));
                        expect_name = false;
                    }
                    PpKind::Punct(Punct::Comma) if !expect_name && !variadic => expect_name = true,
                    _ => return err(t.loc, "invalid token in macro parameter list"),
                }
            }
            if !closed {
                return err(name_tok.loc, "missing ')' in macro parameter list");
            }
            rest.drain(..i);
            params = Some(list);
        }
        if let Some(first) = rest.first_mut() {
            first.has_leading_space = false;
        }
        let is_paste = |t: &PpToken| t.kind == PpKind::Punct(Punct::HashHash);
        if rest.first().is_some_and(is_paste) || rest.last().is_some_and(is_paste) {
            return err(
                name_tok.loc,
                "'##' cannot appear at either end of a macro expansion",
            );
        }
        let mac = Macro {
            name: Rc::clone(&name),
            params,
            variadic,
            body: rest,
            builtin: None,
        };
        if mac.params.is_some() {
            for (i, t) in mac.body.iter().enumerate() {
                if t.kind == PpKind::Punct(Punct::Hash)
                    && !mac.body.get(i + 1).is_some_and(|n| {
                        mac.is_param(n)
                            || (mac.variadic && n.kind == PpKind::Ident && n.text == b"__VA_OPT__")
                    })
                {
                    return err(t.loc, "'#' is not followed by a macro parameter");
                }
            }
        }
        if let Some(old) = self.macros.get(&name) {
            // A constraint violation that every compiler only warns about; system headers
            // rely on that (glibc's <arpa/nameser_compat.h> against a library's own copy).
            if old.builtin.is_some() || !old.same_definition(&mac) {
                self.files.borrow_mut().warnings.push((
                    name_tok.loc,
                    format!("'{name}' redefined with a different definition"),
                ));
            }
        }
        self.macros.insert(name, Rc::new(mac));
        Ok(())
    }

    pub(crate) fn define_builtins(&mut self) {
        for (name, builtin) in [
            ("__FILE__", Builtin::File),
            ("__LINE__", Builtin::Line),
            ("__COUNTER__", Builtin::Counter),
            ("__INCLUDE_LEVEL__", Builtin::IncludeLevel),
            ("__BASE_FILE__", Builtin::BaseFile),
            ("__DATE__", Builtin::Date),
            ("__TIME__", Builtin::Time),
        ] {
            self.define_builtin(name, builtin);
        }
    }

    fn define_builtin(&mut self, name: &str, builtin: Builtin) {
        let name: Rc<str> = Rc::from(name);
        self.macros.insert(
            Rc::clone(&name),
            Rc::new(Macro {
                name,
                params: None,
                variadic: false,
                body: Vec::new(),
                builtin: Some(builtin),
            }),
        );
    }

    // ───────────────────────────── #include ─────────────────────────────

    fn load(&mut self, path: &str) -> Option<Rc<[u8]>> {
        if let Some(cached) = self.file_cache.get(path) {
            return cached.clone();
        }
        let contents: Option<Rc<[u8]>> = match path
            .strip_prefix(BUILTIN_DIR)
            .and_then(|p| p.strip_prefix('/'))
        {
            Some(name) => {
                builtin_header(name, self.target.arch).map(|text| Rc::from(text.as_bytes()))
            }
            None => self.provider.read(path).map(Rc::from),
        };
        self.file_cache.insert(Rc::from(path), contents.clone());
        contents
    }

    fn search_path(&self, index: usize, name: &str) -> String {
        match &self.search[index] {
            SearchDir::Dir(dir) => join(dir, name),
            SearchDir::Builtin => join(BUILTIN_DIR, name),
        }
    }

    /// Finds the file an `#include` names. Returns its path and search path position.
    pub(crate) fn resolve_include(
        &mut self,
        name: &str,
        angled: bool,
        next: bool,
    ) -> Option<(String, Option<usize>)> {
        let (current_path, current_at) = match self.frames.last() {
            Some(f) => (Rc::clone(&f.path), f.found_at),
            None => (Rc::from(""), None),
        };
        let mut start = 0;
        // In a file that was not found through the search path (the one being compiled and
        // what it includes from beside itself), `#include_next` is `#include`.
        if let (true, Some(at)) = (next, current_at) {
            // Continue after the directory the current file came from.
            start = at + 1;
        } else if name.starts_with('/') {
            return self.load(name).map(|_| (name.to_string(), None));
        } else if !angled {
            let beside = join(directory_of(&current_path), name);
            if self.load(&beside).is_some() {
                // A header found next to its includer keeps that includer's search position.
                return Some((
                    beside,
                    current_at.filter(|_| !directory_of(&current_path).is_empty()),
                ));
            }
        }
        for index in start..self.search.len() {
            let candidate = self.search_path(index, name);
            if self.load(&candidate).is_some() {
                return Some((candidate, Some(index)));
            }
        }
        None
    }

    /// Reconstructs a header name from the tokens between `<` and `>`.
    pub(crate) fn header_name_from_tokens(tokens: &[PpToken], loc: Loc) -> Res<(String, bool)> {
        match tokens {
            [t] if t.kind == PpKind::StrLit
                && t.text.first() == Some(&b'"')
                && t.text.len() >= 2 =>
            {
                Ok((display_bytes(&t.text[1..t.text.len() - 1]), false))
            }
            [first, middle @ .., last]
                if first.kind == PpKind::Punct(Punct::Lt)
                    && last.kind == PpKind::Punct(Punct::Gt) =>
            {
                let mut name = Vec::new();
                for (i, t) in middle.iter().enumerate() {
                    if i > 0 && t.has_leading_space {
                        name.push(b' ');
                    }
                    name.extend_from_slice(spelling(t));
                }
                Ok((display_bytes(&name), true))
            }
            _ => err(loc, "#include expects \"FILENAME\" or <FILENAME>"),
        }
    }

    fn include(&mut self, next: bool, loc: Loc) -> Res<()> {
        let angled_name = match self.frames.last_mut() {
            Some(frame) if frame.peeked.is_none() => frame.lexer.angled_header_name(),
            _ => None,
        };
        let (name, angled) = match angled_name {
            Some(bytes) => {
                self.read_line()?;
                (display_bytes(&bytes), true)
            }
            None => {
                let line = self.read_line()?;
                let direct = matches!(line.as_slice(), [t] if t.kind == PpKind::StrLit);
                if direct {
                    Self::header_name_from_tokens(&line, loc)?
                } else {
                    let tokens: Vec<PTok> = line.into_iter().map(PTok::plain).collect();
                    let expanded = self.with_isolated_input(tokens, |pp| {
                        let mut out = Vec::new();
                        loop {
                            let t = pp.next_expanded()?;
                            if t.is_eof() {
                                return Ok(out);
                            }
                            out.push(t.for_header_name());
                        }
                    })?;
                    Self::header_name_from_tokens(&expanded, loc)?
                }
            }
        };
        if name.is_empty() {
            return err(loc, "empty file name in #include");
        }
        let Some((path, found_at)) = self.resolve_include(&name, angled, next) else {
            return err(loc, format!("'{name}' file not found"));
        };
        if self.pragma_once.contains(same_file_key(&path).as_str()) {
            return Ok(());
        }
        if self.frames.len() >= MAX_INCLUDE_DEPTH {
            return err(loc, "#include nested too deeply");
        }
        let Some(source) = self.load(&path) else {
            return err(loc, format!("'{name}' file not found"));
        };
        self.push_source(&path, source, found_at);
        Ok(())
    }
}

impl Macro {
    fn is_param(&self, tok: &PpToken) -> bool {
        tok.kind == PpKind::Ident
            && self
                .params
                .as_ref()
                .is_some_and(|ps| ps.iter().any(|p| p.as_bytes() == tok.text.as_slice()))
    }
}

/// A line of tokens as text, single-spaced.
pub(crate) fn join_spellings(tokens: &[PpToken]) -> Vec<u8> {
    let mut out = Vec::new();
    for (i, t) in tokens.iter().enumerate() {
        if i > 0 && t.has_leading_space {
            out.push(b' ');
        }
        out.extend_from_slice(spelling(t));
    }
    out
}
