use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::regex::ast::NodeType;
use bun_lint::regex::{self, Ignore, Mode, parse_pattern, validate_flags, validate_pattern};
use bun_lint::utils::ast_utils::{TokenOrText, can_tokens_be_adjacent};
use bun_lint::utils::eslint_utils::{ReferenceTracker, TraceMap};
use bun_lint::utils::regular_expressions::REGEXPP_LATEST_ECMA_VERSION;
use std::borrow::Cow;

/// Disallow use of the `RegExp` constructor in favor of regular expression literals.
pub struct PreferRegexLiterals {
    disallow_redundant_wrapping: bool,
}

const UNEXPECTED_REGEXP: Message = Message::new(
    "unexpectedRegExp",
    "Use a regular expression literal instead of the 'RegExp' constructor.",
);
const REPLACE_WITH_LITERAL: Message = Message::new(
    "replaceWithLiteral",
    "Replace with an equivalent regular expression literal.",
);
const REPLACE_WITH_LITERAL_AND_FLAGS: Message = Message::new(
    "replaceWithLiteralAndFlags",
    "Replace with an equivalent regular expression literal with flags '{{ flags }}'.",
);
const REPLACE_WITH_INTENDED_LITERAL_AND_FLAGS: Message = Message::new(
    "replaceWithIntendedLiteralAndFlags",
    "Replace with a regular expression literal with flags '{{ flags }}'.",
);
const UNEXPECTED_REDUNDANT_REGEXP: Message = Message::new(
    "unexpectedRedundantRegExp",
    "Regular expression literal is unnecessarily wrapped within a 'RegExp' constructor.",
);
const UNEXPECTED_REDUNDANT_REGEXP_WITH_FLAGS: Message = Message::new(
    "unexpectedRedundantRegExpWithFlags",
    "Use regular expression literal with flags instead of the 'RegExp' constructor.",
);

const TRACE_MAP: TraceMap<'static, ()> =
    TraceMap::new(&[("RegExp", TraceMap::EMPTY.call(()).construct(()))]);

/// ESLint's `validPrecedingTokens`
fn is_valid_preceding_token(token: &[u8]) -> bool {
    matches!(
        token,
        b"(" | b";"
            | b"["
            | b","
            | b"="
            | b"+"
            | b"*"
            | b"-"
            | b"?"
            | b"~"
            | b"%"
            | b"**"
            | b"!"
            | b"typeof"
            | b"instanceof"
            | b"&&"
            | b"||"
            | b"??"
            | b"return"
            | b"..."
            | b"delete"
            | b"void"
            | b"in"
            | b"<"
            | b">"
            | b"<="
            | b">="
            | b"=="
            | b"==="
            | b"!="
            | b"!=="
            | b"<<"
            | b">>"
            | b">>>"
            | b"&"
            | b"|"
            | b"^"
            | b":"
            | b"{"
            | b"=>"
            | b"*="
            | b"<<="
            | b">>="
            | b">>>="
            | b"^="
            | b"|="
            | b"&="
            | b"??="
            | b"||="
            | b"&&="
            | b"**="
            | b"+="
            | b"-="
            | b"/="
            | b"%="
            | b"/"
            | b"do"
            | b"break"
            | b"continue"
            | b"debugger"
            | b"case"
            | b"throw"
    )
}

/// The `value.raw` of a `TemplateElement`: a line break is a line feed, however it is written.
fn template_raw_value(written: &[u8]) -> Cow<'_, [u8]> {
    if !strings::contains_char(written, b'\r') {
        return Cow::Borrowed(written);
    }
    let mut raw = Vec::with_capacity(written.len());
    let mut previous = 0;
    for &byte in written {
        match byte {
            b'\r' => raw.push(b'\n'),
            b'\n' if previous == b'\r' => {}
            _ => raw.push(byte),
        }
        previous = byte;
    }
    Cow::Owned(raw)
}

/// ESLint's `getStringValue`. It is `Some` if `isStaticString` holds: for a string literal, a
/// template without substitutions, and such a template that is tagged with `String.raw`.
fn get_string_value(e: Expr<'_>) -> Option<Cow<'_, [u8]>> {
    match e.kind() {
        ExprKind::String(value) => Some(Cow::Borrowed(value.bytes())),
        ExprKind::Template(template) => Some(Cow::Borrowed(template.as_static()?.bytes())),
        ExprKind::TaggedTemplate(tagged) => {
            let tag = tagged.callee();
            let ExprKind::Template(template) = tagged.template()?.kind() else {
                return None;
            };
            let is_string_raw = template.exprs().is_empty()
                && ast_utils::is_specific_member_access(tag, Some("String"), Some("raw"))
                && ast_utils::member_object(tag).is_some_and(ast_utils::is_global_reference);
            is_string_raw.then(|| template_raw_value(template.raw(0)))
        }
        _ => None,
    }
}

fn regexpp_options(file: &File<'_>) -> regex::Options {
    regex::Options::ecma_version(file.language().ecma_version.clamp(5, REGEXPP_LATEST_ECMA_VERSION))
}

/// ESLint's `resolveEscapes`
fn resolve_escapes(character: &[u8]) -> Option<&'static [u8; 2]> {
    match character {
        b"\n" | b"\\\n" => Some(b"\\n"),
        b"\r" | b"\\\r" => Some(b"\\r"),
        b"\t" | b"\\\t" => Some(b"\\t"),
        b"\x0B" | b"\\\x0B" => Some(b"\\v"),
        b"\x0C" | b"\\\x0C" => Some(b"\\f"),
        b"/" => Some(b"\\/"),
        _ => None,
    }
}

/// ESLint's `isValidRegexForEcmaVersion`
fn is_valid_regex_for_ecma_version(file: &File<'_>, pattern: &[u8], flags: &[u8]) -> bool {
    let options = regexpp_options(file);
    validate_pattern(pattern, Mode::of_flags(flags), options, &mut Ignore).is_ok()
        && (flags.is_empty() || validate_flags(flags, options, &mut Ignore).is_ok())
}

/// ESLint's `areFlagsEqual`
fn are_flags_equal(a: &[u8], b: &[u8]) -> bool {
    let sorted = |flags: &[u8]| {
        let mut flags = flags.to_vec();
        flags.sort_unstable();
        flags
    };
    sorted(a) == sorted(b)
}

/// ESLint's `mergeRegexFlags`
fn merge_regex_flags(a: &[u8], b: &[u8]) -> Vec<u8> {
    let mut merged = Vec::with_capacity(a.len() + b.len());
    for &flag in a.iter().chain(b) {
        if !strings::contains_char(&merged, flag) {
            merged.push(flag);
        }
    }
    merged
}

/// ESLint's `canFixTo`
fn can_fix_to(node: Expr<'_>, pattern: &[u8], flags: &[u8]) -> bool {
    let file = node.file();
    file.comments_in(node).next().is_none()
        && file.token_before(node).is_none_or(|before| is_valid_preceding_token(before.text()))
        && is_valid_regex_for_ecma_version(file, pattern, flags)
}

/// ESLint's `getSafeOutput`
fn get_safe_output(node: Expr<'_>, new_regexp_value: &[u8]) -> Vec<u8> {
    let (file, span) = (node.file(), node.span());
    let needs_space_before = file.token_before(node).is_some_and(|before| {
        before.end() == span.start
            && !can_tokens_be_adjacent(TokenOrText::Token(before.kind(), before.text()), new_regexp_value)
    });
    let needs_space_after = file.token_after(node).is_some_and(|after| {
        span.end == after.start()
            && !can_tokens_be_adjacent(new_regexp_value, TokenOrText::Token(after.kind(), after.text()))
    });
    let mut output = Vec::with_capacity(new_regexp_value.len() + 2);
    if needs_space_before {
        output.push(b' ');
    }
    output.extend_from_slice(new_regexp_value);
    if needs_space_after {
        output.push(b' ');
    }
    output
}

/// Replaces `node` by `/pattern/flags`, if that is possible.
fn replace_with_literal<'a>(fixer: Fixer<'a>, node: Expr<'a>, pattern: &[u8], flags: &[u8]) -> Option<Fix> {
    if !can_fix_to(node, pattern, flags) {
        return None;
    }
    let literal = [&b"/"[..], pattern, b"/", flags].concat();
    Some(fixer.replace(node, get_safe_output(node, &literal)))
}

/// Replaces `node` by the literal for `new RegExp(content, flags)`, if that is possible.
fn replace_with_equivalent_literal<'a>(
    fixer: Fixer<'a>,
    node: Expr<'a>,
    content: &[u8],
    flags: &[u8],
) -> Option<Fix> {
    // Printable characters of ASCII and whitespace.
    let is_simple = content.iter().all(|byte| matches!(byte, b' '..=b'~' | b'\t'..=b'\r'));
    if !is_simple || !can_fix_to(node, content, flags) {
        return None;
    }
    let mut literal = Vec::with_capacity(content.len() + flags.len() + 8);
    literal.push(b'/');
    if content.is_empty() {
        literal.extend_from_slice(b"(?:)");
    } else {
        let ast = parse_pattern(content, Mode::of_flags(flags), regexpp_options(fixer.file())).ok()?;
        let mut copied = 0;
        for character in ast.root().descendants().filter(|it| it.ty() == NodeType::Character) {
            if let Some(escaped) = resolve_escapes(character.raw()) {
                literal.extend_from_slice(content.get(copied..character.start() as usize)?);
                literal.extend_from_slice(escaped);
                copied = character.end() as usize;
            }
        }
        literal.extend_from_slice(content.get(copied..)?);
    }
    literal.push(b'/');
    literal.extend_from_slice(flags);
    Some(fixer.replace(node, get_safe_output(node, &literal)))
}

impl PreferRegexLiterals {
    fn check_calls<'a>(&self, cx: &mut Cx<'a, Self>) {
        for reference in ReferenceTracker::new(cx.file()).iterate_global_references(&TRACE_MAP) {
            let (Some(node), Some(call)) = (reference.expr(), reference.call()) else {
                continue;
            };
            let arguments = call.args();
            let (Some(first), second) = (arguments.first(), arguments.get(1)) else {
                continue;
            };
            if arguments.len() > 2 {
                continue;
            }
            // Those of a second argument that is a static string.
            let flags = match second {
                Some(second) => match get_string_value(second) {
                    Some(flags) => flags,
                    None => continue,
                },
                None => Cow::Borrowed(&b""[..]),
            };
            if let ExprKind::Regex(literal) = first.kind() {
                if !self.disallow_redundant_wrapping {
                    continue;
                }
                let pattern = literal.pattern();
                if second.is_none() {
                    cx.report(node, UNEXPECTED_REDUNDANT_REGEXP).suggest(REPLACE_WITH_LITERAL, |fixer| {
                        replace_with_literal(fixer, node, pattern, literal.flags())
                    });
                    continue;
                }
                let report = cx.report(node, UNEXPECTED_REDUNDANT_REGEXP_WITH_FLAGS).suggest_with(
                    REPLACE_WITH_LITERAL_AND_FLAGS,
                    &[("flags", &*flags)],
                    |fixer| replace_with_literal(fixer, node, pattern, &flags),
                );
                let merged_flags = merge_regex_flags(literal.flags(), &flags);
                if !are_flags_equal(&merged_flags, &flags) {
                    report.suggest_with(
                        REPLACE_WITH_INTENDED_LITERAL_AND_FLAGS,
                        &[("flags", &merged_flags[..])],
                        |fixer| replace_with_literal(fixer, node, pattern, &merged_flags),
                    );
                }
            } else if let Some(content) = get_string_value(first) {
                cx.report(node, UNEXPECTED_REGEXP).suggest(REPLACE_WITH_LITERAL, |fixer| {
                    replace_with_equivalent_literal(fixer, node, &content, &flags)
                });
            }
        }
    }
}

impl Rule for PreferRegexLiterals {
    const META: Meta = Meta::eslint("prefer-regex-literals", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        PreferRegexLiterals {
            disallow_redundant_wrapping: options.object(0).bool_or("disallowRedundantWrapping", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        // Finding the calls takes resolving every name of the file.
        if file.mentions("RegExp") {
            on.finish(Self::check_calls);
        }
    }
}
