//! Errors that oxc reports and TypeScript's parser doesn't.
//!
//! TypeScript's parser accepts `function f(a?, b) {}` or `declare let a = 1` and leaves the error to the checker
//! (`checkGrammar*`). oxc has no checker, so its parser and its scope-building pass report these errors, and oxlint
//! doesn't lint such a file. `Dialect::oxc` enables the same errors here. oxc has one parser for both languages, so
//! most of them are errors in a JavaScript file too, where it also reports TypeScript-only modifiers.
//!
//! The parser calls into this file from the point where it has everything it needs, behind a test that ordinary code
//! fails, so a file without such an error only pays for a few branches. The slow code is out of line and not generic.
//!
//! Every condition, message and label was checked against oxlint 1.87.
//!
//! How an error is encoded ([`DiagnosticKind::Oxc`]):
//! - `code`: the number in `TS(1016)`, or 0.
//! - `start`, `end`: the first label.
//! - `args`: the message, the help, and the first label's text. The last two are optional.
//! - `related`: the other labels, each with its text as its only argument. An entry without arguments isn't a label. It
//!   means oxc reports the error when its parser reaches that entry's `start`, which determines where oxlint prints it.

use super::Parser;
use bun_sema::check::spans::{skip_trivia, skip_trivia_back, token_end};
use bun_sema::hir::*;

const ACCESSIBILITY: Flags = Flags::PUBLIC.union(Flags::PRIVATE).union(Flags::PROTECTED);
const PARAMETER_PROPERTY: Flags = ACCESSIBILITY.union(Flags::READONLY).union(Flags::OVERRIDE);
/// The modifiers that JavaScript has.
const JAVASCRIPT: Flags = Flags::STATIC
    .union(Flags::ASYNC)
    .union(Flags::ACCESSOR)
    .union(Flags::EXPORT)
    .union(Flags::DEFAULT);
const METHOD: Flags = ACCESSIBILITY
    .union(Flags::STATIC)
    .union(Flags::ABSTRACT)
    .union(Flags::OVERRIDE)
    .union(Flags::ASYNC);

/// oxc's `ModifierKind`, in oxc's order. A help text lists modifiers in this order, and when several earlier modifiers
/// conflict with one, the message names the first in this order.
const MODIFIERS: [Flags; 15] = [
    Flags::AMBIENT,
    Flags::PRIVATE,
    Flags::PROTECTED,
    Flags::PUBLIC,
    Flags::STATIC,
    Flags::READONLY,
    Flags::ABSTRACT,
    Flags::OVERRIDE,
    Flags::ASYNC,
    Flags::CONST,
    Flags::IN,
    Flags::OUT,
    Flags::DEFAULT,
    Flags::ACCESSOR,
    Flags::EXPORT,
];

type Errors = Vec<Diagnostic>;

/// The label `start..end`. An empty label stays empty.
fn label(start: u32, end: u32) -> (u32, u32) {
    match end <= start {
        true => (start, Diagnostic::NO_LENGTH),
        false => (start, end),
    }
}

fn error(code: u32, at: (u32, u32), message: &str, help: &str) -> Diagnostic {
    error_with_text(code, at, message.as_bytes(), help)
}

/// `error` with a message that quotes the source.
#[inline(never)]
fn error_with_text(code: u32, at: (u32, u32), message: &[u8], help: &str) -> Diagnostic {
    let texts = [message, help.as_bytes()];
    Diagnostic::new(DiagnosticKind::Oxc, label(at.0, at.1), code, &texts)
}

/// An error at which oxc's parser gives up.
fn fatal(at: (u32, u32), message: &str) -> Diagnostic {
    Diagnostic {
        kind: DiagnosticKind::OxcFatal,
        ..error(0, at, message, "")
    }
}

fn unexpected(at: (u32, u32)) -> Diagnostic {
    fatal(at, "Unexpected token")
}

/// oxc's parser gives up at `at`, where it expected `wanted` but found `found` (oxc's name for the token).
fn expected(wanted: &str, found: &[u8], at: (u32, u32)) -> Diagnostic {
    let texts: [&[u8]; 5] = [
        b"Expected `",
        wanted.as_bytes(),
        b"` but found `",
        found,
        b"`",
    ];
    let message = texts.concat();
    let label_text = format!("`{wanted}` expected");
    let texts = [&message[..], b"", label_text.as_bytes()];
    Diagnostic::new(DiagnosticKind::OxcFatal, label(at.0, at.1), 0, &texts)
}

/// `expected` for the token at `at`, which is a punctuator or a non-keyword name.
fn expected_at(wanted: &str, src: &[u8], at: u32) -> Diagnostic {
    let end = token_end(src, at as usize, false) as u32;
    let text = src.get(at as usize..end as usize).unwrap_or_default();
    let found: &[u8] = match text.first() {
        None => b"EOF",
        Some(b'a'..=b'z' | b'A'..=b'Z' | b'_' | b'$' | 0x80..) => b"Identifier",
        Some(_) => text,
    };
    expected(wanted, found, (at, end))
}

/// oxc's parser treats what ends at `after` as a complete statement and gives up at what follows on the same line.
fn missing_semicolon(after: u32) -> Diagnostic {
    let message = "Expected a semicolon or an implicit semicolon after a statement, but found none";
    Diagnostic {
        kind: DiagnosticKind::OxcFatal,
        ..error(0, (after, after), message, "Try inserting a semicolon here")
    }
}

/// An error from oxc's scope-building pass.
fn semantic(code: u32, at: (u32, u32), message: &str) -> Diagnostic {
    Diagnostic {
        kind: DiagnosticKind::OxcSemantic,
        ..error(code, at, message, "")
    }
}

/// oxc reports `error` when its parser has read up to `now`, which is after the label.
#[inline(never)]
fn noticed_at(mut error: Diagnostic, now: u32) -> Diagnostic {
    let marker = Diagnostic::new(error.kind, (now, now), 0, &[]);
    error.related.push(marker);
    error
}

/// Adds the first label's text and a second label.
fn with_labels(mut error: Diagnostic, first: &str, at: (u32, u32), second: &str) -> Diagnostic {
    let mut texts = std::mem::take(&mut error.args).into_vec();
    texts.push(first.as_bytes().into());
    error.args = texts.into();
    let second = [second.as_bytes()];
    error
        .related
        .push(Diagnostic::new(error.kind, label(at.0, at.1), 0, &second));
    error
}

/// The help under an error about a modifier.
#[derive(Copy, Clone)]
enum Help {
    None,
    Text(&'static str),
    /// Lists the modifiers that are allowed there.
    Allowed(Flags),
}

impl Help {
    fn text(self) -> String {
        let allowed = match self {
            Help::None => return String::new(),
            Help::Text(text) => return text.to_owned(),
            Help::Allowed(allowed) => allowed,
        };
        let mut names = MODIFIERS
            .iter()
            .filter(|&&it| allowed.contains(it))
            .map(|&it| modifier_text(it));
        match (names.next(), allowed.bits().count_ones()) {
            (None, _) => "No modifiers are allowed here.".to_owned(),
            (Some(only), 1) => format!("Only '{only}' modifier is allowed here."),
            (Some(first), _) => names
                .fold(format!("Allowed modifiers are: {first}"), |list, it| {
                    list + ", " + it
                }),
        }
    }
}

/// `'readonly' modifier <rest>`, at the modifier.
fn about_modifier(code: u32, (modifier, pos): (Flags, u32), rest: &str, help: Help) -> Diagnostic {
    let name = modifier_text(modifier);
    let message = format!("'{name}' modifier {rest}");
    error(code, (pos, pos + name.len() as u32), &message, &help.text())
}

/// oxc's `ILLEGAL_PRECEDING_MODIFIERS`
fn cannot_precede(modifier: Flags) -> Flags {
    let others = if ACCESSIBILITY.contains(modifier) {
        ACCESSIBILITY
            | Flags::OVERRIDE
            | Flags::STATIC
            | Flags::ACCESSOR
            | Flags::READONLY
            | Flags::ASYNC
            | Flags::ABSTRACT
    } else if modifier == Flags::STATIC {
        Flags::READONLY | Flags::ASYNC | Flags::ACCESSOR | Flags::OVERRIDE | Flags::ABSTRACT
    } else if modifier == Flags::OVERRIDE {
        Flags::READONLY | Flags::ACCESSOR | Flags::ASYNC | Flags::AMBIENT
    } else if modifier == Flags::ABSTRACT {
        Flags::OVERRIDE | Flags::ACCESSOR | Flags::STATIC | Flags::PRIVATE | Flags::ASYNC
    } else if modifier == Flags::EXPORT {
        Flags::AMBIENT | Flags::ABSTRACT | Flags::ASYNC
    } else if modifier == Flags::AMBIENT {
        Flags::OVERRIDE
    } else if modifier == Flags::ASYNC {
        Flags::ABSTRACT
    } else {
        Flags::empty()
    };
    others | modifier
}

/// oxc's `check_modifier`: `modifier`, at `pos`, follows the modifiers `seen`.
#[inline(never)]
pub(super) fn modifier_after(errors: &mut Errors, seen: Flags, modifier: Flags, pos: u32) {
    let conflicting = cannot_precede(modifier) & seen;
    if conflicting.is_empty() {
        return;
    }
    let this = (modifier, pos);
    let twice = Help::Text("Remove the duplicate modifier.");
    if ACCESSIBILITY.contains(modifier) && seen.intersects(ACCESSIBILITY) {
        let end = pos + modifier_text(modifier).len() as u32;
        let message = "Accessibility modifier already seen.";
        return errors.push(error(1028, (pos, end), message, &twice.text()));
    }
    if seen.contains(modifier) {
        return errors.push(about_modifier(1030, this, "already seen.", twice));
    }
    let Some(&other) = MODIFIERS.iter().find(|&&it| conflicting.contains(it)) else {
        return;
    };
    let both = modifier | other;
    let with_abstract = [Flags::STATIC, Flags::PRIVATE, Flags::ASYNC]
        .into_iter()
        .find(|&it| both == it | Flags::ABSTRACT);
    errors.push(if let Some(first) = with_abstract {
        let rest = "cannot be used with 'abstract' modifier.";
        Diagnostic {
            start: pos,
            end: pos + modifier_text(modifier).len() as u32,
            ..about_modifier(1243, (first, pos), rest, Help::None)
        }
    } else if both == Flags::OVERRIDE | Flags::AMBIENT {
        let rest = match modifier == Flags::OVERRIDE {
            true => "cannot be used with 'declare' modifier.",
            false => "cannot be used in an ambient context.",
        };
        let code = if modifier == Flags::OVERRIDE {
            1243
        } else {
            1040
        };
        Diagnostic {
            start: pos,
            end: pos + modifier_text(modifier).len() as u32,
            ..about_modifier(code, (Flags::OVERRIDE, pos), rest, Help::None)
        }
    } else {
        let rest = format!("must precede '{}' modifier.", modifier_text(other));
        about_modifier(1029, this, &rest, Help::None)
    });
}

/// oxc's `verify_modifiers`: calls `report` with each keyword of `modifiers` that isn't in `allowed`. oxc only
/// remembers the last position of each keyword.
fn verify(modifiers: &[Modifier], allowed: Flags, report: &mut dyn FnMut((Flags, u32))) {
    for (index, it) in modifiers.iter().enumerate() {
        let ModifierKind::Keyword(modifier) = it.kind else {
            continue;
        };
        let is_repeated_later = |later: &Modifier| later.kind == it.kind;
        if !allowed.contains(modifier) && !modifiers[index + 1..].iter().any(is_repeated_later) {
            report((modifier, it.pos));
        }
    }
}

const MISPLACED_DECORATOR: &str = "Decorators are not valid here.";

fn decorator(modifier: &Modifier) -> Option<ExprId> {
    match modifier.kind {
        ModifierKind::Decorator(expression) => Some(expression),
        ModifierKind::Keyword(_) => None,
    }
}

/// The spans of the decorators among `modifiers`.
fn decorators(f: &FileBuilder, modifiers: Span<ModifierId>) -> Vec<(u32, u32)> {
    let modifier_list = f.modifiers.get(modifiers.range()).unwrap_or_default();
    let spans = modifier_list
        .iter()
        .filter_map(|it| Some((it.pos, outer_span(f, decorator(it)?)?.1)));
    spans.collect()
}

fn keywords(modifiers: &[Modifier]) -> Flags {
    modifiers
        .iter()
        .fold(Flags::empty(), |all, it| all | it.kind.flag())
}

// ───────────────────────────── functions ─────────────────────────────

const AMBIENT_IMPLEMENTATION: &str = "An implementation cannot be declared in ambient contexts.";

fn implementation_in_ambient_context(open_brace: u32) -> Diagnostic {
    error(1183, (open_brace, open_brace), AMBIENT_IMPLEMENTATION, "")
}

/// Checks `func`'s parameters in the order oxc's parser reads them. Returns false if oxc gives up.
fn parameters(f: &mut FileBuilder, src: &[u8], func: &Func, site: CallSite) -> bool {
    let is_ambient = site.is_ambient;
    let FileBuilder {
        params,
        pats,
        modifiers,
        modifiers_of_params,
        types,
        exprs,
        parens,
        diagnostics: errors,
        ..
    } = f;
    let list = params.get(func.params.range()).unwrap_or_default();
    let mut has_optional = false;
    for (index, (param, id)) in list.iter().zip(func.params.iter()).enumerate() {
        let id: ParamId = id;
        let Some(name) = pats.get(param.pat.idx()) else {
            continue;
        };
        let modifier_list = modifiers_of_params.get(id.idx()).copied();
        let modifier_list = modifiers
            .get(modifier_list.unwrap_or(Span::EMPTY).range())
            .unwrap_or_default();
        let allowed = match func.kind {
            FnKind::Constructor if !site.is_javascript => PARAMETER_PROPERTY,
            _ => Flags::empty(),
        };
        // oxc checks the modifiers before it continues, and everything else after the parameter.
        let after_modifiers = modifier_list.last().map_or(param.pos, |it| it.pos + 1);
        verify(modifier_list, allowed, &mut |it| {
            let help = Help::Allowed(allowed);
            let found = match site.is_javascript {
                true => {
                    let message = "Parameter modifiers can only be used in TypeScript files.";
                    let end = it.1 + modifier_text(it.0).len() as u32;
                    error(8012, (it.1, end), message, &help.text())
                }
                false => about_modifier(1090, it, "cannot appear on a parameter.", help),
            };
            errors.push(noticed_at(found, after_modifiers));
        });
        if !site.is_class_member || site.is_javascript {
            for (it, e) in modifier_list
                .iter()
                .filter_map(|it| Some((it, decorator(it)?)))
            {
                let Some(inner) = exprs.get(e.idx()) else {
                    continue;
                };
                let enclosing_parens = parens.iter().filter(|it| it.0 == e);
                let end = enclosing_parens.fold(inner.end, |end, it| end.max(it.2));
                let found = error(0, (it.pos, end), MISPLACED_DECORATOR, "");
                errors.push(noticed_at(found, param.loc.end));
            }
        }
        let is_optional = param.flags.contains(Flags::OPTIONAL);
        let whole = (param.pos, param.loc.end);
        let is_property = keywords(modifier_list).intersects(PARAMETER_PROPERTY);
        if is_property && func.kind == FnKind::Constructor && matches!(func.body, FnBody::None) {
            let message = "A parameter property is only allowed in a constructor implementation.";
            errors.push(semantic(2369, whole, message));
        }
        if param.flags.contains(Flags::REST) {
            if let Some(last) = modifier_list
                .last()
                .filter(|it| it.kind.flag() != Flags::empty())
            {
                let after = last.pos as usize + modifier_text(last.kind.flag()).len();
                let dots = skip_trivia(src, after) as u32;
                errors.push(fatal((dots, dots + 3), "Unexpected token"));
                return false;
            }
            if is_optional {
                let question = skip_trivia(src, name.end as usize) as u32;
                let help = "Remove this `?`. The default value is an empty array";
                let message = "A rest parameter cannot be optional";
                errors.push(error(1047, (question, question + 1), message, help));
            }
            if param.default.is_some() && param.ty.is_none() {
                let message = "A rest parameter cannot have an initializer.";
                let found = error(0, (name.pos, param.loc.end), message, "");
                errors.push(noticed_at(found, param.loc.end));
            } else if let (Some(ty), Some(_)) =
                (types.get(param.ty.idx()), exprs.get(param.default.idx()))
            {
                // After the type, and the parentheses around it.
                let mut equals = skip_trivia(src, ty.end as usize);
                while src.get(equals) == Some(&b')') {
                    equals = skip_trivia(src, equals + 1);
                }
                let found = fatal(
                    (equals as u32, equals as u32 + 1),
                    "Expected `,` or `)` but found `=`",
                );
                let open = (func.anchor, func.anchor + 1);
                let found = with_labels(found, "`,` or `)` expected", open, "Opened here");
                errors.push(noticed_at(found, equals as u32));
                return false;
            }
            if index + 1 < list.len() {
                let message = "A rest parameter must be last in a parameter list";
                errors.push(fatal(whole, message));
                return false;
            }
            let comma = skip_trivia(src, param.loc.end as usize);
            if src.get(comma) == Some(&b',') && !is_ambient {
                let message = "A rest parameter or binding pattern may not have a trailing comma.";
                let at = (comma as u32, comma as u32 + 1);
                errors.push(error(0, at, message, "Remove the trailing comma here"));
            }
            continue;
        }
        if is_optional && param.default.is_some() {
            let message = "A parameter cannot have a question mark and an initializer.";
            let found = error(1015, (name.pos, name.end), message, "");
            errors.push(noticed_at(found, param.loc.end));
        }
        if is_property {
            match name.kind {
                PatKind::Ident(bun_sema::atom::known::constructor)
                    if func.kind == FnKind::Constructor =>
                {
                    let message = "'constructor' cannot be used as a parameter property name.";
                    let found = error(2398, (name.pos, name.end), message, "");
                    errors.push(noticed_at(found, param.loc.end));
                }
                PatKind::Ident(_) => {}
                _ => {
                    let message =
                        "A parameter property may not be declared using a binding pattern.";
                    errors.push(noticed_at(error(1187, whole, message, ""), param.loc.end));
                }
            }
        }
        if is_optional {
            has_optional = true;
        } else if has_optional && param.default.is_none() {
            let message = "A required parameter cannot follow an optional parameter.";
            errors.push(noticed_at(error(1016, whole, message, ""), param.loc.end));
        }
    }
    true
}

/// A `this` at `at` that isn't the first parameter.
#[cold]
#[inline(never)]
pub(super) fn this_after_parameter(errors: &mut Errors, at: u32) {
    let message = "Identifier expected. 'this' is a reserved word that cannot be used here.";
    errors.push(fatal((at, at + 4), message));
}

/// oxc's `check_getter` and `check_setter`, minus what all JavaScript parsers report: parameter count, rest parameter.
fn accessor(f: &FileBuilder, func: &Func) -> Option<Diagnostic> {
    if let (Some(first), Some(last)) = (
        f.type_params.get(func.type_params.start as usize),
        f.type_params
            .get(func.type_params.range().end.wrapping_sub(1)),
    ) && !func.type_params.is_empty()
    {
        // The label includes the angle brackets.
        let message = "An accessor cannot have type parameters.";
        return Some(error(1094, (first.start, last.end), message, ""));
    }
    let only = f.params.get(func.params.start as usize)?;
    if func.kind != FnKind::Setter || func.params.len != 1 || only.flags.contains(Flags::REST) {
        return None;
    }
    if let Some(ret) = f.types.get(func.ret.idx()) {
        let message = "A 'set' accessor cannot have a return type annotation.";
        return Some(error(1095, (ret.pos, ret.end), message, ""));
    }
    if only.flags.contains(Flags::OPTIONAL) {
        let message = "A 'set' accessor cannot have an optional parameter.";
        return Some(error(1051, (only.pos, only.loc.end), message, ""));
    }
    only.default.is_some().then(|| {
        let message = "A 'set' accessor cannot have an initializer.";
        error(0, (func.anchor, func.anchor), message, "")
    })
}

/// True if `declare` is one of the modifiers on the declaration `func`.
fn is_after_declare(src: &[u8], func: &Func) -> bool {
    let mut at = func.start as usize;
    loop {
        let rest = src.get(at..).unwrap_or_default();
        let word = rest.iter().take_while(|it| it.is_ascii_lowercase()).count();
        match &rest[..word] {
            b"declare" => return true,
            b"export" | b"default" | b"async" => at = skip_trivia(src, at + word),
            _ => return false,
        }
    }
}

/// The parser's state when it calls into this file.
#[derive(Copy, Clone)]
pub(super) struct CallSite {
    /// The end of the last token.
    pub(super) now: u32,
    /// `ctx::AMBIENT`
    pub(super) is_ambient: bool,
    /// `ctx::TYPE`
    pub(super) is_in_type: bool,
    /// `ctx::CLASS_MEMBER`
    pub(super) is_class_member: bool,
    pub(super) is_javascript: bool,
}

/// Call at the end of the function `id`. `open_brace`: the `{` of its body.
#[cold]
#[inline(never)]
pub(super) fn function(
    f: &mut FileBuilder,
    src: &[u8],
    id: FnId,
    open_brace: u32,
    site: CallSite,
    can_end_here: bool,
) {
    let Some(&func) = f.fns.get(id.idx()) else {
        return;
    };
    let CallSite {
        now, is_ambient, ..
    } = site;
    if !parameters(f, src, &func, site) {
        return;
    }
    let has_body = !matches!(func.body, FnBody::None);
    if let Some(this) = f.params.get(func.this_param.idx()) {
        let at = (this.pos, this.loc.end);
        let found = match func.kind {
            FnKind::Arrow => {
                let message = "An arrow function cannot have a `this` parameter.";
                let help =
                    "Arrow function does not bind `this` and inherits `this` from the outer scope";
                Some(noticed_at(error(2730, at, message, help), func.anchor))
            }
            FnKind::Constructor | FnKind::ConstructorType | FnKind::ConstructSignature => {
                let message = "A constructor cannot have a `this` parameter.";
                Some(noticed_at(error(2681, at, message, ""), now))
            }
            _ => None,
        };
        f.diagnostics.extend(found);
    }
    if matches!(func.kind, FnKind::Getter | FnKind::Setter)
        && let Some(mut found) = accessor(f, &func)
        // A signature in a type can have an initializer.
        && (found.code != 0 || !site.is_in_type && !site.is_javascript)
    {
        // These labels extend to a bracket.
        match found.code {
            1094 => {
                let less_than = skip_trivia_back(src, found.start as usize) as u32;
                found.start = less_than.saturating_sub(1);
                found.end = skip_trivia(src, found.end as usize) as u32 + 1;
                if site.is_in_type {
                    let at = (found.start, found.start + 1);
                    let mut found = fatal(at, "Expected `(` but found `<`");
                    found.args = [&b"Expected `(` but found `<`"[..], b"", b"`(` expected"]
                        .map(Into::into)
                        .into();
                    return f.diagnostics.push(found);
                }
            }
            1095 => found.start = colon_before(src, found.start),
            0 => {
                let last = f.params.get(func.params.start as usize);
                let close = skip_trivia(src, last.map_or(0, |it| it.loc.end) as usize);
                found.end = close as u32 + 1;
            }
            _ => {}
        }
        f.diagnostics.push(noticed_at(found, now));
    }
    // After `declare function f() {}` oxc requires the end of a statement, and only then checks what it parsed.
    if func.kind == FnKind::Decl && has_body && !can_end_here && is_after_declare(src, &func) {
        return f.diagnostics.push(missing_semicolon(now));
    }
    if func.kind == FnKind::Decl && is_ambient && has_body {
        let found = implementation_in_ambient_context(open_brace);
        f.diagnostics.push(noticed_at(found, now));
    }
    if func.flags.contains(Flags::GENERATOR) && (is_ambient || !has_body) {
        // From the `*`, or from the start of what is only a signature.
        let star = skip_trivia_back(src, func.name_pos as usize).saturating_sub(1) as u32;
        let found = match is_ambient {
            true => {
                let message = "Generators are not allowed in an ambient context.";
                error(1221, (star, now), message, "")
            }
            false => {
                let message = "An overload signature cannot be declared as a generator.";
                let start = if func.kind == FnKind::Decl {
                    func.start
                } else {
                    star
                };
                error(1222, (start, now), message, "")
            }
        };
        // Reported at the token after the signature. In `function* enum() {}` oxc has given up by then.
        let next = skip_trivia(src, now as usize) as u32;
        f.diagnostics.push(noticed_at(found, next));
    }
}

/// The `:` of the type annotation whose type starts at `ty`.
fn colon_before(src: &[u8], ty: u32) -> u32 {
    (skip_trivia_back(src, ty as usize) as u32).saturating_sub(1)
}

// ───────────────────────────── classes ─────────────────────────────

/// A member of a class, after its last token.
pub(super) struct ClassMember<'a> {
    pub(super) member: &'a Member,
    /// From the first token of its name to the end of the name.
    pub(super) name: (u32, u32),
    pub(super) site: CallSite,
}

/// The span of oxc's `PropertyKey`: for `[a]` it's `a`.
fn key_span(src: &[u8], (start, end): (u32, u32)) -> (u32, u32) {
    match src.get(start as usize) {
        Some(b'[') => (
            skip_trivia(src, start as usize + 1) as u32,
            skip_trivia_back(src, end.saturating_sub(1) as usize) as u32,
        ),
        _ => (start, end),
    }
}

/// How oxc's messages name a member: a string without its quotes, anything else verbatim.
fn key_text(src: &[u8], (start, end): (u32, u32)) -> &[u8] {
    let text = src.get(start as usize..end as usize).unwrap_or_default();
    match text {
        [b'"' | b'\'', inner @ .., b'"' | b'\''] => inner,
        _ => text,
    }
}

/// The span of `e` with the parentheses around it. The list of parentheses isn't sorted yet.
fn outer_span(f: &FileBuilder, e: ExprId) -> Option<(u32, u32)> {
    let inner = f.exprs.get(e.idx())?;
    let enclosing_parens = f.parens.iter().filter(|it| it.0 == e);
    Some(enclosing_parens.fold((inner.pos, inner.end), |span, it| {
        (span.0.min(it.1), span.1.max(it.2))
    }))
}

/// Reports the modifiers of a `static {}` block, which can't have any.
#[cold]
#[inline(never)]
pub(super) fn static_block(f: &mut FileBuilder, modifiers: Span<ModifierId>) {
    let misplaced = decorators(f, modifiers);
    let (modifier_list, errors) = (&f.modifiers, &mut f.diagnostics);
    errors.extend(
        misplaced
            .iter()
            .map(|&at| error(0, at, MISPLACED_DECORATOR, "")),
    );
    let modifier_list = modifier_list.get(modifiers.range()).unwrap_or_default();
    let after = modifier_list.last().map_or(0, |it| it.pos + 1);
    verify(modifier_list, Flags::empty(), &mut |(modifier, pos)| {
        let end = pos + modifier_text(modifier).len() as u32;
        let found = error(1184, (pos, end), "Modifiers cannot appear here.", "");
        errors.push(noticed_at(found, after));
    });
}

/// Checks the modifiers of an index signature. `allowed`: `readonly`, and in a class `static`.
#[cold]
#[inline(never)]
pub(super) fn index_signature(f: &mut FileBuilder, modifiers: Span<ModifierId>, allowed: Flags) {
    let misplaced = decorators(f, modifiers);
    let (modifier_list, errors) = (&f.modifiers, &mut f.diagnostics);
    errors.extend(
        misplaced
            .iter()
            .map(|&at| error(0, at, MISPLACED_DECORATOR, "")),
    );
    let modifier_list = modifier_list.get(modifiers.range()).unwrap_or_default();
    let after = modifier_list.last().map_or(0, |it| it.pos + 1);
    verify(modifier_list, allowed, &mut |it| {
        let rest = "cannot appear on an index signature.";
        let found = about_modifier(1071, it, rest, Help::Allowed(allowed));
        errors.push(noticed_at(found, after));
    });
}

/// Reports what oxc's parser reports about a class member that's neither a static block nor an index signature.
#[cold]
#[inline(never)]
pub(super) fn class_member(f: &mut FileBuilder, src: &[u8], it: &ClassMember) {
    let (member, now, is_ambient) = (it.member, it.site.now, it.site.is_ambient);
    let func = f.fns.get(member.func.idx()).copied();
    let has_body = func.is_some_and(|it| !matches!(it.body, FnBody::None));
    let open_brace = f.body_starts.last().map_or(0, |it| it.1);
    let initializer = outer_span(f, member.init);
    let on_overload = match func {
        Some(func) if matches!(func.body, FnBody::None) => decorators(f, member.modifiers),
        _ => Vec::new(),
    };
    let return_type = func.and_then(|it| f.types.get(it.ret.idx())).copied();
    let type_params = func.map_or(Span::EMPTY, |it| it.type_params);
    let type_params = (
        f.type_params.get(type_params.start as usize).copied(),
        f.type_params
            .get(type_params.range().end.wrapping_sub(1))
            .copied(),
    );
    let (modifier_list, errors) = (&f.modifiers, &mut f.diagnostics);
    let modifier_list = modifier_list
        .get(member.modifiers.range())
        .unwrap_or_default();
    let seen = keywords(modifier_list);
    let key = key_span(src, it.name);
    let name = key_text(src, key);
    let is_private = src.get(key.0 as usize) == Some(&b'#');
    let is_abstract = seen.contains(Flags::ABSTRACT);
    // The `?` or the `!` after the name.
    let postfix = skip_trivia(src, it.name.1 as usize) as u32;
    let postfix = (postfix, postfix + 1);
    // The `!` of `a?!`.
    let exclamation = match member.flags.contains(Flags::OPTIONAL) {
        true => skip_trivia(src, postfix.1 as usize) as u32,
        false => postfix.0,
    };
    let exclamation = (exclamation, exclamation + 1);
    let position_of = |modifier: Flags| {
        let found = modifier_list.iter().rfind(|it| it.kind.flag() == modifier);
        found.map_or(0, |it| it.pos)
    };
    // After the modifiers, and after the name.
    let (before_name, after_name) = it.name;
    if it.site.is_javascript {
        let after_modifiers = modifier_list.last().map_or(0, |it| it.pos + 1);
        verify(modifier_list, JAVASCRIPT, &mut |(modifier, pos)| {
            let name = modifier_text(modifier);
            let message = format!("The '{name}' modifier can only be used in TypeScript files.");
            let found = error(8009, (pos, pos + name.len() as u32), &message, "");
            errors.push(noticed_at(found, after_modifiers));
        });
    }
    verify(modifier_list, !Flags::EXPORT, &mut |it| {
        let rest = "cannot appear on class elements of this kind.";
        let found = about_modifier(1031, it, rest, Help::None);
        errors.push(noticed_at(found, before_name));
    });
    // `static constructor() {}` is a method.
    let kind = match member.kind {
        MemberKind::Constructor if seen.contains(Flags::STATIC) => MemberKind::Method,
        kind => kind,
    };
    let only_on_property = "can only appear on a property declaration.";
    let only_on_property_or_index = "can only appear on a property declaration or index signature.";
    if kind != MemberKind::Constructor {
        // oxc's `parse_class_element_name`
        verify(
            modifier_list,
            !(Flags::CONST | Flags::IN | Flags::OUT),
            &mut |it| {
                let found = match it.0 == Flags::CONST {
                    true => error(
                        1248,
                        (it.1, it.1 + 5),
                        "A class member cannot have the 'const' keyword.",
                        "Did you mean `readonly`?",
                    ),
                    false => about_modifier(1274, it, MISPLACED_VARIANCE, Help::None),
                };
                errors.push(noticed_at(found, before_name));
            },
        );
        if is_private && !it.site.is_javascript {
            verify(modifier_list, !ACCESSIBILITY, &mut |(modifier, pos)| {
                let end = pos + modifier_text(modifier).len() as u32;
                let message = "An accessibility modifier cannot be used with a private identifier.";
                let help = "Private identifiers are enforced at runtime, while accessibility modifiers only affect type checking, so using both is redundant.";
                errors.push(noticed_at(
                    error(18010, (pos, end), message, help),
                    after_name,
                ));
            });
        }
    }
    let marked_abstract = |code: u32, what: &str, lacks: &str| {
        let texts: [&[u8]; 5] = [
            what.as_bytes(),
            b" '",
            name,
            b"' cannot have an ",
            lacks.as_bytes(),
        ];
        let message = [&texts.concat()[..], b" because it is marked abstract."].concat();
        noticed_at(error_with_text(code, key, &message, ""), now)
    };
    match kind {
        MemberKind::Getter | MemberKind::Setter => {
            if member.flags.contains(Flags::OPTIONAL) {
                return errors.push(expected("(", b"?", postfix));
            }
            if is_ambient && has_body {
                errors.push(implementation_in_ambient_context(open_brace));
            }
            if is_abstract && has_body {
                errors.push(marked_abstract(1318, "Accessor", "implementation"));
            }
            let allowed = !(Flags::ASYNC | Flags::AMBIENT | Flags::ACCESSOR);
            verify(modifier_list, allowed, &mut |it| {
                let found = match it.0 == Flags::ACCESSOR {
                    true => about_modifier(1275, it, only_on_property, Help::None),
                    false => about_modifier(0, it, "cannot be used here.", Help::None),
                };
                errors.push(noticed_at(found, now));
            });
        }
        MemberKind::Constructor => {
            let allowed = !(Flags::AMBIENT | Flags::READONLY | Flags::ACCESSOR);
            verify(modifier_list, allowed, &mut |it| {
                let found = match it.0 {
                    Flags::AMBIENT => {
                        let rest = "cannot appear on a constructor declaration.";
                        about_modifier(1031, it, rest, Help::None)
                    }
                    Flags::READONLY => {
                        about_modifier(1024, it, only_on_property_or_index, Help::None)
                    }
                    _ => about_modifier(1275, it, only_on_property, Help::None),
                };
                errors.push(noticed_at(found, before_name));
            });
            if is_abstract {
                errors.push(noticed_at(error(1242, key, MISPLACED_ABSTRACT, ""), now));
            }
            if is_ambient && has_body {
                errors.push(implementation_in_ambient_context(open_brace));
            }
            if let (Some(first), Some(last)) = type_params {
                let start = (skip_trivia_back(src, first.start as usize) as u32).saturating_sub(1);
                let end = skip_trivia(src, last.end as usize) as u32 + 1;
                errors.push(type_parameters_of_constructor((start, end), now));
            }
            if let Some(ty) = return_type {
                let message = "Type annotation cannot appear on a constructor declaration.";
                errors.push(noticed_at(error(1093, (ty.pos, ty.end), message, ""), now));
            }
        }
        MemberKind::Method => {
            let allowed = !(Flags::AMBIENT | Flags::READONLY | Flags::ACCESSOR);
            verify(modifier_list, allowed, &mut |it| {
                let rest = match it.0 {
                    Flags::AMBIENT => "cannot appear on class elements of this kind.",
                    Flags::READONLY => only_on_property_or_index,
                    _ => only_on_property,
                };
                let code = match it.0 {
                    Flags::AMBIENT => 1031,
                    Flags::READONLY => 1024,
                    _ => 1275,
                };
                let found = about_modifier(code, it, rest, Help::Allowed(METHOD));
                errors.push(noticed_at(found, after_name));
            });
            if is_abstract && is_private {
                errors.push(noticed_at(
                    error(18019, key, ABSTRACT_PRIVATE, ""),
                    after_name,
                ));
            }
            if is_ambient && has_body {
                let found = implementation_in_ambient_context(open_brace);
                errors.push(noticed_at(found, now));
            }
            if is_abstract && has_body {
                errors.push(marked_abstract(1245, "Method", "implementation"));
            }
        }
        MemberKind::Property if seen.contains(Flags::ACCESSOR) => {
            if member.flags.contains(Flags::OPTIONAL) {
                let message = "An 'accessor' property cannot be declared optional.";
                errors.push(error(1276, postfix, message, "Remove this `?`"));
            }
            let others = ACCESSIBILITY | Flags::STATIC | Flags::ABSTRACT | Flags::OVERRIDE;
            verify(
                modifier_list,
                others | Flags::ACCESSOR,
                &mut |(modifier, pos)| {
                    let name = modifier_text(modifier);
                    let message =
                        format!("'accessor' modifier cannot be used with '{name}' modifier.");
                    let at = (pos, pos + name.len() as u32);
                    let help = Help::Allowed(others).text();
                    errors.push(noticed_at(error(1243, at, &message, &help), now));
                },
            );
            let is_disallowed = is_ambient && !seen.contains(Flags::AMBIENT)
                || is_abstract
                || seen.contains(Flags::STATIC);
            if member.flags.contains(Flags::DEFINITE) {
                let found = definite(exclamation, initializer.is_some(), member.ty, is_disallowed);
                errors.extend(found.map(|it| noticed_at(it, now)));
            }
        }
        MemberKind::Property => {
            verify(modifier_list, !Flags::ASYNC, &mut |it| {
                let found = about_modifier(0, it, "cannot be used here.", Help::None);
                errors.push(noticed_at(found, after_name));
            });
            if is_abstract && is_private {
                let at = position_of(Flags::ABSTRACT);
                errors.push(noticed_at(
                    error(18019, (at, at + 8), ABSTRACT_PRIVATE, ""),
                    now,
                ));
            }
            if let Some(initializer) = initializer {
                if is_abstract {
                    errors.push(marked_abstract(1267, "Property", "initializer"));
                }
                let is_constant = seen.contains(Flags::READONLY) && member.ty.is_none();
                if is_ambient && !is_constant {
                    errors.push(noticed_at(
                        error(1039, initializer, AMBIENT_INITIALIZER, ""),
                        now,
                    ));
                }
            }
            if member.flags.contains(Flags::DEFINITE) {
                let is_disallowed = is_ambient || is_abstract || seen.contains(Flags::STATIC);
                let found = definite(exclamation, initializer.is_some(), member.ty, is_disallowed);
                errors.extend(found.map(|it| noticed_at(it, now)));
            }
        }
        _ => {}
    }
    for &at in &on_overload {
        let message = "A decorator can only decorate a method implementation, not an overload.";
        let found = error(1249, at, message, "Move this after all the overloads");
        errors.push(noticed_at(found, now));
    }
    // Reported by oxc's scope-building pass.
    if matches!(kind, MemberKind::Getter | MemberKind::Setter)
        && !has_body
        && !is_abstract
        && !is_ambient
    {
        let message = "Getters and setters must have an implementation.";
        errors.push(semantic(0, key, message));
    }
}

/// `at`: from the `<` to the `>` of a constructor's type parameters. `now`: the end of the constructor.
fn type_parameters_of_constructor(at: (u32, u32), now: u32) -> Diagnostic {
    let message = "Type parameters cannot appear on a constructor declaration";
    let help = "Instead, add type parameters to the class itself";
    noticed_at(error(1092, at, message, help), now)
}

/// `'constructor'<T>() {}`, a method for TypeScript but the constructor for oxc. `name_end`: the end of the string.
#[cold]
#[inline(never)]
pub(super) fn type_parameters_of_quoted_constructor(
    f: &mut FileBuilder,
    src: &[u8],
    func: FnId,
    (name_end, now): (u32, u32),
) {
    let Some(func) = f.fns.get(func.idx()) else {
        return;
    };
    let start = skip_trivia(src, name_end as usize) as u32;
    let end = skip_trivia_back(src, func.anchor as usize) as u32;
    f.diagnostics
        .push(type_parameters_of_constructor((start, end), now));
}

/// Checks the modifiers of an object literal member. The only valid one is `async` on a method.
#[cold]
#[inline(never)]
pub(super) fn object_member(f: &mut FileBuilder, modifiers: Span<ModifierId>, is_method: bool) {
    let (modifier_list, errors) = (&f.modifiers, &mut f.diagnostics);
    let modifier_list = modifier_list.get(modifiers.range()).unwrap_or_default();
    let allowed = match is_method {
        true => Flags::ASYNC,
        false => Flags::empty(),
    };
    verify(modifier_list, allowed, &mut |it| {
        let help = Help::Allowed(allowed);
        errors.push(about_modifier(0, it, "cannot be used here.", help));
    });
}

/// The error for the `!` at `at`, after a variable or property name. `is_disallowed`: `!` is never allowed there.
fn definite(
    at: (u32, u32),
    has_initializer: bool,
    ty: TypeNodeId,
    is_disallowed: bool,
) -> Option<Diagnostic> {
    let (code, message) = if has_initializer {
        let message =
            "Declarations with initializers cannot also have definite assignment assertions.";
        (1263, message)
    } else if ty.is_none() {
        let message =
            "Declarations with definite assignment assertions must also have type annotations.";
        (1264, message)
    } else if is_disallowed {
        let message = "A definite assignment assertion '!' is not permitted in this context.";
        (1255, message)
    } else {
        return None;
    };
    Some(error(code, at, message, ""))
}

/// oxc's `check_class`, which its scope-building pass runs when it leaves a class. Reports abstract members of a
/// non-abstract class, and overloads that aren't followed by an implementation.
#[cold]
#[inline(never)]
pub(super) fn class_members(
    f: &mut FileBuilder,
    src: &[u8],
    members: &[Member],
    is_abstract: bool,
    site: CallSite,
) {
    let (fns, errors) = (&f.fns, &mut f.diagnostics);
    let key_of = |it: &Member| {
        let start = it.name_pos as usize;
        let end = match src.get(start) {
            Some(b'[') => closing_bracket(src, start),
            _ => token_end(src, start, false),
        };
        key_span(src, (it.name_pos, end as u32))
    };
    let mut report = |found: Diagnostic| errors.push(noticed_at(found, site.now));
    for it in members
        .iter()
        .filter(|it| !is_abstract && it.flags.contains(Flags::ABSTRACT))
    {
        // The parser has already reported an abstract constructor.
        let (code, message) = match it.kind {
            MemberKind::Property => (
                1253,
                "Abstract properties can only appear within an abstract class.",
            ),
            _ => (
                1244,
                "Abstract methods can only appear within an abstract class.",
            ),
        };
        report(semantic(code, key_of(it), message));
    }
    if site.is_ambient {
        return;
    }
    let is_method = |it: &Member| {
        matches!(
            it.kind,
            MemberKind::Method | MemberKind::Getter | MemberKind::Setter | MemberKind::Constructor
        )
    };
    // oxc's `static_name`
    let name_of = |it: &Member| match it.key {
        PropKey::Name(name) => Some(name),
        _ => None,
    };
    let mut is_in_overloads = false;
    for (index, it) in members.iter().enumerate() {
        let lacks_body = fns
            .get(it.func.idx())
            .is_some_and(|it| matches!(it.body, FnBody::None));
        if !is_method(it) || !lacks_body || it.flags.intersects(Flags::ABSTRACT | Flags::OPTIONAL) {
            is_in_overloads = false;
            continue;
        }
        let next = members.get(index + 1);
        if next.is_some_and(|next| is_method(next) && name_of(next) == name_of(it)) {
            is_in_overloads = true;
            continue;
        }
        if name_of(it).is_some() || is_in_overloads {
            let is_constructor =
                it.kind == MemberKind::Constructor && !it.flags.contains(Flags::STATIC);
            report(match is_constructor {
                true => semantic(2390, key_of(it), "Constructor implementation is missing."),
                false => semantic(
                    2391,
                    key_of(it),
                    "Function implementation is missing or not immediately following the declaration.",
                ),
            });
        }
        is_in_overloads = false;
    }
}

/// The end of the computed name whose `[` is at `open`.
fn closing_bracket(src: &[u8], open: usize) -> usize {
    let (mut at, mut depth) = (open, 0usize);
    while at < src.len() {
        match src[at] {
            b'[' | b'(' | b'{' => depth += 1,
            b']' | b')' | b'}' => depth = depth.saturating_sub(1),
            _ => {}
        }
        at = token_end(src, at, false).max(at + 1);
        if depth == 0 {
            return at;
        }
        at = skip_trivia(src, at);
    }
    src.len()
}

const MISPLACED_VARIANCE: &str =
    "can only appear on a type parameter of a class, interface or type alias.";
const MISPLACED_ABSTRACT: &str =
    "'abstract' modifier can only appear on a class, method, or property declaration.";
const ABSTRACT_PRIVATE: &str = "'abstract' modifier cannot be used with a private identifier.";
const AMBIENT_INITIALIZER: &str = "Initializers are not allowed in ambient contexts.";

// ───────────────────────────── statements ─────────────────────────────

/// Checks a variable declaration that has a `!`, or that's in an ambient context with an initializer or `using`.
#[cold]
#[inline(never)]
pub(super) fn variable(f: &mut FileBuilder, src: &[u8], it: &VarDecl) {
    let Some(&name) = f.pats.get(it.pat.idx()) else {
        return;
    };
    let is_ambient = it.flags.contains(Flags::AMBIENT);
    let initializer = outer_span(f, it.init);
    let errors = &mut f.diagnostics;
    if is_ambient && matches!(it.kind, VarKind::Using | VarKind::AwaitUsing) {
        let (code, message) = match it.kind {
            VarKind::Using => (
                1545,
                "'using' declarations are not allowed in ambient contexts.",
            ),
            _ => (
                1546,
                "'await using' declarations are not allowed in ambient contexts.",
            ),
        };
        return errors.push(error(code, (name.pos, name.end), message, ""));
    }
    if let Some(initializer) = initializer
        && is_ambient
        && (it.kind != VarKind::Const || it.ty.is_some())
    {
        let found = error(1039, initializer, AMBIENT_INITIALIZER, "");
        errors.push(noticed_at(found, initializer.1));
    }
    if it.flags.contains(Flags::DEFINITE) {
        let at = skip_trivia(src, name.end as usize) as u32;
        errors.extend(definite(
            (at, at + 1),
            initializer.is_some(),
            it.ty,
            is_ambient,
        ));
    }
}

/// Checks the modifiers of the declaration `statement`, which has modifiers other than `export` and `default`.
#[cold]
#[inline(never)]
pub(super) fn declaration(f: &mut FileBuilder, src: &[u8], statement: StmtId, site: CallSite) {
    let modifiers = f.stmt_modifiers(statement);
    let Some(&statement) = f.stmts.get(statement.idx()) else {
        return;
    };
    let is_done = decorators_of_declaration(f, src, (&statement, modifiers), site);
    let (modifier_list, errors) = (&f.modifiers, &mut f.diagnostics);
    let modifier_list = modifier_list.get(modifiers.range()).unwrap_or_default();
    let is_decorated = modifier_list.iter().any(|it| decorator(it).is_some());
    if is_done {
        return;
    }
    if site.is_javascript && !is_decorated {
        return errors.extend(modifier_in_javascript(src, modifier_list, &statement.kind));
    }
    let allowed = match statement.kind {
        StmtKind::Fn(_) => Flags::AMBIENT | Flags::ASYNC,
        StmtKind::Class(_) => Flags::AMBIENT | Flags::ABSTRACT,
        StmtKind::Enum(_) => Flags::AMBIENT | Flags::CONST,
        StmtKind::Var(_)
        | StmtKind::Interface(_)
        | StmtKind::TypeAlias(_)
        | StmtKind::Module(_) => Flags::AMBIENT,
        StmtKind::ImportEquals(_) => Flags::EXPORT,
        _ => return,
    };
    let is_import = matches!(statement.kind, StmtKind::ImportEquals(_));
    let names_abstract = is_import || matches!(statement.kind, StmtKind::Interface(_));
    // oxc checks a variable statement's modifiers before it parses the variables.
    let now = match statement.kind {
        StmtKind::Var(_) | StmtKind::ImportEquals(_) => {
            modifier_list.last().map_or(site.now, |it| it.pos + 1)
        }
        _ => site.now,
    };
    // `export` and `export default` at the start, after the decorators, aren't modifiers for oxc.
    let flag = |index: usize| {
        modifier_list
            .get(index)
            .map_or(Flags::empty(), |it| it.kind.flag())
    };
    let leading = modifier_list
        .iter()
        .take_while(|it| decorator(it).is_some());
    let mut first = leading.count();
    while flag(first) == Flags::EXPORT {
        first += 1;
    }
    first += usize::from(flag(first) == Flags::DEFAULT);
    let modifier_list = modifier_list.get(first..).unwrap_or_default();
    verify(modifier_list, allowed, &mut |it| {
        let found = match it.0 {
            Flags::ABSTRACT if names_abstract => {
                error(1242, (it.1, it.1 + 8), MISPLACED_ABSTRACT, "")
            }
            Flags::AMBIENT if is_import => {
                let message = "A 'declare' modifier cannot be used with an import declaration.";
                error(1079, (it.1, it.1 + 7), message, "")
            }
            _ => about_modifier(0, it, "cannot be used here.", Help::Allowed(allowed)),
        };
        errors.push(noticed_at(found, now));
    });
}

/// Returns oxc's error about the first modifier in `modifier_list`, a JavaScript statement's modifiers, that JavaScript
/// doesn't have. oxc treats it as a name, or as something that can't follow `export`.
fn modifier_in_javascript(
    src: &[u8],
    modifier_list: &[Modifier],
    kind: &StmtKind,
) -> Option<Diagnostic> {
    let flag = |index: usize| {
        modifier_list
            .get(index)
            .map_or(Flags::empty(), |it| it.kind.flag())
    };
    let mut first = usize::from(flag(0) == Flags::EXPORT);
    if first == 1 && flag(1) == Flags::DEFAULT {
        // oxc accepts this in every file.
        if flag(2) == Flags::ABSTRACT && matches!(kind, StmtKind::Class(_)) {
            return None;
        }
        first = 2;
    }
    let it = modifier_list.get(first)?;
    let end = it.pos + modifier_text(it.kind.flag()).len() as u32;
    Some(match it.kind.flag() {
        Flags::ASYNC if matches!(kind, StmtKind::Fn(_)) => return None,
        // A duplicate `export`, which is already reported.
        Flags::EXPORT => return None,
        Flags::CONST => {
            let keyword = skip_trivia(src, end as usize) as u32;
            let message =
                "Identifier expected. 'enum' is a reserved word that cannot be used here.";
            fatal((keyword, keyword + 4), message)
        }
        _ if first == 0 => missing_semicolon(end),
        _ => unexpected((it.pos, end)),
    })
}

/// Reports errors about `statement`'s decorators. Returns true if nothing else should be reported about its modifiers.
fn decorators_of_declaration(
    f: &mut FileBuilder,
    src: &[u8],
    (statement, modifiers): (&Stmt, Span<ModifierId>),
    site: CallSite,
) -> bool {
    let spans = decorators(f, modifiers);
    if spans.is_empty() {
        return false;
    }
    let first_variable = match statement.kind {
        StmtKind::Var(list) => {
            let first = f
                .var_decls
                .get(list.start as usize)
                .filter(|_| list.len > 0);
            first.and_then(|it| f.pats.get(it.pat.idx()))
        }
        _ => None,
    };
    // oxc assumes a class follows `export @a`. This is where it expects the class's `{`.
    let after_name = match statement.kind {
        StmtKind::Fn(it) => f.fns.get(it.idx()).map(|it| it.anchor),
        StmtKind::Var(_) => first_variable.map(|it| match it.kind {
            PatKind::Ident(_) => skip_trivia(src, it.end as usize) as u32,
            _ => it.pos,
        }),
        StmtKind::TypeAlias(it) => f.aliases.get(it.idx()).map(|it| {
            let end = token_end(src, it.name_pos as usize, false);
            skip_trivia(src, end) as u32
        }),
        _ => None,
    };
    let (modifier_list, errors) = (&f.modifiers, &mut f.diagnostics);
    let modifier_list = modifier_list.get(modifiers.range()).unwrap_or_default();
    let is_class = matches!(statement.kind, StmtKind::Class(_));
    let flag = |index: usize| {
        modifier_list
            .get(index)
            .map_or(Flags::empty(), |it| it.kind.flag())
    };
    let leading = modifier_list
        .iter()
        .take_while(|it| decorator(it).is_some());
    let leading = leading.count();
    let not_valid = |at: &(u32, u32)| error(0, *at, MISPLACED_DECORATOR, "");
    if leading == 0 {
        // `export default @a`
        if flag(1) == Flags::DEFAULT {
            if !is_class {
                errors.extend(spans.iter().map(not_valid));
            }
            return !is_class;
        }
        let allowed = Flags::AMBIENT | Flags::ABSTRACT;
        verify(
            modifier_list.get(1..).unwrap_or_default(),
            allowed,
            &mut |it| {
                let found = about_modifier(0, it, "cannot be used here.", Help::Allowed(allowed));
                errors.push(noticed_at(found, site.now));
            },
        );
        // oxc takes `{ a }` as the class body, and a new statement starts after it.
        if let Some(body) = first_variable.filter(|it| matches!(it.kind, PatKind::Object(_))) {
            let at = skip_trivia(src, body.end as usize);
            errors.push(unexpected((at as u32, token_end(src, at, false) as u32)));
            return true;
        }
        errors.extend(after_name.map(|at| expected_at("{", src, at)));
        return true;
    }
    // The `export` of these isn't a modifier.
    let is_export = matches!(
        statement.kind,
        StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportAssign(_)
            | StmtKind::ExportAsNamespace(_)
            | StmtKind::ExportDefault(_)
    );
    if flag(leading) != Flags::EXPORT && !is_export {
        if is_class {
            return false;
        }
        // oxc's parser expects `class`, `export` or a modifier of a class.
        let end = match modifier_list.last() {
            Some(last) if decorator(last).is_none() => {
                last.pos + modifier_text(last.kind.flag()).len() as u32
            }
            _ => spans.last().map_or(0, |it| it.1),
        };
        let at = skip_trivia(src, end as usize);
        errors.push(unexpected((at as u32, token_end(src, at, false) as u32)));
        return true;
    }
    match statement.kind {
        StmtKind::Class(_) => {}
        StmtKind::ExportNamed(_)
        | StmtKind::ExportStar { .. }
        | StmtKind::ExportAssign(_)
        | StmtKind::ExportAsNamespace(_)
        | StmtKind::ImportEquals(_) => return true,
        _ => {
            errors.extend(spans.iter().take(leading).map(not_valid));
            return false;
        }
    }
    // JavaScript has no class modifiers after `export`.
    let after_export = modifier_list.get(leading + 1..).unwrap_or_default();
    let is_modifier = |it: &&Modifier| !(Flags::DEFAULT | Flags::EXPORT).contains(it.kind.flag());
    if site.is_javascript
        && let Some(it) = after_export.iter().find(is_modifier)
    {
        errors.extend(spans.iter().take(leading).map(not_valid));
        let end = it.pos + modifier_text(it.kind.flag()).len() as u32;
        errors.push(unexpected((it.pos, end)));
        return true;
    }
    if let Some(again) = spans.get(leading) {
        let message = "Decorators may not appear after 'export' or 'export default' if they also appear before 'export'.";
        errors.push(error(0, *again, message, ""));
    }
    false
}

/// Reports a TypeScript-only declaration, or one after `declare`, as the body of an `if`, a loop, a `with` or a label.
#[cold]
#[inline(never)]
pub(super) fn declaration_as_body(f: &mut FileBuilder, statement: StmtId) {
    let Some(it) = f.stmts.get(statement.idx()) else {
        return;
    };
    let modifier_list = f.stmt_modifiers(statement);
    let modifier_list = f.modifiers.get(modifier_list.range()).unwrap_or_default();
    let is_declared = keywords(modifier_list).contains(Flags::AMBIENT);
    let is_var = |list: Span<VarDeclId>| {
        let first = f.var_decls.get(list.start as usize);
        first.is_some_and(|it| it.kind == VarKind::Var)
    };
    // Every JavaScript parser already reports the others.
    let is_reported_here = match it.kind {
        StmtKind::Interface(_) | StmtKind::TypeAlias(_) | StmtKind::Module(_) => true,
        StmtKind::Enum(_) => !keywords(modifier_list).contains(Flags::CONST) || is_declared,
        StmtKind::Var(list) => is_declared && is_var(list),
        StmtKind::Fn(_) => is_declared,
        _ => false,
    };
    if is_reported_here {
        let message = "Declaration cannot appear in a single-statement context";
        let help = "Wrap this declaration in a block statement";
        let found = error(0, (it.start, it.loc.end), message, help);
        f.diagnostics.push(noticed_at(found, it.loc.end));
    }
}

/// `import type a = b.c`, from its start to its end.
#[cold]
#[inline(never)]
pub(super) fn type_only_import_alias(errors: &mut Errors, statement: (u32, u32)) {
    let message = "An import alias cannot use 'import type'";
    errors.push(noticed_at(error(1392, statement, message, ""), statement.1));
}

/// `import type a, { b } from "c"`: `name` is the `a`.
#[cold]
#[inline(never)]
pub(super) fn type_only_import_of_both(errors: &mut Errors, src: &[u8], name: u32) {
    let message =
        "A type-only import can specify a default import or named bindings, but not both.";
    let end = token_end(src, name as usize, false) as u32;
    errors.push(error(1363, (name, end), message, ""));
}

/// Which kind of specifier has the duplicate `type`.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Specifier {
    Import,
    Export,
}

/// The `type` at `at` of `import type { type a }` or `export type { type a }`.
#[cold]
#[inline(never)]
pub(super) fn duplicate_type_modifier(errors: &mut Errors, at: u32, of: Specifier) {
    let (code, message) = match of {
        Specifier::Import => (
            2206,
            "The 'type' modifier cannot be used on a named import when 'import type' is used on its import statement.",
        ),
        Specifier::Export => (
            2207,
            "The 'type' modifier cannot be used on a named export when 'export type' is used on its export statement.",
        ),
    };
    errors.push(error(
        code,
        (at, at + 4),
        message,
        "Remove this 'type' modifier",
    ));
}

/// Checks the statements `list` of an ambient context, which can only contain declarations. oxc reports the first
/// statement that isn't one.
#[cold]
#[inline(never)]
pub(super) fn statements_in_ambient_context(f: &mut FileBuilder, src: &[u8], list: IdList<StmtId>) {
    let (statements, exprs, errors) = (&f.stmts, &f.exprs, &mut f.diagnostics);
    let list = f.ids.get(list.range()).unwrap_or_default();
    let mut is_prologue = true;
    for it in list.iter().filter_map(|&it| statements.get(it as usize)) {
        // A template without substitutions is stored as a string.
        let is_string = |e: ExprId| {
            matches!(
                exprs.get(e.idx()),
                Some(&Expr {
                    kind: ExprKind::String(_),
                    pos,
                    ..
                }) if src.get(pos as usize) != Some(&b'`')
            )
        };
        is_prologue &= matches!(it.kind, StmtKind::Expr(e) if is_string(e));
        let is_statement = matches!(
            it.kind,
            StmtKind::Empty
                | StmtKind::Debugger
                | StmtKind::Expr(_)
                | StmtKind::Return(_)
                | StmtKind::If { .. }
                | StmtKind::For { .. }
                | StmtKind::ForIn { .. }
                | StmtKind::ForOf { .. }
                | StmtKind::While { .. }
                | StmtKind::DoWhile { .. }
                | StmtKind::Block(_)
                | StmtKind::Switch { .. }
                | StmtKind::Try { .. }
                | StmtKind::Throw(_)
                | StmtKind::Break(_)
                | StmtKind::Continue(_)
                | StmtKind::Labeled { .. }
        );
        if !is_statement || is_prologue {
            continue;
        }
        // oxc has given up inside the statement, or right after it where something is missing.
        let next = skip_trivia(src, it.loc.end as usize) as u32;
        let is_cut_off = |error: &Diagnostic| {
            error.kind == DiagnosticKind::Parse
                && ((it.start..it.loc.end).contains(&error.start)
                    || error.start == next && error.code == 1005)
        };
        if !errors.iter().any(is_cut_off) {
            let message = "Statements are not allowed in ambient contexts.";
            let found = error(1036, (it.start, it.loc.end), message, "");
            errors.push(noticed_at(found, it.loc.end));
        }
        return;
    }
}

/// oxc's `check_namespace_body_statement` for the statements `list` of `namespace N {}`, which isn't a module. `declare
/// module "m" {}` and `declare global {}` allow all of these.
#[cold]
#[inline(never)]
pub(super) fn namespace_body(
    f: &mut FileBuilder,
    src: &[u8],
    list: IdList<StmtId>,
    is_ambient: bool,
) {
    if is_ambient {
        statements_in_ambient_context(f, src, list);
    }
    let FileBuilder {
        ids,
        stmts,
        modifiers,
        modifiers_of_stmts,
        exports,
        import_equals,
        diagnostics: errors,
        ..
    } = f;
    let list = ids.get(list.range()).unwrap_or_default();
    for (id, it) in list
        .iter()
        .filter_map(|&it| Some((it, stmts.get(it as usize)?)))
    {
        let modifier_list = stmt_modifiers_in(modifiers_of_stmts, StmtId(id));
        let modifier_list = modifiers.get(modifier_list.range()).unwrap_or_default();
        let (code, message) = match it.kind {
            StmtKind::ExportDefault(_) => DEFAULT_EXPORT_IN_NAMESPACE,
            StmtKind::Fn(_) | StmtKind::Class(_) | StmtKind::Interface(_)
                if keywords(modifier_list).contains(Flags::DEFAULT) =>
            {
                DEFAULT_EXPORT_IN_NAMESPACE
            }
            StmtKind::ExportAssign(_) => {
                (1063, "An export assignment cannot be used in a namespace.")
            }
            StmtKind::ExportNamed(export)
                if (exports.get(export.idx())).is_some_and(|it| it.has_module_specifier) =>
            {
                EXPORT_IN_NAMESPACE
            }
            StmtKind::ExportStar { .. } => EXPORT_IN_NAMESPACE,
            StmtKind::ExportAsNamespace(_) => {
                (1316, "Global module exports may only appear at top level.")
            }
            StmtKind::Import(_) => IMPORT_IN_NAMESPACE,
            StmtKind::ImportEquals(import)
                if import_equals
                    .get(import.idx())
                    .is_some_and(|it| !matches!(it.target, ImportEqualsTarget::Entity(_))) =>
            {
                IMPORT_IN_NAMESPACE
            }
            _ => continue,
        };
        let found = error(code, (it.start, it.loc.end), message, "");
        errors.push(noticed_at(found, it.loc.end));
    }
}

const DEFAULT_EXPORT_IN_NAMESPACE: (u32, &str) = (
    1319,
    "A default export can only be used in an ECMAScript-style module.",
);
const EXPORT_IN_NAMESPACE: (u32, &str) = (
    1194,
    "Export declarations are not permitted in a namespace.",
);
const IMPORT_IN_NAMESPACE: (u32, &str) = (
    1147,
    "Import declarations in a namespace cannot reference a module.",
);

/// Checks an enum member's name, at `name`, that starts with a `[`, a number or a bigint. oxc's parser gives up at all
/// of them except `["a"]`.
#[cold]
#[inline(never)]
pub(super) fn enum_member_name(errors: &mut Errors, src: &[u8], name: (u32, u32)) {
    let key = key_span(src, name);
    let (code, message) = match src.get(key.0 as usize) {
        Some(b'#') => (0, "Unexpected token"),
        Some(b'0'..=b'9' | b'.') => (2452, "An enum member cannot have a numeric name."),
        Some(b'"' | b'\'') if token_end(src, key.0 as usize, false) as u32 == key.1 => return,
        Some(b'`')
            if token_end(src, key.0 as usize, false) as u32 == key.1
                && src.get(key.1 as usize - 1) == Some(&b'`') =>
        {
            return;
        }
        _ => (1164, "Computed property names are not allowed in enums."),
    };
    errors.push(Diagnostic {
        code,
        ..fatal(key, message)
    });
}

/// oxc's `check_ts_enum_declaration`: a member without an initializer after one whose initializer may not be a number.
#[cold]
#[inline(never)]
pub(super) fn enum_members(f: &mut FileBuilder, members: &[EnumMember]) {
    let (exprs, errors) = (&f.exprs, &mut f.diagnostics);
    let mut needs_initializer = false;
    for it in members {
        let Some(initializer) = exprs.get(it.init.idx()) else {
            if needs_initializer {
                let message = "Enum member must have initializer.";
                errors.push(semantic(0, (it.pos, it.loc.end), message));
            }
            continue;
        };
        needs_initializer = !match initializer.kind {
            ExprKind::Number(_) | ExprKind::Ident(_) => true,
            ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } => chain == Chain::No,
            ExprKind::Binary { op, .. } => {
                !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma)
            }
            ExprKind::Unary { op, .. } => !matches!(
                op,
                UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec
            ),
            _ => false,
        };
    }
}

// ───────────────────────────── expressions ─────────────────────────────

/// `a ?? b || c`, from its start to its end.
#[cold]
#[inline(never)]
pub(super) fn mixed_coalesce(errors: &mut Errors, at: (u32, u32)) {
    let message = "Logical expressions and coalesce expressions cannot be mixed";
    let found = error(0, at, message, "Wrap either expression by parentheses");
    errors.push(noticed_at(found, at.1));
}

/// A `=>` at `at`, at the start of a line.
#[cold]
#[inline(never)]
pub(super) fn arrow_after_line_break(errors: &mut Errors, at: u32) {
    let message = "Line terminator not permitted before arrow";
    let help = "Remove the line break before here";
    errors.push(error(0, (at, at + 2), message, help));
}

/// `throw` at `keyword`, and the next token on another line.
#[cold]
#[inline(never)]
pub(super) fn line_break_after_throw(errors: &mut Errors, keyword: u32, next: (u32, u32)) {
    let found = error(0, (keyword, keyword + 5), "Illegal newline after throw", "");
    let found = with_labels(
        found,
        "throw starts here",
        next,
        "A newline is not expected here",
    );
    // Reported before any error about the token itself.
    errors.push(noticed_at(found, keyword + 5));
}

/// Reports each `return` in the static block `body` that isn't inside a nested function.
#[inline(never)]
pub(super) fn returns_in_static_block(f: &mut FileBuilder, body: FnBody) {
    let FnBody::Block(body) = body else {
        return;
    };
    let (stmts, ids, errors) = (&f.stmts, &f.ids, &mut f.diagnostics);
    let list = |it: IdList<StmtId>| ids.get(it.range()).unwrap_or_default();
    let mut left: Vec<u32> = list(body).to_vec();
    while let Some(id) = left.pop() {
        // `NONE`: an `if` without an `else`, for example.
        let Some(it) = stmts.get(id as usize) else {
            continue;
        };
        match it.kind {
            StmtKind::Return(_) => {
                let message = "A 'return' statement cannot be used inside a class static block.";
                errors.push(error(18041, (it.start, it.start + 6), message, ""));
            }
            StmtKind::Block(inner) => left.extend_from_slice(list(inner)),
            StmtKind::If { yes, no, .. } => left.extend([yes.0, no.0]),
            StmtKind::For { body, .. }
            | StmtKind::ForIn { body, .. }
            | StmtKind::ForOf { body, .. }
            | StmtKind::While { body, .. }
            | StmtKind::DoWhile { body, .. }
            | StmtKind::Labeled { body, .. } => left.push(body.0),
            StmtKind::Try {
                block,
                handler,
                finalizer,
                ..
            } => left.extend([block.0, handler.0, finalizer.0]),
            StmtKind::Switch { cases, .. } => {
                let cases = f.cases.get(cases.range()).unwrap_or_default();
                cases
                    .iter()
                    .for_each(|case| left.extend_from_slice(list(case.body)));
            }
            _ => {}
        }
    }
}

/// `<a.b-c />`: the `b-c`.
#[cold]
#[inline(never)]
pub(super) fn hyphen_in_jsx_member_name(errors: &mut Errors, at: (u32, u32)) {
    let message = "Identifiers in JSX cannot contain hyphens";
    errors.push(Diagnostic {
        kind: DiagnosticKind::OxcFatal,
        ..error(0, at, message, "Remove the hyphen from the identifier")
    });
}

/// `<a b={} />`: the braces.
#[cold]
#[inline(never)]
pub(super) fn empty_jsx_attribute_value(errors: &mut Errors, braces: (u32, u32)) {
    let message = "JSX attributes must only be assigned a non-empty 'expression'.";
    errors.push(error(17000, braces, message, ""));
}

/// `export using a`, from `start` after the `export` to the token `name` after `using`.
fn exported_using(errors: &mut Errors, src: &[u8], start: u32, name: (u32, u32)) {
    let text = src.get(name.0 as usize..name.1 as usize);
    let help: [&[u8]; 3] = [
        b"Remove the `export` here and add `export { ",
        text.unwrap_or_default(),
        b" }` as a separate statement to export the declaration",
    ];
    let texts: [&[u8]; 2] = [
        b"Using declarations cannot be exported directly.",
        &help.concat(),
    ];
    let at = label(start, name.1);
    errors.push(Diagnostic::new(DiagnosticKind::OxcFatal, at, 0, &texts));
}

/// A `)` that ends at `end` where an expression is required, after the token that ends at `after_open`. If that token
/// is the `(` of a parenthesized expression, oxc has a dedicated message. It doesn't if the `(` belongs to a
/// statement's head.
fn empty_parentheses(errors: &mut Errors, src: &[u8], (after_open, end): (u32, u32)) {
    let is_open = |it: &usize| src.get(*it) == Some(&b'(');
    let Some(open) = (after_open as usize).checked_sub(1).filter(is_open) else {
        return;
    };
    let before = src.get(..skip_trivia_back(src, open)).unwrap_or_default();
    let heads: [&[u8]; 5] = [b"if", b"while", b"switch", b"with", b"catch"];
    if !heads.iter().any(|it| before.ends_with(it)) {
        errors.push(fatal((open as u32, end), "Empty parenthesized expression"));
    }
}

/// True if a statement starts at `at`, judging by the text before it: after a `;`, a `{` or a `}`, or at the start.
fn starts_statement(src: &[u8], at: u32) -> bool {
    let before = skip_trivia_back(src, at as usize);
    matches!(
        before.checked_sub(1).and_then(|it| src.get(it)),
        None | Some(b';' | b'{' | b'}')
    )
}

/// `new import("a")`. `at`: from the `import` to the end of the expression.
#[cold]
#[inline(never)]
pub(super) fn new_import(errors: &mut Errors, at: (u32, u32)) {
    let message = "Cannot use new with dynamic import";
    let found = error(0, at, message, "Wrap this with parenthesis");
    errors.push(noticed_at(found, at.1));
}

/// Checks the arguments of the `import(..)` that starts at `start` and whose `)` is at `close`. oxc's parser gives up
/// at each of these errors.
#[inline(never)]
pub(super) fn import_call(
    f: &mut FileBuilder,
    src: &[u8],
    start: u32,
    args: IdList<ExprId>,
    close: u32,
) {
    let (exprs, errors) = (&f.exprs, &mut f.diagnostics);
    let args = f.ids.get(args.range()).unwrap_or_default();
    let mut argument_exprs = args.iter().filter_map(|&it| exprs.get(it as usize));
    let (first, second) = (argument_exprs.next(), argument_exprs.next());
    if matches!(
        first,
        None | Some(Expr {
            kind: ExprKind::Missing,
            ..
        })
    ) {
        let message = "import() requires a specifier.";
        return errors.push(noticed_at(fatal((start, close + 1), message), close));
    }
    let is_spread = |it: &&Expr| matches!(it.kind, ExprKind::Spread(_));
    if let Some(spread) = [first, second].into_iter().flatten().find(is_spread) {
        let message = "Argument of dynamic import cannot be a spread element.";
        return errors.push(Diagnostic {
            code: 1325,
            ..fatal((spread.pos, spread.pos + 3), message)
        });
    }
    if let (Some(&second), true) = (args.get(1), args.len() > 2) {
        let message = "Dynamic imports can only accept a module specifier and an optional set of attributes as arguments";
        let end = outer_span(f, ExprId(second)).map_or(close, |it| it.1);
        let comma = skip_trivia(src, end as usize) as u32;
        let found = noticed_at(fatal((start, comma + 1), message), comma);
        f.diagnostics.push(found);
    }
}

/// `let a?: T`: the `?`.
#[cold]
#[inline(never)]
pub(super) fn optional_declaration(errors: &mut Errors, at: (u32, u32)) {
    let message = "Optional declaration is not allowed here";
    errors.push(error(0, at, message, "Remove the `?`"));
}

/// `a?!: T` in a class, with the `?` at `question`.
#[cold]
#[inline(never)]
pub(super) fn optional_and_definite(errors: &mut Errors, question: u32) {
    let message = "A property cannot be both optional and definite.";
    let help = "Remove either the `?` or the `!`";
    errors.push(error(0, (question, question + 2), message, help));
}

/// A pattern without an initializer, where nothing else gives it a value: `let [a];`. `next`: the token after the
/// declaration, which is where oxc's parser is when it checks.
#[cold]
#[inline(never)]
pub(super) fn pattern_without_initializer(f: &mut FileBuilder, pattern: PatId, next: u32) {
    let Some(it) = f.pats.get(pattern.idx()) else {
        return;
    };
    let message = "Missing initializer in destructuring declaration";
    let help = "Add an initializer (e.g. ` = undefined`) here";
    let found = error(0, (it.pos, it.end), message, help);
    f.diagnostics.push(noticed_at(found, next));
}

/// `for (let.a of b)`: `at` is the `let.a`.
#[cold]
#[inline(never)]
pub(super) fn let_before_of(errors: &mut Errors, at: (u32, u32)) {
    let message = "The left-hand side of a `for...of` statement may not start with `let`";
    errors.push(noticed_at(error(0, at, message, ""), at.1));
}

/// A piece of an untagged template with an invalid escape. `at`: the text between its delimiters.
#[cold]
#[inline(never)]
pub(super) fn bad_escape_in_template(errors: &mut Errors, at: (u32, u32)) {
    let message = "Bad escape sequence in untagged template literal";
    errors.push(error(0, at, message, ""));
}

/// `for (async of a)`: the `async` is at `at`.
#[cold]
#[inline(never)]
pub(super) fn async_before_of(errors: &mut Errors, at: u32) {
    let message = "The left-hand side of a `for...of` statement may not be `async`";
    let help = "Did you mean to use a for await...of statement?";
    errors.push(error(0, (at, at + 5), message, help));
}

/// `for await (a in b)`, `for await (;;)`: `head` is the statement up to its `)`.
#[cold]
#[inline(never)]
pub(super) fn await_without_of(errors: &mut Errors, head: (u32, u32)) {
    let message = "await can only be used in conjunction with `for...of` statements";
    let help = "Did you mean to use a for...of statement?";
    errors.push(noticed_at(error(0, head, message, help), head.1));
}

// ───────────────────────────── types ─────────────────────────────

/// Checks the modifiers of an interface or type literal member that isn't an index signature.
#[cold]
#[inline(never)]
pub(super) fn type_member(f: &mut FileBuilder, member: &Member) {
    let (modifier_list, errors) = (&f.modifiers, &mut f.diagnostics);
    let modifier_list = modifier_list
        .get(member.modifiers.range())
        .unwrap_or_default();
    let after = modifier_list.last().map_or(0, |it| it.pos + 1);
    verify(modifier_list, Flags::READONLY, &mut |it| {
        let rest = "cannot appear on a type member.";
        let found = about_modifier(1070, it, rest, Help::Allowed(Flags::READONLY));
        errors.push(noticed_at(found, after));
    });
    if member.kind == MemberKind::Method {
        verify(modifier_list, !Flags::READONLY, &mut |it| {
            let rest = "can only appear on a property declaration or index signature.";
            let found = about_modifier(1024, it, rest, Help::None);
            errors.push(noticed_at(found, member.name_pos + 1));
        });
    }
}

/// An index signature without a type, from its `[` to its `]`.
#[cold]
#[inline(never)]
pub(super) fn index_signature_without_type(errors: &mut Errors, brackets: (u32, u32)) {
    let message = "An index signature must have a type annotation.";
    errors.push(error(1021, brackets, message, ""));
}

/// Checks the only parameter of an index signature whose `[` is at `bracket`.
#[cold]
#[inline(never)]
pub(super) fn index_signature_parameter(
    f: &mut FileBuilder,
    src: &[u8],
    param: ParamId,
    bracket: u32,
) {
    let (Some(param), errors) = (f.params.get(param.idx()), &mut f.diagnostics) else {
        return;
    };
    let Some(name) = f.pats.get(param.pat.idx()) else {
        return;
    };
    if param.flags.contains(Flags::REST) {
        return errors.push(fatal((param.pos, param.pos + 3), "Unexpected token"));
    }
    if param.pos != name.pos {
        return errors.push(fatal((name.pos, name.end), "Unexpected token"));
    }
    let Some(ty) = f.types.get(param.ty.idx()) else {
        return;
    };
    if param.default.is_some() {
        let equals = skip_trivia(src, ty.end as usize) as u32;
        let found = fatal((equals, equals + 1), "Expected `,` or `]` but found `=`");
        let open = (bracket, bracket + 1);
        let found = with_labels(found, "`,` or `]` expected", open, "Opened here");
        return errors.push(noticed_at(found, equals));
    }
    // oxc accepts any type in parentheses.
    if src.get(skip_trivia_back(src, ty.pos as usize).wrapping_sub(1)) == Some(&b'(') {
        return;
    }
    errors.push(match ty.kind {
        TypeNodeKind::Keyword(
            Keyword::String | Keyword::Number | Keyword::Symbol | Keyword::Any | Keyword::Intrinsic,
        ) => return,
        TypeNodeKind::Keyword(_) => {
            let message = "An index signature parameter type must be 'string', 'number', 'symbol', or a template literal type.";
            error(1268, (param.pos, param.loc.end), message, "")
        }
        TypeNodeKind::StringLit(_)
        | TypeNodeKind::NumberLit(_)
        | TypeNodeKind::BigIntLit { .. }
        | TypeNodeKind::BoolLit(_) => {
            let message = "An index signature parameter type cannot be a literal type or generic type. Consider using a mapped object type instead.";
            error(1337, (ty.pos, ty.end), message, "")
        }
        _ => return,
    });
}

/// The argument of `import(..)` in a type, which isn't a string.
#[cold]
#[inline(never)]
pub(super) fn argument_of_import_type(errors: &mut Errors, at: (u32, u32)) {
    errors.push(error(1141, at, "String literal expected.", ""));
}

/// An element of an interface's `extends` clause that isn't a name.
#[cold]
#[inline(never)]
pub(super) fn interface_extends_expression(errors: &mut Errors, at: (u32, u32)) {
    let message =
        "An interface can only extend an identifier/qualified-name with optional type arguments.";
    // Reported after errors inside the element and before errors about the token after it.
    let now = at.1.saturating_sub(1).max(at.0);
    errors.push(noticed_at(error(2499, at, message, ""), now));
}

/// The kind of declaration that names a type.
#[derive(Copy, Clone)]
pub(super) enum TypeName {
    Class,
    Interface,
    Enum,
    TypeAlias,
    TypeParameter,
}

/// A declared type name at `at` that's the name of a built-in type: `interface string {}`.
fn reserved_type_name(errors: &mut Errors, src: &[u8], at: (u32, u32), what: TypeName) {
    let (code, what) = match what {
        TypeName::Class => (2414, "Class"),
        TypeName::Interface => (2427, "Interface"),
        TypeName::Enum => (2431, "Enum"),
        TypeName::TypeAlias => (2457, "Type alias"),
        TypeName::TypeParameter => (2368, "Type parameter"),
    };
    let name = src.get(at.0 as usize..at.1 as usize).unwrap_or_default();
    let message = [what.as_bytes(), b" name cannot be '", name, b"'"].concat();
    errors.push(error_with_text(code, at, &message, ""));
}

/// `readonly` at `at`, before a type that is neither `T[]` nor `[T]`.
#[cold]
#[inline(never)]
pub(super) fn readonly_type(errors: &mut Errors, at: u32) {
    let message = "'readonly' type modifier is only permitted on array and tuple literal types.";
    errors.push(error(1354, (at, at + 8), message, ""));
}

/// `infer U` that isn't inside any conditional type's `extends` clause.
#[cold]
#[inline(never)]
pub(super) fn infer_type(errors: &mut Errors, at: (u32, u32)) {
    let message =
        "'infer' declarations are only permitted in the 'extends' clause of a conditional type.";
    errors.push(semantic(1338, at, message));
}

/// `<>` where type parameters are declared.
#[cold]
#[inline(never)]
pub(super) fn empty_type_parameters(errors: &mut Errors, at: (u32, u32)) {
    errors.push(error(1098, at, "Type parameter list cannot be empty.", ""));
}

/// Checks the elements of a tuple type that has an optional element.
#[cold]
#[inline(never)]
pub(super) fn tuple_elements(errors: &mut Errors, elements: &[TupleElem]) {
    let mut optional = None;
    for it in elements {
        if it.optional {
            optional = Some((it.start, it.end));
        } else if let Some(optional) = optional.filter(|_| !it.has_dots) {
            let message = "A required element cannot follow an optional element.";
            let found = error(1257, (it.start, it.end), message, "");
            let found = with_labels(
                found,
                "Required element here",
                optional,
                "Optional element seen here",
            );
            errors.push(noticed_at(found, it.end));
        }
    }
}

/// The comma at `comma`, after the last element of an interface's `extends` clause.
#[cold]
#[inline(never)]
pub(super) fn trailing_comma(errors: &mut Errors, comma: (u32, u32)) {
    errors.push(error(1009, comma, "Trailing comma not allowed.", ""));
}

/// A second class in the `extends` clause of a class.
#[cold]
#[inline(never)]
pub(super) fn second_base_class(errors: &mut Errors, at: (u32, u32)) {
    let help = "Remove the extra base class or use interfaces for multiple inheritance";
    errors.push(error(
        1174,
        at,
        "Classes can only extend a single class.",
        help,
    ));
}

/// A misplaced heritage clause: a second `extends` (1172), `extends` after `implements` (1173), or a second
/// `implements` (1175).
/// `implements`: the first `implements` keyword. `keyword`: the misplaced clause's keyword.
#[cold]
#[inline(never)]
pub(super) fn misplaced_clause(
    errors: &mut Errors,
    code: u32,
    implements: (u32, u32),
    keyword: (u32, u32),
) {
    let found = match code {
        1172 => error(1172, keyword, "'extends' clause already seen", ""),
        1173 => with_labels(
            error(
                1173,
                implements,
                "'extends' clause must precede 'implements' clause",
                "Move the 'extends' clause before the 'implements' clause",
            ),
            "'implements' clause found here",
            keyword,
            "'extends' clause found here",
        ),
        _ => with_labels(
            error(
                1175,
                implements,
                "'implements' clause already seen",
                "Merge the two 'implements' clauses into one by a ','",
            ),
            "",
            keyword,
            "",
        ),
    };
    errors.push(found);
}

/// `implements` at `keyword`, in the head of an interface. `now`: where the body starts.
#[cold]
#[inline(never)]
pub(super) fn interface_implements(errors: &mut Errors, keyword: (u32, u32), now: u32) {
    let message = "Interface declaration cannot have 'implements' clause.";
    errors.push(noticed_at(error(1176, keyword, message, ""), now));
}

// ───────────────────────────── entry points for the parser ─────────────────────────────

/// True if [`function`] has anything to check in a function whose parameters are plain. `context`: `Parser::context`.
#[inline(always)]
fn is_odd_function((kind, flags): (FnKind, Flags), body: &FnBody, context: u32) -> bool {
    let has_body = !matches!(body, FnBody::None);
    let is_generator = flags.contains(Flags::GENERATOR);
    matches!(kind, FnKind::Getter | FnKind::Setter)
        || is_generator && !has_body
        || context & super::ctx::AMBIENT != 0 && (is_generator || kind == FnKind::Decl && has_body)
}

/// Which checks a class member needs.
struct NeededChecks {
    /// Needs [`class_member`].
    needs_class_member: bool,
    /// Needs [`class_members`].
    needs_class_members: bool,
}

impl NeededChecks {
    /// `func`: the function of `member`. `modifier_flags`: its modifiers.
    #[inline]
    fn of(
        member: &Member,
        func: Option<&Func>,
        modifier_flags: Flags,
        site: CallSite,
    ) -> NeededChecks {
        // A member without a body isn't valid JavaScript, which is reported elsewhere.
        if site.is_javascript {
            let usual = match member.kind {
                MemberKind::Method => Flags::STATIC | Flags::ASYNC,
                _ => Flags::STATIC,
            };
            let is_accessor = matches!(member.kind, MemberKind::Getter | MemberKind::Setter);
            return NeededChecks {
                needs_class_member: modifier_flags.intersects(!usual)
                    || member.flags.contains(Flags::DEFINITE)
                    || is_accessor && member.flags.contains(Flags::OPTIONAL),
                needs_class_members: false,
            };
        }
        let is_ambient = site.is_ambient;
        let lacks_body = func.is_some_and(|it| matches!(it.body, FnBody::None));
        let has_body = func.is_some() && !lacks_body;
        let usual = ACCESSIBILITY
            | match member.kind {
                MemberKind::Property => Flags::STATIC | Flags::OVERRIDE | Flags::READONLY,
                MemberKind::Method => Flags::STATIC | Flags::OVERRIDE | Flags::ASYNC,
                MemberKind::Getter | MemberKind::Setter => {
                    Flags::STATIC | Flags::OVERRIDE | Flags::READONLY
                }
                _ => Flags::empty(),
            };
        let needs_class_member = modifier_flags.intersects(!usual)
            || member.flags.contains(Flags::DEFINITE)
            || is_ambient && (has_body || member.init.is_some())
            || modifier_flags.intersects(ACCESSIBILITY) && matches!(member.key, PropKey::Private(_))
            // It may have a decorator.
            || lacks_body && !member.modifiers.is_empty()
            || match member.kind {
                MemberKind::Constructor => {
                    func.is_some_and(|it| !it.type_params.is_empty() || it.ret.is_some())
                }
                MemberKind::Getter | MemberKind::Setter => {
                    lacks_body && !is_ambient || member.flags.contains(Flags::OPTIONAL)
                }
                _ => false,
            };
        NeededChecks {
            needs_class_member,
            needs_class_members: modifier_flags.contains(Flags::ABSTRACT)
                || lacks_body && !is_ambient,
        }
    }
}

impl<const GENERAL: bool, const COMMENTS: bool> Parser<'_, GENERAL, COMMENTS> {
    /// True if this module's errors are enabled.
    #[inline(always)]
    pub(super) fn reports_like_oxc(&self) -> bool {
        self.is_typescript_for_oxc
    }

    /// Like `reports_like_oxc`, for the errors that no other check covers in JavaScript.
    #[inline(always)]
    pub(super) fn is_for_oxc(&self) -> bool {
        self.options.dialect.oxc
    }

    /// Where a type is required, oxc treats `await` and `yield` as names, whatever they are in the surrounding code.
    /// Where oxc only looks ahead for a type, they don't start one: `a as T ? await b : c`.
    #[inline(always)]
    pub(super) fn is_name_in_type_for_oxc(&self) -> bool {
        use crate::token::T;
        matches!(self.token(), T::Await | T::Yield) && self.options.dialect.oxc
    }

    /// oxc's parser gives up at the current token.
    #[cold]
    #[inline(never)]
    pub(super) fn unexpected_like_oxc(&mut self) {
        let at = self.range_of_token();
        self.f.diagnostics.push(unexpected(at));
    }

    /// Like `unexpected_like_oxc`, where oxc's message says what it expected.
    #[cold]
    #[inline(never)]
    pub(super) fn expected_like_oxc(&mut self, wanted: &str) {
        let found = super::recover::oxc_token_name(self.token(), self.lx.text());
        let at = self.range_of_token();
        self.f.diagnostics.push(expected(wanted, &found, at));
    }

    /// At an element of a class's `implements` clause that TypeScript parses as an expression. oxc expects
    /// dot-separated words, optionally followed by type arguments, and then the clause has to continue or end.
    #[cold]
    #[inline(never)]
    pub(super) fn check_implemented_like_oxc(&mut self) {
        use crate::token::T;
        let is_word = |it: T| it.is_identifier_or_keyword() && it != T::PrivateIdentifier;
        self.look_ahead(|p| {
            if !is_word(p.token()) {
                return p.unexpected_like_oxc();
            }
            p.next();
            while p.token() == T::Dot {
                p.next();
                if !is_word(p.token()) {
                    return p.unexpected_like_oxc();
                }
                p.next();
            }
            let mut depth = 0u32;
            loop {
                match p.token() {
                    T::LessThan => depth += 1,
                    T::LessThanLessThan => depth += 2,
                    T::GreaterThan if depth > 0 => depth -= 1,
                    T::Eof => break,
                    _ if depth == 0 => break,
                    _ => {}
                }
                p.next();
                if depth == 0 {
                    break;
                }
            }
            if !matches!(
                p.token(),
                T::Comma | T::OpenBrace | T::Extends | T::Implements
            ) {
                p.expected_like_oxc("{");
            }
        });
    }

    /// Where a declaration is required, after the modifiers above `base`.
    #[cold]
    #[inline(never)]
    pub(super) fn missing_declaration_like_oxc(&mut self, base: usize) {
        use crate::token::T;
        let modifier_list = self.s.modifiers.get(base..).unwrap_or_default();
        let is_export = |it: &Modifier| it.kind == ModifierKind::Keyword(Flags::EXPORT);
        if !modifier_list.first().is_some_and(is_export) || modifier_list.len() < 2 {
            return self.unexpected_like_oxc();
        }
        // After `export @d` oxc parses a class, whatever token is where the keyword belongs.
        let has_given_up = self.look_ahead(|p| {
            if p.token() == T::Default {
                p.next();
            }
            p.next();
            if p.is_identifier() {
                p.next();
            }
            let is_body = p.token() == T::OpenBrace;
            if !is_body {
                p.expected_like_oxc("{");
            }
            !is_body
        });
        if !has_given_up {
            self.unexpected_like_oxc();
        }
        // Reported before TypeScript's errors about the tokens that oxc has consumed.
        if let Some(found) = self.f.diagnostics.pop() {
            self.f.diagnostics.push(noticed_at(found, self.lx.start));
        }
    }

    /// At the `using` of a declaration with the modifiers `flags`. `keyword`: the position of the `await` before it, or
    /// of the `using` itself.
    #[cold]
    #[inline(never)]
    pub(super) fn check_exported_using_like_oxc(&mut self, flags: Flags, keyword: u32) {
        if !flags.contains(Flags::EXPORT) || !self.is_for_oxc() {
            return;
        }
        let is_export = |it: &Modifier| it.kind == ModifierKind::Keyword(Flags::EXPORT);
        let export = self.s.modifiers.iter().rposition(is_export);
        let after_export = export.and_then(|it| self.s.modifiers.get(it + 1));
        let start = after_export.map_or(keyword, |it| it.pos);
        let name = self.look_ahead(|p| {
            p.next();
            (p.lx.start, p.lx.end)
        });
        exported_using(&mut self.f.diagnostics, self.lx.src, start, name);
    }

    /// At a `)` where an expression is required.
    #[cold]
    #[inline(never)]
    pub(super) fn empty_parentheses_like_oxc(&mut self) {
        let at = (self.prev_end(), self.lx.end);
        empty_parentheses(&mut self.f.diagnostics, self.lx.src, at);
    }

    /// At the token after an `import` at `start` that isn't followed by a `(` or a `.`. At the start of a statement,
    /// oxc parses it as a declaration.
    #[cold]
    #[inline(never)]
    pub(super) fn import_without_call_like_oxc(&mut self, start: u32) {
        if !self.is_for_oxc() {
            return;
        }
        match starts_statement(self.lx.src, start) {
            true => self.expected_like_oxc("from"),
            false => self.unexpected_like_oxc(),
        }
        // Reported before TypeScript's error about the token.
        if let Some(found) = self.f.diagnostics.pop() {
            self.f.diagnostics.push(noticed_at(found, start));
        }
    }

    #[inline(always)]
    pub(super) fn call_site(&self) -> CallSite {
        self.call_site_in(self.context)
    }

    /// The parser's state at the end of the last token, in `context`.
    #[inline(always)]
    pub(super) fn call_site_in(&self, context: u32) -> CallSite {
        CallSite {
            now: self.prev_end(),
            is_ambient: context & super::ctx::AMBIENT != 0,
            is_in_type: context & super::ctx::TYPE != 0,
            is_class_member: context & super::ctx::CLASS_MEMBER != 0,
            is_javascript: self.options.is_javascript,
        }
    }

    /// True if `check_function_like_oxc` has anything to check in a function. `odd_parameters`:
    /// `Parser::odd_parameters` before the function's parameters.
    #[inline(always)]
    pub(super) fn is_odd_function(
        &self,
        signature: (FnKind, Flags),
        (odd_parameters, this): (u32, ParamId),
        body: &FnBody,
    ) -> bool {
        self.is_for_oxc()
            && (self.odd_parameters != odd_parameters
                || this.is_some()
                || self.reports_like_oxc() && is_odd_function(signature, body, self.context))
    }

    /// At a declared type's name that's a TypeScript keyword.
    #[cold]
    #[inline(never)]
    pub(super) fn check_type_name_like_oxc(&mut self, what: TypeName) {
        use crate::token::T;
        let is_reserved = matches!(
            self.token(),
            T::Any
                | T::Unknown
                | T::Never
                | T::NumberKeyword
                | T::BigIntKeyword
                | T::Boolean
                | T::StringKeyword
                | T::Symbol
                | T::Object
                | T::Undefined
        );
        if is_reserved {
            let at = (self.lx.start, self.lx.end);
            reserved_type_name(&mut self.f.diagnostics, self.lx.src, at, what);
        }
    }

    /// Call after the function `id`. `open_brace`: the `{` of its body.
    #[cold]
    #[inline(never)]
    pub(super) fn check_function_like_oxc(&mut self, id: FnId, open_brace: u32) {
        let (site, can_end_here) = (self.call_site(), self.can_parse_semicolon());
        function(&mut self.f, self.lx.src, id, open_brace, site, can_end_here);
    }

    /// Call after a class member that's neither a static block nor an index signature. `modifier_flags`: its modifiers.
    /// `name`: its name's range. `context`: the member's context.
    #[inline]
    pub(super) fn check_class_member_like_oxc(
        &mut self,
        member: &Member,
        modifier_flags: Flags,
        name: (u32, u32),
        context: u32,
    ) {
        let site = self.call_site_in(context);
        let func = self.f.fns.get(member.func.idx());
        let odd = NeededChecks::of(member, func, modifier_flags, site);
        self.has_odd_members |= odd.needs_class_members;
        if odd.needs_class_member {
            let it = ClassMember { member, name, site };
            class_member(&mut self.f, self.lx.src, &it);
        }
    }
}
