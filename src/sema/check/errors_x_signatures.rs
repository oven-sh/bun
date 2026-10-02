//! Signatures.
//!
//! * Type parameters: 2368 2716 2706 2744 2636 2637, and 2344 (or what says more) for a default that is not what the parameter extends.
//! * Parameter lists: 1098, 1014 1013 1047 1048 1015 1016, 1346 1347, 7060 1200; parameters: 2398 2681 2784.
//! * Accessors, methods, constructors, properties: 1005 1318, 1221 1222, 1092 1093, 1245 1267, 2676 2808.
//! * Return types: 2505 1064 1058 1062, 2705 2712, 1228 1229 2677 1230 1225.
//! * `erasableSyntaxOnly`: 1294.
//!
//! Follows `checkTypeParameter`, `checkTypeParameterDeferred`, `checkTypeParameters`, `checkTypeParametersNotReferenced`, `checkParameter`,
//! `checkPropertyDeclaration`, `checkSignatureDeclaration`, `checkAsyncFunctionReturnType`, `checkMethodDeclaration`,
//! `checkAccessorDeclaration`, `checkTypePredicate`,
//! `createPromiseReturnType`, `getAwaitedTypeNoAliasEx` and `checkAssertion` of TypeScript 7.0.2's checker.go,
//! `checkGrammarTypeParameterList`, `checkGrammarParameterList`, `checkGrammarForUseStrictSimpleParameterList`,
//! `checkGrammarArrowFunction`, `checkGrammarForGenerator`, `checkGrammarAccessor`, `checkGrammarMethod` and
//! `checkGrammarConstructorTypeParameters` of its grammarchecks.go.
//!
//! The summary of a file does not keep everything these ask about: a body where none belongs, a `this` parameter, `"use strict"`, where a
//! `?` or a modifier is. That is read from the text, from a place the summary does have.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{Decl, FnOwner, MemberOwner, Parent};
use crate::resolve::ScriptTarget;
use crate::util::FxHashSet;

// ───────────────────────────── the text ─────────────────────────────

fn has_line_break(text: &[u8], from: usize, to: usize) -> bool {
    text.get(from..to)
        .is_some_and(|between| between.iter().any(|&b| b == b'\n' || b == b'\r'))
}

/// Where the type the summary has at `pos` starts as it is written. Neither the parentheses around a type are kept nor a `|` or a `&`
/// before its only member. Only for a type that follows a `:`, a `=`, an `is` or a `<`, which none of these can be mistaken for.
fn start_of_written_type(text: &[u8], pos: u32) -> u32 {
    let mut start = pos as usize;
    if start > text.len() {
        return pos;
    }
    loop {
        let before = skip_trivia_back(text, start);
        if before == 0 || !matches!(text[before - 1], b'(' | b'|' | b'&') {
            return start as u32;
        }
        start = before - 1;
    }
}

/// Past the string that starts at `start`.
fn skip_string(text: &[u8], start: usize) -> Option<usize> {
    let quote = *text.get(start)?;
    let mut i = start + 1;
    while let Some(&b) = text.get(i) {
        match b {
            b'\\' => i += 1,
            b'\n' | b'\r' => return None,
            _ if b == quote => return Some(i + 1),
            _ => {}
        }
        i += 1;
    }
    None
}

/// Past the template that starts at `start`.
fn skip_template(text: &[u8], start: usize) -> Option<usize> {
    let mut i = start + 1;
    while let Some(&b) = text.get(i) {
        match b {
            b'\\' => i += 2,
            b'`' => return Some(i + 1),
            b'$' if text.get(i + 1) == Some(&b'{') => i = end_of_brackets(text, i + 1)?,
            _ => i += 1,
        }
    }
    None
}

/// Past the `>` that closes the `<` at `open`, in a type.
fn skip_angle_brackets(text: &[u8], open: usize) -> Option<usize> {
    let mut depth = 0u32;
    let mut i = open;
    while let Some(&b) = text.get(i) {
        match b {
            b'<' => depth += 1,
            // Not the `>` of `=>`.
            b'>' if i > 0 && text[i - 1] == b'=' => {}
            b'>' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(i + 1);
                }
            }
            b'(' | b'[' | b'{' => {
                i = end_of_brackets(text, i)?;
                continue;
            }
            b'"' | b'\'' => {
                i = skip_string(text, i)?;
                continue;
            }
            b'`' => {
                i = skip_template(text, i)?;
                continue;
            }
            b'/' if matches!(text.get(i + 1), Some(b'/' | b'*')) => {
                i = skip_trivia(text, i);
                continue;
            }
            b')' | b']' | b'}' | b';' => return None,
            _ => {}
        }
        i += 1;
    }
    None
}

/// Where the type that starts at or after `i` ends: past its last token. `None`: it cannot be told.
fn skip_type(text: &[u8], mut i: usize) -> Option<usize> {
    let mut wants_operand = true;
    let mut open_conditionals = 0u32;
    let mut end = i;
    loop {
        let at = skip_trivia(text, i);
        let Some(&b) = text.get(at) else {
            return (!wants_operand).then_some(end);
        };
        if wants_operand {
            match b {
                b'{' | b'(' | b'[' => {
                    i = end_of_brackets(text, at)?;
                    wants_operand = false;
                }
                // The type parameters of a function type.
                b'<' => i = skip_angle_brackets(text, at)?,
                b'"' | b'\'' => {
                    i = skip_string(text, at)?;
                    wants_operand = false;
                }
                b'`' => {
                    i = skip_template(text, at)?;
                    wants_operand = false;
                }
                b'|' | b'&' | b'-' => i = at + 1,
                _ if !word_at(text, at).is_empty() => {
                    let word = word_at(text, at);
                    i = at + word.len();
                    let next = skip_trivia(text, i);
                    wants_operand = match word {
                        b"keyof" | b"typeof" | b"readonly" | b"unique" | b"infer" | b"new"
                        | b"abstract" => true,
                        b"asserts" => {
                            !has_line_break(text, i, next)
                                && text.get(next).is_some_and(|&n| is_identifier_part(n))
                        }
                        _ => false,
                    };
                }
                _ => return None,
            }
            end = i;
            continue;
        }
        let is_on_the_same_line = !has_line_break(text, end, at);
        match b {
            b'.' => {
                i = at + 1;
                wants_operand = true;
            }
            b'<' if is_on_the_same_line => i = skip_angle_brackets(text, at)?,
            b'[' if is_on_the_same_line => i = end_of_brackets(text, at)?,
            b'(' if text[..end].ends_with(b"import") => i = end_of_brackets(text, at)?,
            b'|' | b'&' => {
                i = at + 1;
                wants_operand = true;
            }
            b'=' if text.get(at + 1) == Some(&b'>') => {
                i = at + 2;
                wants_operand = true;
            }
            b'?' => {
                open_conditionals += 1;
                i = at + 1;
                wants_operand = true;
            }
            b':' if open_conditionals > 0 => {
                open_conditionals -= 1;
                i = at + 1;
                wants_operand = true;
            }
            _ if word_at(text, at) == b"extends"
                || is_on_the_same_line && word_at(text, at) == b"is" =>
            {
                i = at + word_at(text, at).len();
                wants_operand = true;
            }
            _ => return Some(end),
        }
        if !wants_operand {
            end = i;
        }
    }
}

/// Where the signature of `f` ends as it is written: past the `)` of the parameters, or past the return type.
fn end_of_signature(hir: &hir::File, f: FnId) -> Option<usize> {
    let (text, func) = (&hir.text[..], &hir[f]);
    if func.kind == FnKind::Arrow || text.get(func.anchor as usize) != Some(&b'(') {
        return None;
    }
    let close = end_of_brackets(text, func.anchor as usize)?;
    let next = skip_trivia(text, close);
    if text.get(next) == Some(&b':') {
        skip_type(text, next + 1)
    } else {
        Some(close)
    }
}

/// The `{` of the body of `f` as it is written. Where a body is out of place (`abstract m() {}`, `declare function f() {}`) the summary
/// does not keep it.
fn written_body(hir: &hir::File, f: FnId) -> Option<usize> {
    let (text, func) = (&hir.text[..], &hir[f]);
    let end = if func.kind == FnKind::Arrow {
        let arrow = func.anchor as usize;
        if !text
            .get(arrow..)
            .is_some_and(|rest| rest.starts_with(b"=>"))
        {
            return None;
        }
        arrow + 2
    } else {
        end_of_signature(hir, f)?
    };
    let at = skip_trivia(text, end);
    (text.get(at) == Some(&b'{')).then_some(at)
}

/// `NodeIsPresent(node.Body())`
fn has_written_body(hir: &hir::File, f: FnId) -> bool {
    !matches!(hir[f].body, FnBody::None) || written_body(hir, f).is_some()
}

/// Where the name of the `this` parameter of `f` is, if one is written.
pub(super) fn this_parameter(hir: &hir::File, f: FnId) -> Option<u32> {
    let this = hir.params.get(hir[f].this_param.idx())?;
    (!this.flags.contains(Flags::REPARSED)).then(|| hir[this.pat].pos)
}

/// Where the parameter written at `start` ends: before the `,` or the `)` that is in no bracket opened since.
fn end_of_written_parameter(c: &Checker<'_>, file: FileId, start: u32) -> u32 {
    let text = &c.hir(file).text[..];
    let (mut at, mut end, mut depth) = (start, start, 0u32);
    while (at as usize) < text.len() {
        let next = c.end_of_token_at(file, at).max(at + 1);
        match &text[at as usize..(next as usize).min(text.len())] {
            b"(" | b"[" | b"{" | b"<" => depth += 1,
            b")" | b"]" | b"}" | b"," if depth == 0 => break,
            b")" | b"]" | b"}" | b">" => depth = depth.saturating_sub(1),
            b">>" => depth = depth.saturating_sub(2),
            b">>>" => depth = depth.saturating_sub(3),
            _ => {}
        }
        end = next;
        at = c.skip_trivia_from(file, next);
    }
    end
}

/// The `?` after the name or the pattern `pat` of a parameter.
fn question_token(hir: &hir::File, pat: PatId) -> Option<u32> {
    let text = &hir.text[..];
    let start = hir[pat].pos as usize;
    let end = match hir[pat].kind {
        PatKind::Ident(_) => start + word_at(text, start).len(),
        PatKind::Object(_) | PatKind::Array(_) => end_of_brackets(text, start)?,
        PatKind::Missing => return None,
    };
    let at = skip_trivia(text, end);
    (end > start && text.get(at) == Some(&b'?')).then_some(at as u32)
}

/// Where the type alias, class, interface or function declaration that has the type parameter `tp` is named.
fn name_of_type_parameter_owner(hir: &hir::File, tp: TypeParamId) -> Option<u32> {
    let has = |list: Span<TypeParamId>| list.range().contains(&tp.idx());
    let alias = hir.aliases.iter().find(|a| has(a.type_params));
    let class = hir
        .classes
        .iter()
        .find(|c| has(c.type_params) && c.name.is_some());
    let interface = hir.interfaces.iter().find(|i| has(i.type_params));
    let function = hir
        .fns
        .iter()
        .find(|f| has(f.type_params) && f.kind == FnKind::Decl && f.name.is_some());
    alias
        .map(|a| a.name_pos)
        .or(class.map(|c| c.name_pos))
        .or(interface.map(|i| i.name_pos))
        .or(function.map(|f| f.name_pos))
}

/// Whether `checkGrammarModifiers` objected to a modifier of what is named at `name`: something was said of a word before it, with
/// nothing but modifiers and keywords in between.
fn has_modifier_error(hir: &hir::File, name: u32) -> bool {
    let text = &hir.text[..];
    hir.early_errors.iter().any(|&(at, _)| {
        let mut i = at as usize;
        if at >= name {
            return false;
        }
        loop {
            i = skip_trivia(text, i);
            if i >= name as usize {
                return i == name as usize;
            }
            if text.get(i) == Some(&b'*') {
                i += 1;
                continue;
            }
            let word = word_at(text, i);
            if !matches!(
                word,
                b"public"
                    | b"private"
                    | b"protected"
                    | b"static"
                    | b"abstract"
                    | b"override"
                    | b"readonly"
                    | b"declare"
                    | b"async"
                    | b"accessor"
                    | b"export"
                    | b"default"
                    | b"function"
                    | b"get"
                    | b"set"
                    | b"const"
                    | b"in"
                    | b"out"
            ) {
                return false;
            }
            i += word.len();
        }
    })
}

// ───────────────────────────── the grammar of signatures ─────────────────────────────

/// `checkGrammarTypeParameterList`: `<>`, which the summary has nothing of. (Not before an arrow function, where the parser refuses it.)
fn check_grammar_type_parameter_list(
    c: &Checker<'_>,
    hir: &hir::File,
    f: FnId,
    out: &mut Vec<Diagnostic>,
) -> bool {
    let (text, func) = (&hir.text[..], &hir[f]);
    if !func.type_params.is_empty()
        || func.kind == FnKind::Arrow
        || text.get(func.anchor as usize) != Some(&b'(')
    {
        return false;
    }
    let close = skip_trivia_back(text, func.anchor as usize);
    if !text[..close].ends_with(b">") {
        return false;
    }
    let open = skip_trivia_back(text, close - 1);
    if !text[..open].ends_with(b"<") {
        return false;
    }
    out.push(Diagnostic {
        start: open as u32 - 1,
        code: 1098,
    });
    c.note(open as u32 - 1, close as u32, 1098, vec![]);
    true
}

/// `checkGrammarParameterList`. Whether it objects to anything that ends the checks of the signature.
fn check_grammar_parameter_list(
    c: &Checker<'_>,
    file: FileId,
    f: FnId,
    out: &mut Vec<Diagnostic>,
) -> bool {
    let hir = c.hir(file);
    let (text, func) = (&hir.text[..], &hir[f]);
    let count = func.params.len();
    let mut seen_optional = false;
    for (i, p) in func.params.iter().enumerate() {
        let param = &hir[p];
        let name = hir[param.pat].pos;
        let question = question_token(hir, param.pat);
        if param.flags.contains(Flags::REST) {
            if i != count - 1 {
                let dots = skip_trivia_back(text, name as usize);
                if !text[..dots].ends_with(b"...") {
                    return false;
                }
                out.push(Diagnostic {
                    start: dots as u32 - 3,
                    code: 1014,
                });
                return true;
            }
            // Whether a signature without a body is ambient is not always known. One with a body is not.
            if !matches!(func.body, FnBody::None)
                && func.kind != FnKind::Arrow
                && text.get(func.anchor as usize) == Some(&b'(')
                && let Some(close) = end_of_brackets(text, func.anchor as usize)
            {
                let comma = skip_trivia_back(text, close - 1);
                if text[..comma].ends_with(b",") {
                    out.push(Diagnostic {
                        start: comma as u32 - 1,
                        code: 1013,
                    });
                }
            }
            if let Some(start) = question {
                out.push(Diagnostic { start, code: 1047 });
                return true;
            }
            if param.default.is_some() {
                out.push(Diagnostic {
                    start: name,
                    code: 1048,
                });
                c.note(name, c.end_of_pat(file, param.pat), 1048, vec![]);
                return true;
            }
        } else if question.is_some() || param.flags.contains(Flags::OPTIONAL) {
            seen_optional = true;
            // A `?` made from a `@param` tag is not written.
            if param.default.is_some() && !param.flags.contains(Flags::REPARSED) {
                out.push(Diagnostic {
                    start: name,
                    code: 1015,
                });
                c.note(name, c.end_of_pat(file, param.pat), 1015, vec![]);
                return true;
            }
        } else if seen_optional && param.default.is_none() {
            out.push(Diagnostic {
                start: name,
                code: 1016,
            });
            c.note(name, c.end_of_pat(file, param.pat), 1016, vec![]);
            return true;
        }
    }
    false
}

/// `checkGrammarArrowFunction`. `is_reserved`: the file is `.mts` or `.cts`, where `<T>() => x` could be taken for JSX.
fn check_grammar_arrow_function(
    c: &Checker<'_>,
    file: FileId,
    f: FnId,
    is_reserved: bool,
    out: &mut Vec<Diagnostic>,
) -> bool {
    let hir = c.hir(file);
    let (text, func) = (&hir.text[..], &hir[f]);
    if func.kind != FnKind::Arrow {
        return false;
    }
    if is_reserved && func.type_params.len() == 1 {
        let first = &hir[func.type_params.at(0)];
        let mut end = Some(first.pos as usize + word_at(text, first.pos as usize).len());
        if first.default.is_some() {
            end = end
                .map(|end| skip_trivia(text, end))
                .filter(|&equals| text.get(equals) == Some(&b'='))
                .and_then(|equals| skip_type(text, equals + 1));
        }
        if first.constraint.is_none()
            && let Some(end) = end
            && text.get(skip_trivia(text, end)) == Some(&b'>')
        {
            let start = first.start;
            out.push(Diagnostic { start, code: 7060 });
            let end = c.end_of_type_param(file, func.type_params.at(0));
            c.note(start, end, 7060, vec![]);
        }
    }
    // A line ends between what comes before the arrow and the arrow.
    let arrow = func.anchor as usize;
    if !text
        .get(arrow..)
        .is_some_and(|rest| rest.starts_with(b"=>"))
    {
        return false;
    }
    let mut i = arrow;
    let is_on_a_new_line = loop {
        while i > 0 && matches!(text[i - 1], b' ' | b'\t') {
            i -= 1;
        }
        if i > 0 && matches!(text[i - 1], b'\n' | b'\r') {
            break true;
        }
        match text[..i]
            .ends_with(b"*/")
            .then(|| text[..i - 2].windows(2).rposition(|w| w == b"/*"))
            .flatten()
        {
            Some(open) if has_line_break(text, open, i) => break true,
            Some(open) => i = open,
            None => break false,
        }
    };
    if is_on_a_new_line {
        out.push(Diagnostic {
            start: func.anchor,
            code: 1200,
        });
    }
    is_on_a_new_line
}

/// `FindUseStrictPrologue`, of the block that opens at `open`.
fn use_strict_prologue(text: &[u8], open: usize) -> Option<u32> {
    let mut i = open + 1;
    loop {
        let at = skip_trivia(text, i);
        if !matches!(text.get(at), Some(b'"' | b'\'')) {
            return None;
        }
        let end = skip_string(text, at)?;
        // Only a statement that is nothing but the string is a directive.
        let next = skip_trivia(text, end);
        match text.get(next) {
            Some(b';') => i = next + 1,
            Some(b'}') | None => i = next,
            Some(&b) if has_line_break(text, end, next) => {
                let goes_on = if is_identifier_part(b) {
                    matches!(word_at(text, next), b"in" | b"instanceof")
                } else {
                    !matches!(b, b'"' | b'\'' | b'{' | b'@' | b'#')
                };
                if goes_on {
                    return None;
                }
                i = next;
            }
            Some(_) => return None,
        }
        if matches!(&text[at..end], b"\"use strict\"" | b"'use strict'") {
            return Some(at as u32);
        }
    }
}

/// `checkGrammarForUseStrictSimpleParameterList`
fn check_use_strict_with_simple_parameters(
    c: &mut Checker<'_>,
    file: FileId,
    f: FnId,
    out: &mut Vec<Diagnostic>,
) -> bool {
    let hir = c.hir(file);
    let func = &hir[f];
    let is_simple = |p: ParamId| {
        hir[p].default.is_none()
            && matches!(hir[hir[p].pat].kind, PatKind::Ident(_))
            && !hir[p].flags.contains(Flags::REST)
    };
    if func.params.iter().all(is_simple) {
        return false;
    }
    let Some(directive) =
        written_body(hir, f).and_then(|open| use_strict_prologue(&hir.text, open))
    else {
        return false;
    };
    out.extend(
        func.params
            .iter()
            .filter(|&p| !is_simple(p))
            .map(|p| Diagnostic {
                start: hir[p].pos,
                code: 1346,
            }),
    );
    // The statement, with its `;`.
    let end = skip_string(&hir.text, directive as usize).map_or(0, |end| {
        let next = skip_trivia(&hir.text, end);
        if hir.text.get(next) == Some(&b';') {
            next + 1
        } else {
            end
        }
    }) as u32;
    for p in func.params.iter().filter(|&p| !is_simple(p)) {
        c.note(hir[p].pos, c.end_of_param(file, p), 1346, vec![]);
        c.relate(hir[p].pos, 1346, |_| {
            vec![super::explain::Related {
                at: Some((file, directive, end)),
                code: 1349,
                args: vec![],
            }]
        });
    }
    out.push(Diagnostic {
        start: directive,
        code: 1347,
    });
    c.note(directive, end, 1347, vec![]);
    c.relate(directive, 1347, |c| {
        func.params
            .iter()
            .filter(|&p| !is_simple(p))
            .enumerate()
            .map(|(i, p)| super::explain::Related {
                at: Some((file, hir[p].pos, c.end_of_param(file, p))),
                code: if i == 0 { 1348 } else { 6204 },
                args: vec![],
            })
            .collect()
    });
    true
}

/// `checkGrammarForGenerator`. `name`: where the name is, which the `*` comes before.
fn check_grammar_generator(
    hir: &hir::File,
    f: FnId,
    name: u32,
    is_ambient: bool,
    out: &mut Vec<Diagnostic>,
) -> bool {
    if !hir[f].flags.contains(Flags::GENERATOR) {
        return false;
    }
    let asterisk = skip_trivia_back(&hir.text, name as usize);
    if !hir.text[..asterisk].ends_with(b"*") {
        return false;
    }
    let code = if is_ambient {
        1221
    } else if !has_written_body(hir, f) {
        1222
    } else {
        return false;
    };
    out.push(Diagnostic {
        start: asterisk as u32 - 1,
        code,
    });
    true
}

impl Checker<'_> {
    pub(super) fn check_x_signatures(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        if hir.has_errors || hir.kind == FileKind::Json {
            return;
        }
        self.check_type_parameter_declarations(file, out);
        self.check_type_parameter_lists(file, out);
        self.check_variance_annotations(file, out);
        self.check_grammar_of_signatures(file, out);
        self.check_parameters_of_signatures(file, out);
        self.check_abstract_members_and_accessor_pairs(file, out);
        self.check_type_predicates(file, out);
        self.check_generator_return_types(file, out);
        self.check_promise_constructor_is_there(file, out);
        // `NodeFlagsAmbient`: all there is in a declaration file has it.
        if hir.kind != FileKind::Declaration {
            self.check_erasable_syntax(file, out);
        }
    }

    /// Whether `source` is known not to fit `target`.
    fn is_known_not_to_fit(&mut self, source: TypeId, target: TypeId) -> bool {
        if !self.is_known(source) || !self.is_known(target) {
            return false;
        }
        let gave_up_before = std::mem::replace(&mut self.relation_gave_up, false);
        let fits = self.is_assignable(source, target);
        let is_sure = !self.relation_gave_up;
        self.relation_gave_up |= gave_up_before;
        !fits && is_sure
    }

    // ───────────────────────────── type parameters ─────────────────────────────

    /// `checkTypeParameter`: 2716, 2344, 2368.
    fn check_type_parameter_declarations(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let has_defaults = hir.type_params.iter().any(|p| p.default.is_some());
        // In the order they are written: which parameter of a circle is the one to blame depends on where the circle is entered.
        let mut order: Vec<usize> = (0..hir.type_params.len())
            .filter(|&i| bound.type_param_symbol[i].is_some())
            .collect();
        order.sort_by_key(|&i| hir.type_params[i].pos);
        let mut resolution = DefaultResolution::default();
        for i in order {
            let (tp, decl) = (TypeParamId(i as u32), &hir.type_params[i]);
            if has_defaults {
                self.work_out_written_type(file, decl.constraint, &mut resolution, 0);
                self.work_out_written_type(file, decl.default, &mut resolution, 0);
            }
            if decl.default.is_some() {
                self.resolve_type_parameter_default((file, tp), &mut resolution, 0);
                let start = start_of_written_type(&hir.text, hir[decl.default].pos);
                if resolution.states.get(&(file, tp)) == Some(&DefaultState::Circular) {
                    out.push(Diagnostic { start, code: 2716 });
                    let end = self.end_of_type_node_from(file, decl.default, start);
                    self.explain_to(start, end, 2716, |c| {
                        let param = c.type_param(file, tp);
                        vec![c.type_to_string(param)]
                    });
                } else {
                    // `getConstraintOfTypeParameter`: another declaration of a merged class or interface may write the constraint.
                    let param = self.type_param(file, tp);
                    if let (Some(constraint), Some(default)) = (
                        self.constraint_of_type_param(param),
                        self.default_of_type_param(param),
                    ) {
                        let mapper = self.mapper_from(&[param], &[default]);
                        let constraint = self.instantiate(constraint, mapper);
                        let constraint = self.type_with_this_argument(constraint, default);
                        self.relations_too_deep.clear();
                        if self.is_known_not_to_fit(default, constraint) {
                            let end = self.end_of_type_node_from(file, decl.default, start);
                            self.check_type_assignable_to(
                                default,
                                constraint,
                                Some((file, start, end)),
                                Some(2344),
                            );
                        }
                        // `checkTypeRelatedToEx`: a comparison without an error node reports at `currentNode`, the declaration.
                        let too_deep = std::mem::take(&mut self.relations_too_deep);
                        if let Some(start) = name_of_type_parameter_owner(hir, tp) {
                            for (source, target) in too_deep {
                                let at = self.place_of_token(file, start);
                                self.error(at, 2321, &[Arg::Type(source), Arg::Type(target)]);
                            }
                        }
                        // Printing compares too.
                        self.relations_too_deep.clear();
                    }
                }
            }
            // `checkTypeNameIsReserved`
            if matches!(
                self.files().atoms.bytes(decl.name),
                b"any"
                    | b"unknown"
                    | b"never"
                    | b"number"
                    | b"bigint"
                    | b"boolean"
                    | b"string"
                    | b"symbol"
                    | b"void"
                    | b"object"
                    | b"undefined"
            ) {
                out.push(Diagnostic {
                    start: decl.pos,
                    code: 2368,
                });
            }
        }
    }

    /// `getResolvedTypeParameterDefault`: one that is asked for while it is being worked out is circular.
    fn resolve_type_parameter_default(
        &mut self,
        param: (FileId, TypeParamId),
        resolution: &mut DefaultResolution,
        depth: u32,
    ) {
        if let Some(state) = resolution.states.get_mut(&param) {
            if *state == DefaultState::Resolving {
                *state = DefaultState::Circular;
            }
            return;
        }
        resolution.states.insert(param, DefaultState::Resolving);
        let default = self.hir(param.0)[param.1].default;
        self.work_out_written_type(param.0, default, resolution, depth + 1);
        if let Some(state) = resolution.states.get_mut(&param)
            && *state == DefaultState::Resolving
        {
            *state = DefaultState::Resolved;
        }
    }

    /// `getTypeFromTypeNode`, for the defaults of type parameters it asks for: those a generic type is named without arguments for
    /// (`fillMissingTypeArguments`). Only what is looked into at once counts: not what is in an object type or a function type, nor
    /// what a type alias stands for, where such a reference waits until it is needed.
    fn work_out_written_type(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        resolution: &mut DefaultResolution,
        depth: u32,
    ) {
        if node.is_none() || depth > 64 || resolution.done.contains(&(file, node)) {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        match hir[node].kind {
            TypeNodeKind::Union(list) | TypeNodeKind::Intersection(list) => {
                for t in hir.ids(list) {
                    self.work_out_written_type(file, t, resolution, depth + 1);
                }
            }
            TypeNodeKind::Array(t) | TypeNodeKind::Keyof(t) | TypeNodeKind::Readonly(t) => {
                self.work_out_written_type(file, t, resolution, depth + 1)
            }
            TypeNodeKind::Tuple(elems) => {
                for e in elems.iter() {
                    self.work_out_written_type(file, hir[e].ty, resolution, depth + 1);
                }
            }
            TypeNodeKind::IndexedAccess { obj, index } => {
                self.work_out_written_type(file, obj, resolution, depth + 1);
                self.work_out_written_type(file, index, resolution, depth + 1);
            }
            TypeNodeKind::Ref { name, args } => {
                for t in hir.ids(args) {
                    self.work_out_written_type(file, t, resolution, depth + 1);
                }
                let names: Vec<Atom> = hir.texts(name).collect();
                let sym = self.files().resolve_entity(
                    file,
                    bound.type_scope[node.idx()],
                    &names,
                    SymFlags::TYPE,
                );
                if let Some(sym) = sym.and_then(|sym| self.files().resolve_alias_if_needed(sym)) {
                    let (least, most) = self.type_argument_arity(sym);
                    if (least..=most).contains(&args.len()) {
                        let params = self.type_params_of_symbol(sym);
                        for &param in params.iter().skip(args.len()) {
                            if let TypeData::TypeParam(of, tp, _) = *self.data(param) {
                                self.resolve_type_parameter_default(
                                    (of, tp),
                                    resolution,
                                    depth + 1,
                                );
                            }
                        }
                    }
                }
            }
            _ => {}
        }
        resolution.done.insert((file, node));
    }

    /// `checkTypeParameters` and `checkTypeParametersNotReferenced`: 2706, 2744.
    fn check_type_parameter_lists(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !hir.type_params.iter().any(|p| p.default.is_some()) {
            return;
        }
        let lists = hir
            .fns
            .iter()
            .map(|f| f.type_params)
            .chain(hir.classes.iter().map(|c| c.type_params))
            .chain(hir.interfaces.iter().map(|i| i.type_params))
            .chain(hir.aliases.iter().map(|a| a.type_params));
        // Each default, the list it is in and where in the list.
        let mut defaults: Vec<(TypeNodeId, Span<TypeParamId>, usize)> = Vec::new();
        for list in lists {
            if list.is_empty() || bound.type_param_symbol[list.start as usize].is_none() {
                continue;
            }
            let mut seen_default = false;
            for (index, p) in list.iter().enumerate() {
                let decl = &hir[p];
                if decl.default.is_some() {
                    seen_default = true;
                    defaults.push((decl.default, list, index));
                } else if seen_default {
                    let start = decl.start;
                    out.push(Diagnostic { start, code: 2706 });
                    let end = self.end_of_type_param(file, p);
                    self.explain_to(start, end, 2706, |_| vec![]);
                }
            }
        }
        if defaults.is_empty() {
            return;
        }
        defaults.sort_unstable_by_key(|d| d.0);
        let parents = Self::type_node_parents(hir, bound);
        for t in 0..hir.types.len() {
            let TypeNodeKind::Ref { name, .. } = hir.types[t].kind else {
                continue;
            };
            let scope = bound.type_scope[t];
            if name.len() != 1 || bound.is_unchecked_type(t) {
                continue;
            }
            let mut symbol = None;
            // Out through every default it is written in.
            let mut at = TypeNodeId(t as u32);
            while at.is_some() {
                if let Ok(found) = defaults.binary_search_by_key(&at, |d| d.0) {
                    let (_, list, index) = defaults[found];
                    let symbol = *symbol.get_or_insert_with(|| {
                        self.files()
                            .resolve_name(file, scope, hir[name.at(0)].text, SymFlags::TYPE)
                    });
                    if symbol.is_some_and(|symbol| {
                        list.iter().skip(index).any(|p| {
                            self.files().sym(file, bound.type_param_symbol[p.idx()]) == symbol
                        })
                    }) {
                        out.push(Diagnostic {
                            start: hir.types[t].pos,
                            code: 2744,
                        });
                        let end = self.end_of_type_node(file, TypeNodeId(t as u32));
                        self.explain_to(hir.types[t].pos, end, 2744, |_| vec![]);
                    }
                }
                at = parents[at.idx()];
            }
        }
    }

    /// `checkTypeParameterDeferred`: 2637, 2636.
    fn check_variance_annotations(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let has_annotations = hir
            .type_params
            .iter()
            .any(|p| p.flags.intersects(Flags::IN | Flags::OUT));
        if hir.type_params.is_empty() {
            return;
        }
        let aliases: &[hir::Alias] = if has_annotations { &hir.aliases } else { &[] };
        let aliases = aliases
            .iter()
            .enumerate()
            .map(|(a, alias)| (bound.alias_symbol[a], alias.type_params, true));
        let classes = hir
            .classes
            .iter()
            .enumerate()
            .map(|(c, class)| (bound.class_symbol[c], class.type_params, false));
        let interfaces = hir
            .interfaces
            .iter()
            .enumerate()
            .map(|(i, interface)| (bound.interface_symbol[i], interface.type_params, false));
        for (symbol, params, is_alias) in aliases.chain(classes).chain(interfaces) {
            if symbol.is_none() || params.is_empty() {
                continue;
            }
            // A file without annotations is still checked where a declaration in another file annotates the same type parameter.
            if !has_annotations && !bound.symbols[symbol.idx()].flags.contains(SymFlags::MERGED) {
                continue;
            }
            let sym = self.files().sym(file, symbol);
            // The declarations of a class or an interface share their type parameters, by name.
            let mut lists: Vec<(FileId, Span<TypeParamId>)> = Vec::new();
            if !is_alias {
                for (of, decl) in self.files().decls(sym) {
                    match decl {
                        Decl::Class(c) => lists.push((of, self.hir(of)[c].type_params)),
                        Decl::Interface(i) => lists.push((of, self.hir(of)[i].type_params)),
                        _ => {}
                    }
                }
            } else {
                // `SymbolFlagsTypeParameterExcludes`: two of one list that have the same name are one symbol.
                lists.push((file, params));
            }
            for tp in params.iter() {
                let decl = &hir[tp];
                // `getTypeParameterModifiers`: what any of its declarations says.
                let mut modifiers = decl.flags;
                for &(of, list) in &lists {
                    let other = self.hir(of);
                    modifiers = list
                        .iter()
                        .filter(|&p| other[p].name == decl.name)
                        .fold(modifiers, |all, p| all | other[p].flags);
                }
                let modifiers = modifiers & (Flags::IN | Flags::OUT);
                if modifiers.is_empty() {
                    continue;
                }
                let declared = self.declared_type(sym);
                if !self.is_known(declared) {
                    continue;
                }
                let start = decl.start;
                // `ObjectFlagsAnonymous | ObjectFlagsMapped`
                if is_alias
                    && !matches!(
                        self.data(declared),
                        TypeData::Anon { .. } | TypeData::Fns { .. } | TypeData::Synth(_)
                    )
                {
                    out.push(Diagnostic { start, code: 2637 });
                    // A name that is missing takes no room, and is where the token before it ends.
                    let is_nameless = (decl.name == known::empty || decl.name.is_none())
                        && decl.constraint.is_none()
                        && decl.default.is_none();
                    let end = if !is_nameless {
                        self.end_of_type_param(file, tp)
                    } else if start == decl.pos {
                        super::explain::NO_LENGTH
                    } else {
                        decl.pos
                    };
                    self.explain_to(start, end, 2637, |_| vec![]);
                    continue;
                }
                if modifiers == Flags::IN | Flags::OUT {
                    continue;
                }
                // `createMarkerType`. A reference to a class or an interface takes the outer type parameters first, and one of
                // them may have the same name.
                let own = self.type_param(file, tp);
                let all = if is_alias {
                    self.type_params_of_symbol(sym)
                } else {
                    self.all_type_params_of_symbol(sym)
                };
                let index = all.iter().rposition(|&p| {
                    self.type_param_decl(p)
                        .is_some_and(|(_, d)| d.name == decl.name)
                });
                let mut with = |marker: TypeId| {
                    if is_alias {
                        let mapper = self.mapper_from(&[own], &[marker]);
                        return self.instantiate(declared, mapper);
                    }
                    let mut args = all.to_vec();
                    if let Some(index) = index {
                        args[index] = marker;
                    }
                    self.intern(TypeData::Ref {
                        target: sym,
                        args: args.into(),
                    })
                };
                // The check has its own markers, so a variance measurement never reuses a relation cached here.
                let (sub, sup) = (
                    with(TypeId::MARKER_SUB_FOR_CHECK),
                    with(TypeId::MARKER_SUPER_FOR_CHECK),
                );
                let (source, target) = if modifiers == Flags::OUT {
                    (sub, sup)
                } else {
                    (sup, sub)
                };
                // `reportUnreliableWorker` ignores these markers. `report_unreliable` fires on every marker, so its flags are dropped.
                let reliability = self.reliability;
                let is_wrong = self.is_known_not_to_fit(source, target);
                self.reliability = reliability;
                if is_wrong {
                    out.push(Diagnostic { start, code: 2636 });
                    let end = self.end_of_type_param(file, tp);
                    // `c.varianceTypeParameter`: the markers go by its name for as long as this is put into words.
                    self.explain_to(start, end, 2636, |c| {
                        c.set_variance_type_parameter(Some(own));
                        let (source, target) = c.type_names_for_error_display(source, target);
                        vec![source, target]
                    });
                    self.explain_chain(start, 2636, |c| {
                        let relation = super::relate::Relation::Assignable;
                        let lines = c.relation_chain_under(source, target, relation, 2636);
                        c.set_variance_type_parameter(None);
                        lines
                    });
                }
            }
        }
    }

    // ───────────────────────────── signatures ─────────────────────────────

    /// Whether `f` is a member of a class or of an object literal, as opposed to one of an interface or a type literal.
    fn is_member_with_room_for_a_body(&self, file: FileId, f: FnId) -> bool {
        let bound = self.bound(file);
        match bound.fns[f.idx()].owner {
            FnOwner::Member(m) => matches!(bound.member_owner[m.idx()], MemberOwner::Class(_)),
            FnOwner::Expr(_) => true,
            _ => false,
        }
    }

    /// `checkGrammarFunctionLikeDeclaration`, and what those who call it go on to: `checkGrammarForGenerator`, `checkGrammarMethod`,
    /// `checkGrammarAccessor`, `checkGrammarConstructorTypeParameters`, `checkGrammarConstructorTypeAnnotation`.
    fn check_grammar_of_signatures(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let text = &hir.text[..];
        // Nothing is said of the grammar of a file that does not parse, and none of these checks then ends the others.
        let is_silent = has_parse_diagnostics(hir);
        let path = self.files().module(file).path.as_str();
        let is_reserved = path.ends_with(".mts") || path.ends_with(".cts");
        // `None`: it is not said, and is the latest.
        let target = self.p.files.options.target;
        let checks_use_strict = target == ScriptTarget::None || target >= ScriptTarget::ES2016;
        for i in 0..hir.fns.len() {
            let (f, func) = (FnId(i as u32), &hir.fns[i]);
            if matches!(bound.fns[i].owner, FnOwner::None)
                || matches!(func.kind, FnKind::StaticBlock | FnKind::IndexSignature)
            {
                continue;
            }
            let has_room_for_a_body = self.is_member_with_room_for_a_body(file, f);
            let is_named = func.name.is_some()
                || matches!(
                    func.kind,
                    FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor
                );
            let has_modifier_error = match bound.fns[i].owner {
                FnOwner::Stmt(s) => self
                    .grammar_error_in_modifiers(
                        file,
                        super::errors_grammar_modifiers::HasModifiers::Statement(s),
                    )
                    .is_some(),
                FnOwner::Member(m) => self
                    .grammar_error_in_modifiers(
                        file,
                        super::errors_grammar_modifiers::HasModifiers::Member(m),
                    )
                    .is_some(),
                _ => is_named && has_modifier_error(hir, func.name_pos),
            };
            let mut has_objected = !is_silent
                && (has_modifier_error
                    || check_grammar_type_parameter_list(self, hir, f, out)
                    || check_grammar_parameter_list(self, file, f, out)
                    || check_grammar_arrow_function(self, file, f, is_reserved, out));
            // `IsFunctionLikeDeclaration`
            let is_declaration = match func.kind {
                FnKind::Decl | FnKind::Expr | FnKind::Arrow | FnKind::Constructor => true,
                FnKind::Method | FnKind::Getter | FnKind::Setter => has_room_for_a_body,
                _ => false,
            };
            if !has_objected && is_declaration && checks_use_strict {
                has_objected = check_use_strict_with_simple_parameters(self, file, f, out);
            }
            if is_silent {
                continue;
            }
            let is_ambient = func.flags.contains(Flags::AMBIENT);
            match func.kind {
                FnKind::Decl if func.name.is_some() => {
                    check_grammar_generator(hir, f, func.name_pos, is_ambient, out);
                }
                FnKind::Method if has_room_for_a_body && !has_objected => {
                    // `{ m(); }`
                    if matches!(bound.fns[i].owner, FnOwner::Expr(_)) && !has_written_body(hir, f) {
                        if let Some(start) = self.end_of_bodiless_declaration(file, f) {
                            out.push(Diagnostic { start, code: 1005 });
                            self.explain_to(start, start + 1, 1005, |_| vec!["{".to_owned()]);
                        }
                        continue;
                    }
                    check_grammar_generator(hir, f, func.name_pos, is_ambient, out);
                }
                FnKind::Getter | FnKind::Setter if has_room_for_a_body && !has_objected => {
                    let is_abstract = func.flags.contains(Flags::ABSTRACT);
                    if has_written_body(hir, f) {
                        if is_abstract {
                            out.push(Diagnostic {
                                start: func.name_pos,
                                code: 1318,
                            });
                            let end = self.end_of_name_at(file, func.name_pos);
                            self.explain_to(func.name_pos, end, 1318, |_| vec![]);
                        }
                    } else if !is_ambient
                        && !is_abstract
                        && let Some(start) = self.end_of_bodiless_declaration(file, f)
                    {
                        out.push(Diagnostic { start, code: 1005 });
                        self.explain_to(start, start + 1, 1005, |_| vec!["{".to_owned()]);
                    }
                }
                FnKind::Constructor => {
                    // The type parameters come between the name and the `(`.
                    let name = func.name_pos as usize;
                    let after_name = match text.get(name) {
                        Some(b'"' | b'\'') => skip_string(text, name),
                        _ => Some(name + word_at(text, name).len()),
                    };
                    let less_than = after_name
                        .map(|end| skip_trivia(text, end))
                        .filter(|&at| text.get(at) == Some(&b'<'));
                    if let Some(less_than) = less_than {
                        let first = skip_trivia(text, less_than + 1);
                        let start = if text.get(first) == Some(&b'>') {
                            less_than + 1
                        } else {
                            first
                        };
                        out.push(Diagnostic {
                            start: start as u32,
                            code: 1092,
                        });
                        // The list ends with its last parameter or the comma after that.
                        let end = skip_angle_brackets(text, less_than)
                            .map_or(0, |past| skip_trivia_back(text, past - 1));
                        let end = if end == start {
                            super::explain::NO_LENGTH
                        } else {
                            end as u32
                        };
                        self.explain_to(start as u32, end, 1092, |_| vec![]);
                    } else if func.ret.is_some() {
                        let start = start_of_written_type(text, hir[func.ret].pos);
                        out.push(Diagnostic { start, code: 1093 });
                        let end = self.end_of_type_node_from(file, func.ret, start);
                        self.explain_to(start, end, 1093, |_| vec![]);
                    } else if text.get(func.anchor as usize) == Some(&b'(')
                        && let Some(close) = end_of_brackets(text, func.anchor as usize)
                        && text.get(skip_trivia(text, close)) == Some(&b':')
                    {
                        let colon = skip_trivia(text, close);
                        let start = skip_trivia(text, colon + 1) as u32;
                        out.push(Diagnostic { start, code: 1093 });
                        let end = skip_type(text, colon + 1).map_or(0, |end| end as u32);
                        self.explain_to(start, end, 1093, |_| vec![]);
                    }
                }
                _ => {}
            }
        }
    }

    /// `node.End() - 1`, of a method or an accessor that is written without a body: the `;` after it, or else the last of it.
    fn end_of_bodiless_declaration(&self, file: FileId, f: FnId) -> Option<u32> {
        let hir = self.hir(file);
        let end = end_of_signature(hir, f)?;
        let next = skip_trivia(&hir.text, end);
        let last = if hir.text.get(next) == Some(&b';') {
            next
        } else {
            end - 1
        };
        Some(last as u32)
    }

    /// `checkParameter`: 1294, 2398, 2681, 2784.
    fn check_parameters_of_signatures(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `shouldCheckErasableSyntax`
        let is_erasable_only = self.p.files.options.erasable_syntax_only && !hir.is_js;
        // 2730 is the parser's to say, and the `this` parameter of an arrow function is not kept. It is said of all of the parameter.
        if self.explains {
            for &(start, code) in hir.checker_errors.iter() {
                if code == 2730 && !hir.is_in_jsdoc(start) {
                    let end = end_of_written_parameter(self, file, start);
                    self.note(start, end, code, Vec::new());
                }
            }
        }
        for i in 0..hir.fns.len() {
            let func = &hir.fns[i];
            if matches!(bound.fns[i].owner, FnOwner::None) {
                continue;
            }
            for p in func.params.iter() {
                let param = &hir[p];
                if !param.flags.contains(Flags::PARAMETER_PROPERTY) {
                    continue;
                }
                if is_erasable_only {
                    out.push(Diagnostic {
                        start: param.pos,
                        code: 1294,
                    });
                    let end = self.end_of_param(file, p);
                    self.explain_to(param.pos, end, 1294, |_| vec![]);
                }
                if func.kind == FnKind::Constructor
                    && matches!(hir[param.pat].kind, PatKind::Ident(known::constructor))
                {
                    out.push(Diagnostic {
                        start: hir[param.pat].pos,
                        code: 2398,
                    });
                }
            }
            let code = match func.kind {
                FnKind::Constructor | FnKind::ConstructSignature | FnKind::ConstructorType => 2681,
                FnKind::Getter | FnKind::Setter => 2784,
                _ => continue,
            };
            if let Some(start) = this_parameter(hir, FnId(i as u32)) {
                out.push(Diagnostic { start, code });
                if func.this_ty(hir).is_some() {
                    let ty = start_of_written_type(&hir.text, hir[func.this_ty(hir)].pos);
                    let end = self.end_of_type_node_from(file, func.this_ty(hir), ty);
                    self.explain_to(start, end, code, |_| vec![]);
                }
            }
            // A `this` that is not the first parameter is listed in `params`.
            let is_this =
                |p: &ParamId| matches!(hir[hir[*p].pat].kind, PatKind::Ident(known::this));
            out.extend(func.params.iter().filter(is_this).map(|p| Diagnostic {
                start: hir[p].pos,
                code,
            }));
            for p in func.params.iter().filter(is_this) {
                let end = self.end_of_param(file, p);
                self.explain_to(hir[p].pos, end, code, |_| vec![]);
            }
        }
    }

    /// `checkPropertyDeclaration`: 1267. `checkMethodDeclaration`: 1245. `checkAccessorDeclaration`: 2676, 2808.
    fn check_abstract_members_and_accessor_pairs(
        &mut self,
        file: FileId,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for c in 0..hir.classes.len() {
            if bound.class_symbol[c].is_none() {
                continue;
            }
            let members = hir.classes[c].members;
            let mut may_disagree = false;
            for m in members.iter() {
                let member = &hir[m];
                match member.kind {
                    MemberKind::Property
                        if member.flags.contains(Flags::ABSTRACT) && member.init.is_some() =>
                    {
                        out.push(Diagnostic {
                            start: member.name_pos,
                            code: 1267,
                        });
                        let end = self.end_of_member_name(file, m);
                        self.explain_to(member.name_pos, end, 1267, |c| {
                            vec![c.source_text(file, member.name_pos, end)]
                        });
                    }
                    MemberKind::Method
                        if member.flags.contains(Flags::ABSTRACT)
                            && member.func.is_some()
                            && has_written_body(hir, member.func) =>
                    {
                        out.push(Diagnostic {
                            start: member.name_pos,
                            code: 1245,
                        });
                        let end = self.end_of_member_name(file, m);
                        self.explain_to(member.name_pos, end, 1245, |c| {
                            vec![c.source_text(file, member.name_pos, end)]
                        });
                    }
                    MemberKind::Getter | MemberKind::Setter => {
                        may_disagree |= member
                            .flags
                            .intersects(Flags::ABSTRACT | Flags::PRIVATE | Flags::PROTECTED)
                    }
                    _ => {}
                }
            }
            if !may_disagree {
                continue;
            }
            for getter in members.iter() {
                if hir[getter].kind != MemberKind::Getter {
                    continue;
                }
                // `GetDeclarationOfKind(symbol, KindSetAccessor)`
                let declaration = Decl::Member(getter);
                let setter = self
                    .declarations_of_member(file, declaration)
                    .into_iter()
                    .find_map(|declaration| match declaration {
                        (of, Decl::Member(m))
                            if of == file && hir[m].kind == MemberKind::Setter =>
                        {
                            Some(m)
                        }
                        _ => None,
                    });
                let Some(setter) = setter else {
                    continue;
                };
                let (get, set) = (hir[getter].flags, hir[setter].flags);
                let mut both = |code: u32| {
                    for m in [getter, setter] {
                        out.push(Diagnostic {
                            start: hir[m].name_pos,
                            code,
                        });
                        self.note(
                            hir[m].name_pos,
                            self.end_of_member_name(file, m),
                            code,
                            vec![],
                        );
                    }
                };
                if get.contains(Flags::ABSTRACT) != set.contains(Flags::ABSTRACT) {
                    both(2676);
                }
                if get.contains(Flags::PROTECTED)
                    && !set.intersects(Flags::PROTECTED | Flags::PRIVATE)
                    || get.contains(Flags::PRIVATE) && !set.contains(Flags::PRIVATE)
                {
                    both(2808);
                }
            }
        }
    }

    // ───────────────────────────── what is returned ─────────────────────────────

    /// `checkTypePredicate`: 1228, 1229, 2677, 1230, 1225.
    fn check_type_predicates(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if hir.types.is_empty() {
            return;
        }
        let text = &hir.text[..];
        let asserts_word = self.files().atoms.lookup(b"asserts");
        // What each function says it returns, and the function. Sorted.
        let mut returning: Option<Vec<(TypeNodeId, usize)>> = None;
        for t in 0..hir.types.len() {
            if bound.is_unchecked_type(t) {
                continue;
            }
            let (param, ty, asserts) = match hir.types[t].kind {
                TypeNodeKind::Predicate { param, ty, asserts } => (param, ty, asserts),
                // `this is T` is a predicate wherever a type can be written. Only where a function says what it returns is it kept as one.
                TypeNodeKind::Keyword(Keyword::This) => {
                    let end = hir.types[t].pos as usize + 4;
                    let next = skip_trivia(text, end);
                    if word_at(text, next) == b"is" && !has_line_break(text, end, next) {
                        let start = hir.types[t].pos;
                        out.push(Diagnostic { start, code: 1228 });
                        let end = skip_type(text, start as usize).map_or(0, |end| end as u32);
                        self.explain_to(start, end, 1228, |_| vec![]);
                    }
                    continue;
                }
                // So is `asserts x`, which is kept as a type by the name of `asserts` elsewhere.
                TypeNodeKind::Ref { name, args }
                    if name.len() == 1
                        && args.is_empty()
                        && Some(hir[name.at(0)].text) == asserts_word =>
                {
                    let end = hir.types[t].pos as usize + 7;
                    let next = skip_trivia(text, end);
                    let word = word_at(text, next);
                    if !word.is_empty()
                        && !word[0].is_ascii_digit()
                        && word != b"extends"
                        && !has_line_break(text, end, next)
                    {
                        let start = hir.types[t].pos;
                        out.push(Diagnostic { start, code: 1228 });
                        let end = skip_type(text, start as usize).map_or(0, |end| end as u32);
                        self.explain_to(start, end, 1228, |_| vec![]);
                    }
                    continue;
                }
                _ => continue,
            };
            // `getTypePredicateParent`
            let node = TypeNodeId(t as u32);
            let sorted = returning.get_or_insert_with(|| {
                let mut all: Vec<(TypeNodeId, usize)> = hir
                    .fns
                    .iter()
                    .enumerate()
                    .map(|(f, func)| (func.ret, f))
                    .collect();
                all.sort_unstable();
                all
            });
            let first = sorted.partition_point(|r| r.0 < node);
            let parent = sorted.get(first).filter(|r| r.0 == node).map(|r| r.1);
            let parent = parent.filter(|&f| {
                matches!(
                    hir.fns[f].kind,
                    FnKind::Arrow
                        | FnKind::CallSignature
                        | FnKind::Decl
                        | FnKind::Expr
                        | FnKind::FunctionType
                        | FnKind::Method
                )
            });
            let Some(parent) = parent else {
                out.push(Diagnostic {
                    start: hir.types[t].pos,
                    code: 1228,
                });
                let end = self.end_of_type_node(file, node);
                self.explain_to(hir.types[t].pos, end, 1228, |_| vec![]);
                continue;
            };
            if param == known::this {
                continue;
            }
            // The parameter name is the first word of the node, or the one after `asserts`.
            let start = hir.types[t].pos;
            let name_pos = if asserts {
                skip_trivia(text, start as usize + b"asserts".len()) as u32
            } else {
                start
            };
            let params = hir.fns[parent].params;
            let Some(index) = params.iter().position(
                |p| matches!(hir[hir[p].pat].kind, PatKind::Ident(name) if name == param),
            ) else {
                // `checkIfTypePredicateVariableIsDeclaredInBindingPattern`
                let mut names = Vec::new();
                params
                    .iter()
                    .for_each(|p| names_bound_by(hir, hir[p].pat, &mut names));
                let is_in_pattern = names.iter().any(|&(name, _)| name == param);
                out.push(Diagnostic {
                    start: name_pos,
                    code: if is_in_pattern { 1230 } else { 1225 },
                });
                continue;
            };
            let p = params.at(index);
            if hir[p].flags.contains(Flags::REST) && index == params.len() - 1 {
                out.push(Diagnostic {
                    start: name_pos,
                    code: 1229,
                });
                continue;
            }
            if ty.is_none() {
                continue;
            }
            if hir[p].ty.is_none() {
                self.prepare_fn(file, FnId(parent as u32));
            }
            let (narrowed, declared) = (self.type_from_node(file, ty), self.type_of_param(file, p));
            if self.is_known_not_to_fit(narrowed, declared) {
                let start = start_of_written_type(text, hir[ty].pos);
                out.push(Diagnostic { start, code: 2677 });
                let end = self.end_of_type_node_from(file, ty, start);
                self.explain_to(start, end, 2677, |_| vec![]);
                self.explain_chain(start, 2677, |c| {
                    c.assignability_lines(narrowed, declared, 1)
                });
                self.relate(start, 2677, |c| c.assignability_related(narrowed, declared));
            }
        }
    }

    /// From `checkSignatureDeclaration`: 2505.
    fn check_generator_return_types(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for i in 0..hir.fns.len() {
            let (f, func) = (FnId(i as u32), &hir.fns[i]);
            if !func.flags.contains(Flags::GENERATOR)
                || func.ret.is_none()
                || matches!(bound.fns[i].owner, FnOwner::None)
            {
                continue;
            }
            let is_declaration = matches!(func.kind, FnKind::Decl | FnKind::Expr)
                || func.kind == FnKind::Method && self.is_member_with_room_for_a_body(file, f);
            if is_declaration
                && has_written_body(hir, f)
                && self.type_from_node(file, func.ret) == TypeId::VOID
            {
                let start = start_of_written_type(&hir.text, hir[func.ret].pos);
                out.push(Diagnostic { start, code: 2505 });
                let end = self.end_of_type_node_from(file, func.ret, start);
                self.explain_to(start, end, 2505, |_| vec![]);
            }
        }
    }

    /// `checkAsyncFunctionReturnType`: 1064, or 1058 1062.
    pub(super) fn check_async_function_return_type(&mut self, file: FileId, f: FnId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let func = &hir[f];
        if func.ret.is_none()
            || !func.flags.contains(Flags::ASYNC)
            || func.flags.contains(Flags::GENERATOR)
            || matches!(bound.fns[f.idx()].owner, FnOwner::None)
            || !(matches!(func.kind, FnKind::Decl | FnKind::Expr | FnKind::Arrow)
                || func.kind == FnKind::Method && self.is_member_with_room_for_a_body(file, f))
        {
            return;
        }
        let ret = self.type_from_node(file, func.ret);
        if !self.is_known(ret) || self.is_error_type(ret) {
            return;
        }
        if self.global_type_symbol(known::Promise).is_some()
            && self.is_global_ref(ret, known::Promise).is_none()
        {
            let start = start_of_written_type(&hir.text, hir[func.ret].pos);
            let end = self.end_of_type_node_from(file, func.ret, start);
            let awaited = self.awaited_no_alias(ret).unwrap_or(TypeId::VOID);
            self.error((file, start, end), 1064, &[Arg::Type(awaited)]);
            return;
        }
        self.check_awaited_type(
            ret,
            false,
            self.place_of_signature_declaration(file, f),
            1058,
        );
    }

    /// `createPromiseReturnType`, where there is a `Promise` to name as a type but none to make one with: 2712, 2705.
    fn check_promise_constructor_is_there(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        if self.global_type_symbol(known::Promise).is_none()
            || self
                .files()
                .global(known::Promise, SymFlags::VALUE)
                .is_some()
        {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let by_kind = self.exprs_by_kind(file);
        for &id in by_kind.of(ExprTag::ImportCall) {
            let e = &hir[id];
            if !bound.is_unchecked(id.idx()) && word_at(&hir.text, e.pos as usize) == b"import" {
                out.push(Diagnostic {
                    start: e.pos,
                    code: 2712,
                });
                let end = self.end_inside_parentheses(file, id);
                self.explain_to(e.pos, end, 2712, |_| vec![]);
                // `getGlobalPromiseConstructorSymbol`
                self.report_global_error(2468, vec!["Promise".to_owned()]);
            }
        }
        // `getReturnTypeFromBody` only gets there for a function that returns nothing, calls of itself aside.
        for i in 0..hir.fns.len() {
            let (f, func) = (FnId(i as u32), &hir.fns[i]);
            let info = &bound.fns[i];
            if !func.flags.contains(Flags::ASYNC)
                || func.flags.contains(Flags::GENERATOR)
                || func.ret.is_some()
                || !matches!(func.body, FnBody::Block(_))
                || bound.ids(info.returns).any(|s| match hir[s].kind {
                    StmtKind::Return(e) if e.is_some() => match hir[e].kind {
                        ExprKind::Await(operand) => !is_call_of_itself(hir, bound, f, operand),
                        _ => !is_call_of_itself(hir, bound, f, e),
                    },
                    _ => false,
                })
            {
                continue;
            }
            // What it returns has to be asked for: it always is of an expression, by a `return`, and by a call.
            let is_asked = match (func.kind, info.owner) {
                (FnKind::Expr | FnKind::Arrow | FnKind::Method, FnOwner::Expr(_)) => true,
                (FnKind::Decl | FnKind::Method, FnOwner::Stmt(_) | FnOwner::Member(_))
                    if !info.returns.is_empty() =>
                {
                    true
                }
                (FnKind::Decl, FnOwner::Stmt(_)) => {
                    let symbol = bound.fn_symbol[i];
                    symbol.is_some()
                        && bound.symbols[symbol.idx()].decls.len() == 1
                        && hir.exprs.iter().any(|e| {
                            matches!(e.kind, ExprKind::Call(call) if matches!(hir[hir[call].callee].kind, ExprKind::Ident(_)) && bound.expr_symbol[hir[call].callee.idx()] == symbol)
                        })
                }
                _ => false,
            };
            if is_asked {
                let (start, end) = self.error_range_of_fn(file, f);
                out.push(Diagnostic { start, code: 2705 });
                self.explain_to(start, end, 2705, |_| vec![]);
                self.report_global_error(2468, vec!["Promise".to_owned()]);
            }
        }
    }

    // ───────────────────────────── erasableSyntaxOnly ─────────────────────────────

    /// 1294, from `checkEnumDeclaration`, `checkModuleDeclaration`, `checkImportEqualsDeclaration`, `checkExportAssignment` and
    /// `checkAssertion`. (`checkParameter` has its own.)
    fn check_erasable_syntax(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `shouldCheckErasableSyntax`
        if !self.p.files.options.erasable_syntax_only || hir.is_js {
            return;
        }
        let text = &hir.text[..];
        // `ShouldPreserveConstEnums`
        let preserves_const_enums =
            self.p.files.options.preserve_const_enums || self.p.files.options.isolated_modules;
        for (i, s) in hir.stmts.iter().enumerate() {
            let parent = bound.stmt_parent[i];
            // `checkGrammarModuleElementContext`: elsewhere something else is wrong, and that is all that is said.
            let is_module_element = matches!(parent, Parent::File | Parent::Module(_));
            let start = match s.kind {
                StmtKind::Enum(e)
                    if !matches!(parent, Parent::None)
                        && !hir[e].flags.contains(Flags::AMBIENT) =>
                {
                    hir[e].name_pos
                }
                StmtKind::Module(m)
                    if is_module_element
                        && !hir[m].flags.contains(Flags::AMBIENT)
                        && matches!(hir[m].name, ModuleName::Ident(_)) =>
                {
                    if !bound.is_instantiated_module(m, preserves_const_enums) {
                        continue;
                    }
                    hir[m].name_pos
                }
                StmtKind::ImportEquals(x)
                    if is_module_element && !hir[x].flags.contains(Flags::AMBIENT) =>
                {
                    s.pos
                }
                // `NodeFlagsAmbient`: in an ambient module or anywhere in a declaration file.
                StmtKind::ExportAssign(_)
                    if is_module_element
                        && hir.kind != FileKind::Declaration
                        && !matches!(parent, Parent::Module(m) if hir[m].flags.contains(Flags::AMBIENT)) =>
                {
                    s.pos
                }
                _ => continue,
            };
            out.push(Diagnostic { start, code: 1294 });
            // An enum and a namespace are pointed at by their names.
            if matches!(
                s.kind,
                StmtKind::ImportEquals(_) | StmtKind::ExportAssign(_)
            ) {
                let end = self.end_of_stmt(file, StmtId(i as u32));
                self.explain_to(start, end, 1294, |_| vec![]);
            }
        }
        // `<T>e`, from the `<`.
        let by_kind = self.exprs_by_kind(file);
        let assertions = by_kind.of(ExprTag::As).iter();
        for &id in assertions.chain(by_kind.of(ExprTag::AsConst)) {
            let e = &hir[id];
            if bound.is_unchecked(id.idx()) {
                continue;
            }
            // Where the `<` ends, and the `>`.
            let (less_than, close) = match e.kind {
                // The type comes before the operand. In `x as T` it comes after.
                ExprKind::As { expr, ty } if hir[ty].pos < hir[expr].pos => (
                    skip_trivia_back(text, start_of_written_type(text, hir[ty].pos) as usize),
                    skip_trivia_back(text, self.start_of(file, expr) as usize),
                ),
                ExprKind::AsConst(operand) => {
                    let close = skip_trivia_back(text, self.start_of(file, operand) as usize);
                    if !text[..close].ends_with(b">") {
                        continue;
                    }
                    let word = skip_trivia_back(text, close - 1);
                    if word_before(text, word) != b"const" {
                        continue;
                    }
                    (skip_trivia_back(text, word - 5), close)
                }
                _ => continue,
            };
            if text[..less_than].ends_with(b"<") {
                out.push(Diagnostic {
                    start: less_than as u32 - 1,
                    code: 1294,
                });
                self.explain_to(less_than as u32 - 1, close as u32, 1294, |_| vec![]);
            }
        }
    }
}

/// Whether `e` calls the function `f` by its own name, which says nothing about what `f` returns.
fn is_call_of_itself(hir: &hir::File, bound: &Bound, f: FnId, e: ExprId) -> bool {
    let symbol = bound.fn_symbol[f.idx()];
    symbol.is_some()
        && matches!(hir[e].kind, ExprKind::Call(call) if matches!(hir[hir[call].callee].kind, ExprKind::Ident(_)) && bound.expr_symbol[hir[call].callee.idx()] == symbol)
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum DefaultState {
    Resolving,
    Resolved,
    Circular,
}

/// How far `getResolvedTypeParameterDefault` has got with each type parameter it was asked about, and the types written whose
/// working out is over and done with.
#[derive(Default)]
struct DefaultResolution {
    states: FxHashMap<(FileId, TypeParamId), DefaultState>,
    done: FxHashSet<(FileId, TypeNodeId)>,
}
