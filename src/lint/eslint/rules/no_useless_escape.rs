use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::regex::{self, ast::Kind as RegexKind, ast::NodeType};

/// Disallow unnecessary escape characters.
pub struct NoUselessEscape {
    allow_regex_characters: Vec<Vec<u8>>,
}

const UNNECESSARY_ESCAPE: Message = Message::new(
    "unnecessaryEscape",
    "Unnecessary escape character: \\{{character}}.",
);
const REMOVE_ESCAPE: Message = Message::new(
    "removeEscape",
    "Remove the `\\`. This maintains the current functionality.",
);
const REMOVE_ESCAPE_DO_NOT_KEEP_SEMANTICS: Message = Message::new(
    "removeEscapeDoNotKeepSemantics",
    "Remove the `\\` if it was inserted by mistake.",
);
const ESCAPE_BACKSLASH: Message = Message::new(
    "escapeBackslash",
    "Replace the `\\` with `\\\\` to include the actual backslash character.",
);

const REGEX_GENERAL_ESCAPES: &[u8] = b"\\bcdDfnpPrsStvwWxu0123456789]";
/// Besides `REGEX_GENERAL_ESCAPES`.
const REGEX_NON_CHARCLASS_ESCAPES: &[u8] = b"^/.$*+?[{}|()Bk";
/// Besides `REGEX_GENERAL_ESCAPES`.
const REGEX_CLASSSET_CHARACTER_ESCAPES: &[u8] = b"q/[{}|()-";
const REGEX_CLASS_SET_RESERVED_DOUBLE_PUNCTUATOR: &[u8] = b"!#$%&*+,.:;<=>?@^`~";

#[derive(Copy, Clone, PartialEq, Eq)]
enum Quoted {
    /// A `Literal`.
    String,
    /// The `Literal` of a directive.
    Directive,
    /// A `TemplateElement`, with its delimiters.
    Template,
}

/// How many bytes the character has that starts with `lead`.
fn utf8_len(lead: u8) -> usize {
    match lead {
        0..0xC0 => 1,
        0xC0..0xE0 => 2,
        0xE0..0xF0 => 3,
        _ => 4,
    }
}

/// `backslash`: where it is. `character`: what it escapes.
fn report<'a>(
    backslash: u32,
    character: &'a [u8],
    is_directive: bool,
    suggests_escaping_backslash: bool,
    cx: &Cx<'a, NoUselessEscape>,
) {
    let range = Span::new(backslash, backslash + 1);
    let remove = match is_directive {
        true => REMOVE_ESCAPE_DO_NOT_KEEP_SEMANTICS,
        false => REMOVE_ESCAPE,
    };
    let report = cx.report(range, UNNECESSARY_ESCAPE).data("character", character);
    // What ESLint suggests is a fix in oxlint.
    if cx.language().is_oxlint {
        report.fix(|fixer| fixer.remove(range));
        return;
    }
    let report = report.suggest(remove, |fixer| fixer.remove(range));
    if suggests_escaping_backslash {
        report.suggest(ESCAPE_BACKSLASH, |fixer| fixer.insert_before(range, "\\"));
    }
}

/// What oxlint 1.87 passes over: in a string a backslash after a backslash, also the third of `\\\"`, and in a template
/// `\$` before a substitution or the end.
fn oxlint_passes_over(raw: &[u8], index: usize, quoted: Quoted) -> bool {
    match quoted {
        Quoted::Template => matches!(raw.get(index + 1..), Some(b"$${" | b"$`")),
        _ => index > 0 && raw.get(index - 1) == Some(&b'\\'),
    }
}

/// ESLint's `validateString`, for each `/\\\D/gu` in the text of `span`.
fn validate_string(span: Span, quoted: Quoted, cx: &Cx<'_, NoUselessEscape>) {
    let raw = cx.slice(span);
    let mut at = 0;
    while let Some(found) = raw.get(at..).and_then(|rest| strings::index_of_char_usize(rest, b'\\')) {
        let index = at + found;
        let Some(&escaped) = raw.get(index + 1) else {
            return;
        };
        if escaped.is_ascii_digit() {
            at = index + 1;
            continue;
        }
        at = index + 1 + utf8_len(escaped);
        let character = raw.get(index + 1..at).unwrap_or_default();
        let is_valid = match escaped {
            b'\\' | b'n' | b'r' | b'v' | b't' | b'b' | b'f' | b'u' | b'x' | b'\n' | b'\r' => true,
            b'`' => quoted == Quoted::Template,
            b'$' if quoted == Quoted::Template => raw.get(index + 2) == Some(&b'{'),
            b'{' if quoted == Quoted::Template => index > 0 && raw.get(index - 1) == Some(&b'$'),
            b'"' | b'\'' => quoted != Quoted::Template && raw.first() == Some(&escaped),
            _ => matches!(character, b"\xE2\x80\xA8" | b"\xE2\x80\xA9"),
        };
        if !is_valid && !(cx.language().is_oxlint && oxlint_passes_over(raw, index, quoted)) {
            report(span.start + index as u32, character, quoted == Quoted::Directive, true, cx);
        }
    }
}

/// Whether some `\` in `pattern` is before a character that need not be escaped everywhere.
fn may_have_useless_escape(pattern: &[u8]) -> bool {
    let has_class = strings::contains_char(pattern, b'[');
    let mut at = 0;
    while let Some(found) = pattern.get(at..).and_then(|rest| strings::index_of_char_usize(rest, b'\\')) {
        at += found + 2;
        let Some(&escaped) = pattern.get(at - 1) else {
            return false;
        };
        if !strings::contains_char(REGEX_GENERAL_ESCAPES, escaped)
            && (has_class || !strings::contains_char(REGEX_NON_CHARCLASS_ESCAPES, escaped))
        {
            return true;
        }
    }
    false
}

/// Whether there is a `\` in `span`.
#[inline]
fn has_backslash(span: Span, cx: &Cx<'_, NoUselessEscape>) -> bool {
    let next = cx.state.partition_point(|&at| at < span.start);
    cx.state.get(next).is_some_and(|&at| at < span.end)
}

/// `` [`a`] ``, which is a `TemplateLiteral` for ESLint and not an expression here. `owner`: what has the key.
fn check_template_key<'a>(owner: Span, key: impl FnOnce() -> Option<Key<'a>>, cx: &Cx<'a, NoUselessEscape>) {
    if has_backslash(owner, cx)
        && let Some(key) = key()
        && matches!(key.kind(), KeyKind::ComputedString(_))
    {
        let span = key.inner_span(cx.file());
        if cx.slice(span).starts_with(b"`") {
            validate_string(span, Quoted::Template, cx);
        }
    }
}

impl NoUselessEscape {
    fn check_literal<'a>(&self, literal: Literal<'a>, cx: &mut Cx<'a, Self>) {
        if !has_backslash(literal.span(), cx) {
            return;
        }
        let quoted = match literal.owner() {
            Node::Expr(e) => match e.parent() {
                Node::Prop(prop) if prop.is_jsx_attribute() && e.jsx_container_span().is_none() => return,
                Node::Stmt(statement) if ast_utils::is_directive(statement) => Quoted::Directive,
                _ => Quoted::String,
            },
            _ => Quoted::String,
        };
        validate_string(literal.span(), quoted, cx);
    }

    fn check_template<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if !has_backslash(e.span(), cx) {
            return;
        }
        let ExprKind::Template(template) = e.kind() else {
            return;
        };
        // The function that is the tag can see the backslashes.
        if let Node::Expr(parent) = e.parent()
            && let ExprKind::TaggedTemplate(call) = parent.kind()
            && call.template() == Some(e)
        {
            return;
        }
        for i in 0..template.quasi_count() {
            validate_string(template.quasi_span(i), Quoted::Template, cx);
        }
    }

    /// ESLint's `validateRegExp`
    fn check_regex<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if !has_backslash(e.span(), cx) {
            return;
        }
        let ExprKind::Regex(literal) = e.kind() else {
            return;
        };
        let pattern = literal.pattern();
        if !may_have_useless_escape(pattern) {
            return;
        }
        let mode = regex::Mode::of_flags(literal.flags());
        let Ok(ast) = regex::parse_pattern(pattern, mode, regex::Options::default()) else {
            return;
        };
        for character in ast.root().descendants() {
            let Some((escaped, is_in_set_operation)) = self.useless_escape(character, mode.unicode_sets) else {
                continue;
            };
            let start = character.start() as usize;
            let text = pattern.get(start + 1..start + 1 + escaped).unwrap_or_default();
            let is_whole = text.first().is_some_and(|&lead| utf8_len(lead) == text.len());
            report(
                e.span().start + 1 + character.start(),
                if is_whole { text } else { "\u{FFFD}".as_bytes() },
                false,
                !is_in_set_operation,
                cx,
            );
        }
    }

    /// If `node` is a character with a `\` that is not needed: the length of the character, and
    /// whether it is an operand of `&&` or `--`.
    fn useless_escape(&self, node: regex::Node<'_>, unicode_sets: bool) -> Option<(usize, bool)> {
        let value = node.character()?;
        let escaped = node.raw().strip_prefix(b"\\")?;
        let stands_for_itself = match char::from_u32(value) {
            Some(value) => escaped == value.encode_utf8(&mut [0; 4]).as_bytes(),
            // Without the `u` and `v` flags, the first half of a character outside the BMP. Not `\ud83d`.
            None => escaped.len() == 2,
        };
        if !stands_for_itself || self.allow_regex_characters.iter().any(|it| it == escaped) {
            return None;
        }
        let class = node.ancestors().find(|it| {
            matches!(it.ty(), NodeType::CharacterClass | NodeType::ExpressionCharacterClass)
        });
        // Only characters of ASCII are special.
        let byte = *escaped.first().filter(|_| escaped.len() == 1).unwrap_or(&0x80);
        let also_allowed: &[u8] = match class {
            Some(_) if unicode_sets => REGEX_CLASSSET_CHARACTER_ESCAPES,
            Some(_) => b"",
            None => REGEX_NON_CHARCLASS_ESCAPES,
        };
        if strings::contains_char(REGEX_GENERAL_ESCAPES, byte) || strings::contains_char(also_allowed, byte) {
            return None;
        }
        let Some(class) = class else {
            return Some((escaped.len(), false));
        };
        let is_first = class.start() + 1 == node.start();
        if byte == b'^' && is_first {
            return None;
        }
        if !unicode_sets {
            let is_last = node.end() + 1 == class.end();
            return (byte != b'-' || is_first || is_last).then_some((escaped.len(), false));
        }
        if strings::contains_char(REGEX_CLASS_SET_RESERVED_DOUBLE_PUNCTUATOR, byte) {
            let pattern = node.ast().source();
            if pattern.get(node.end() as usize) == Some(&byte) {
                return None;
            }
            let before = (node.start() as usize).checked_sub(1).and_then(|it| pattern.get(it));
            if before == Some(&byte) {
                let is_negated = matches!(
                    class.kind(),
                    RegexKind::CharacterClass { negate: true, .. }
                        | RegexKind::ExpressionCharacterClass { negate: true, .. }
                );
                // Unless what is before is the `^` that negates the class.
                if byte != b'^' || !is_negated || class.start() + 2 < node.start() {
                    return None;
                }
            }
        }
        let is_in_set_operation = node.parent().is_some_and(|it| {
            matches!(it.ty(), NodeType::ClassIntersection | NodeType::ClassSubtraction)
        });
        Some((escaped.len(), is_in_set_operation))
    }

    /// The templates among the types.
    fn check_type<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        if !has_backslash(ty.span(), cx) {
            return;
        }
        if let Some(template) = ty.as_template() {
            for i in 0..template.quasi_count() {
                validate_string(template.quasi_span(i), Quoted::Template, cx);
            }
        } else if ty.text().starts_with(b"`") {
            validate_string(ty.span(), Quoted::Template, cx);
        }
    }
}

impl Rule for NoUselessEscape {
    const META: Meta = Meta::eslint("no-useless-escape", Kind::Suggestion)
        .has_suggestions()
        .recommended();
    /// Where the `\` of the file are, in order.
    type State<'a> = Vec<u32>;

    fn new(options: &Options) -> Self {
        let allowed = options.object(0).strings("allowRegexCharacters");
        NoUselessEscape {
            allow_regex_characters: allowed.into_iter().map(|it| it.as_bytes().to_vec()).collect(),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Vec<u32> {
        let (text, mut backslashes, mut at) = (file.text(), Vec::new(), 0);
        while let Some(found) = text.get(at..).and_then(|rest| strings::index_of_char_usize(rest, b'\\')) {
            backslashes.push((at + found) as u32);
            at += found + 1;
        }
        if backslashes.is_empty() {
            return backslashes;
        }
        on.string_literals(Self::check_literal);
        on.exprs([ExprTag::Template], Self::check_template);
        on.exprs([ExprTag::Regex], Self::check_regex);
        if !strings::contains_char(text, b'`') {
            return backslashes;
        }
        on.types([TypeTag::StringLit, TypeTag::Template], Self::check_type);
        on.props(|_, prop, cx| check_template_key(prop.span(), || prop.key(), cx));
        on.members(|_, member, cx| check_template_key(member.span(), || member.key(), cx));
        on.pats([PatTag::Object], |_, pat, cx| {
            if has_backslash(pat.span(), cx)
                && let PatKind::Object(props) = pat.kind()
            {
                props.iter().for_each(|prop| check_template_key(pat.span(), || prop.key(), cx));
            }
        });
        backslashes
    }
}
