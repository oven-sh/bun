use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::keywords::is_keyword;
use std::borrow::Cow;

/// Require quotes around object literal property names.
pub struct QuoteProps {
    mode: Mode,
    keywords: bool,
    check_unnecessary: bool,
    numbers: bool,
}

#[derive(Copy, Clone, PartialEq)]
enum Mode {
    Always,
    AsNeeded,
    Consistent,
    ConsistentAsNeeded,
}

const REQUIRE_QUOTES_DUE_TO_RESERVED_WORD: Message = Message::new(
    "requireQuotesDueToReservedWord",
    "Properties should be quoted as '{{property}}' is a reserved word.",
);
const INCONSISTENTLY_QUOTED_PROPERTY: Message =
    Message::new("inconsistentlyQuotedProperty", "Inconsistently quoted property '{{key}}' found.");
const UNNECESSARILY_QUOTED_PROPERTY: Message =
    Message::new("unnecessarilyQuotedProperty", "Unnecessarily quoted property '{{property}}' found.");
const UNQUOTED_RESERVED_PROPERTY: Message =
    Message::new("unquotedReservedProperty", "Unquoted reserved word '{{property}}' used as key.");
const UNQUOTED_NUMERIC_PROPERTY: Message =
    Message::new("unquotedNumericProperty", "Unquoted number literal '{{property}}' used as key.");
const UNQUOTED_PROPERTY_FOUND: Message = Message::new("unquotedPropertyFound", "Unquoted property '{{property}}' found.");
const REDUNDANT_QUOTING: Message =
    Message::new("redundantQuoting", "Properties shouldn't be quoted as all quotes are redundant.");

/// The key of a `Property` of an `ObjectExpression`, or of an `ObjectPattern` in an assignment, that
/// is not a method, computed or a shorthand.
fn key_of_prop(prop: Prop<'_>) -> Option<Key<'_>> {
    if matches!(prop.kind(), PropKind::Method | PropKind::Shorthand | PropKind::Spread) || prop.is_jsx_attribute() {
        return None;
    }
    prop.key().filter(|key| !key.is_computed())
}

/// The same for a `Property` of an `ObjectPattern` in a declaration or a parameter.
fn key_of_pat_prop(prop: PatProp<'_>) -> Option<Key<'_>> {
    if prop.is_shorthand() {
        return None;
    }
    prop.key().filter(|key| !key.is_computed())
}

/// Whether `object` is the `{ type: "json" }` of `with { type: "json" }`, which ESLint has no
/// `ObjectExpression` for.
fn is_import_attributes(object: Expr<'_>) -> bool {
    matches!(object.parent(), Node::File(_))
}

/// What `espree.tokenize(raw_key)[0].value` is, if `raw_key` is one token that is a word. As the
/// default `ecmaVersion` is 5, there are no characters outside of the BMP and no `\u{..}` in a word.
fn tokenize_word(raw_key: &[u8]) -> Option<Cow<'_, [u8]>> {
    fn is_start(c: u32) -> bool {
        c <= 0xFFFF && bun_core::lexer::is_identifier_start(c)
    }
    fn is_part(c: u32) -> bool {
        c <= 0xFFFF && bun_core::lexer::is_type_script_identifier_part(c as i32)
    }
    if !strings::contains_char(raw_key, b'\\') {
        let mut points = strings::wtf8_codepoints(raw_key).map(|it| it.1);
        return (points.next().is_some_and(is_start) && points.all(is_part)).then_some(Cow::Borrowed(raw_key));
    }
    let mut word = Vec::with_capacity(raw_key.len());
    let mut points = strings::wtf8_codepoints(raw_key);
    while let Some((at, c)) = points.next() {
        let is_allowed: fn(u32) -> bool = if at == 0 { is_start } else { is_part };
        if c != u32::from(b'\\') {
            if !is_allowed(c) {
                return None;
            }
            word.extend_from_slice(char::from_u32(c)?.encode_utf8(&mut [0; 4]).as_bytes());
            continue;
        }
        let digits = raw_key.get(at + 2..at + 6)?;
        if raw_key.get(at + 1) != Some(&b'u') || !digits.iter().all(u8::is_ascii_hexdigit) {
            return None;
        }
        let escaped = digits.iter().fold(0, |value, digit| value * 16 + char::from(*digit).to_digit(16).unwrap_or(0));
        if !is_allowed(escaped) {
            return None;
        }
        word.extend_from_slice(char::from_u32(escaped)?.encode_utf8(&mut [0; 4]).as_bytes());
        // The `uXXXX`.
        points.nth(4)?;
    }
    // acorn throws "Escape sequence in keyword".
    let is_es5_keyword = matches!(
        word.as_slice(),
        b"break" | b"case" | b"catch" | b"continue" | b"debugger" | b"default" | b"do" | b"else" | b"finally"
            | b"for" | b"function" | b"if" | b"return" | b"switch" | b"throw" | b"try" | b"var" | b"while"
            | b"with" | b"null" | b"true" | b"false" | b"instanceof" | b"typeof" | b"void" | b"delete" | b"new"
            | b"in" | b"this"
    );
    (!is_es5_keyword).then_some(Cow::Owned(word))
}

/// Reports the property at `span`, whose key is `key`. The fix quotes a key that is not quoted, and
/// the other way round. `data`: what `{{name}}` is in the message, if not the name of the property.
fn report<'a>(
    cx: &Cx<'a, QuoteProps>,
    span: Span,
    key: Key<'a>,
    message: Message,
    name: &'static str,
    data: Option<Name<'a>>,
) {
    let Some(value) = key.name() else {
        return;
    };
    cx.report(span, message).data(name, data.unwrap_or(value)).fix(|fixer| {
        let at = key.span(fixer.file());
        match key.kind() {
            KeyKind::String(_) => fixer.replace(at, value),
            _ => fixer.replace(at, [&b"\""[..], value.bytes(), &b"\""[..]].concat()),
        }
    });
}

impl QuoteProps {
    /// Whether the key `"raw_key"` has to be quoted: not ESLint's `areQuotesRedundant`, or it is a
    /// reserved word and those are to be quoted.
    fn are_quotes_needed(&self, raw_key: &[u8], skip_number_literals: bool) -> bool {
        match raw_key.first() {
            // What `String(n)` returns is a token.
            Some(b'0'..=b'9') => {
                skip_number_literals || text::number_to_string(bun_core::fmt::js_string_to_number(raw_key)) != raw_key
            }
            _ => tokenize_word(raw_key).is_none_or(|word| self.keywords && is_keyword(&word)),
        }
    }

    /// ESLint's `checkOmittedQuotes` and `checkUnnecessaryQuotes`.
    fn check_property(&self, key: Key<'_>) -> Option<Message> {
        match (self.mode, key.kind()) {
            (Mode::Always, KeyKind::Ident(_) | KeyKind::Number(_)) => Some(UNQUOTED_PROPERTY_FOUND),
            (Mode::AsNeeded, KeyKind::String(value)) => (self.check_unnecessary
                && !self.are_quotes_needed(value.bytes(), self.numbers))
            .then_some(UNNECESSARILY_QUOTED_PROPERTY),
            (Mode::AsNeeded, KeyKind::Ident(name)) => {
                (self.keywords && is_keyword(name.bytes())).then_some(UNQUOTED_RESERVED_PROPERTY)
            }
            (Mode::AsNeeded, KeyKind::Number(_)) => self.numbers.then_some(UNQUOTED_NUMERIC_PROPERTY),
            _ => None,
        }
    }

    /// `object`: the expression that has the `properties`.
    fn check_consistency_of<'a>(&self, properties: List<'a, Prop<'a>>, object: Option<Expr<'a>>, cx: &Cx<'a, Self>) {
        let check_quotes_redundancy = self.mode == Mode::ConsistentAsNeeded;
        let (mut has_quoted, mut has_unquoted) = (false, false);
        let (mut keyword_key_name, mut necessary_quotes) = (None, false);
        for key in properties.iter().filter_map(key_of_prop) {
            match key.kind() {
                KeyKind::String(value) => {
                    has_quoted = true;
                    if check_quotes_redundancy {
                        necessary_quotes = necessary_quotes || self.are_quotes_needed(value.bytes(), false);
                    }
                }
                KeyKind::Ident(name) if self.keywords && check_quotes_redundancy && is_keyword(name.bytes()) => {
                    has_unquoted = true;
                    necessary_quotes = true;
                    keyword_key_name = Some(name);
                }
                _ => has_unquoted = true,
            }
        }
        let (message, name, reports_quoted) = if check_quotes_redundancy && has_quoted && !necessary_quotes {
            (REDUNDANT_QUOTING, "property", true)
        } else if has_unquoted && keyword_key_name.is_some() {
            (REQUIRE_QUOTES_DUE_TO_RESERVED_WORD, "property", false)
        } else if has_quoted && has_unquoted {
            (INCONSISTENTLY_QUOTED_PROPERTY, "key", false)
        } else {
            return;
        };
        // An `ObjectPattern`.
        if object.is_some_and(|e| utils::is_assignment_target(e) || is_import_attributes(e)) {
            return;
        }
        for property in properties {
            if let Some(key) = key_of_prop(property)
                && matches!(key.kind(), KeyKind::String(_)) == reports_quoted
            {
                report(cx, property.span(), key, message, name, keyword_key_name);
            }
        }
    }

    /// A `Property` of an object literal, in the modes that look at one at a time.
    fn check_prop<'a>(&self, property: Prop<'a>, is_in_import_type: bool, cx: &Cx<'a, Self>) {
        if let Some(key) = key_of_prop(property)
            && let Some(message) = self.check_property(key)
            && (is_in_import_type
                || !matches!(property.parent(), Node::Expr(object) if is_import_attributes(object)))
        {
            report(cx, property.span(), key, message, "property", None);
        }
    }
}

impl Rule for QuoteProps {
    const META: Meta = Meta::eslint("quote-props", Kind::Suggestion).fixable(Fixable::Code).deprecated();
    const ON: On = On::new()
        .exprs(&[ExprTag::Object])
        .types(&[TypeTag::Import])
        .pats(&[PatTag::Object])
        .props();
    no_state!();

    fn new(options: &Options) -> Self {
        let object = options.object(1);
        QuoteProps {
            mode: match options.str(0) {
                Some("as-needed") => Mode::AsNeeded,
                Some("consistent") => Mode::Consistent,
                Some("consistent-as-needed") => Mode::ConsistentAsNeeded,
                _ => Mode::Always,
            },
            keywords: object.bool_or("keywords", false),
            check_unnecessary: object.bool_or("unnecessary", true),
            numbers: object.bool_or("numbers", false),
        }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let on = On::new().types(&[TypeTag::Import]);
        match self.mode {
            Mode::Consistent | Mode::ConsistentAsNeeded => on.exprs(&[ExprTag::Object]),
            _ => on.props().pats(&[PatTag::Object]),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::Object(properties) = e.kind() {
            self.check_consistency_of(properties, Some(e), cx);
        }
    }

    /// ESLint has `{ with: { type: "json" } }` in `import("m", { with: { type: "json" } })` as two
    /// object literals.
    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let Some(attributes) = ty.import_attributes() else {
            return;
        };
        let keyword = attributes.keyword_span();
        let word = cx.slice(keyword);
        let is_reserved = self.keywords && is_keyword(word);
        let message = match self.mode {
            Mode::Always => Some(UNQUOTED_PROPERTY_FOUND),
            Mode::AsNeeded => is_reserved.then_some(UNQUOTED_RESERVED_PROPERTY),
            Mode::Consistent => None,
            Mode::ConsistentAsNeeded => is_reserved.then_some(REQUIRE_QUOTES_DUE_TO_RESERVED_WORD),
        };
        if let Some(message) = message {
            cx.report(Span::new(keyword.start, attributes.braces_span().end), message)
                .data("property", word)
                .fix(|fixer| fixer.replace(keyword, [&b"\""[..], word, &b"\""[..]].concat()));
        }
        match self.mode {
            Mode::Always | Mode::AsNeeded => attributes.entries().iter().for_each(|entry| self.check_prop(entry, true, cx)),
            Mode::Consistent | Mode::ConsistentAsNeeded => self.check_consistency_of(attributes.entries(), None, cx),
        }
    }

    fn pat<'a>(&self, pattern: Pat<'a>, cx: &mut Cx<'a, Self>) {
        let PatKind::Object(properties) = pattern.kind() else {
            return;
        };
        for property in properties {
            if let Some(key) = key_of_pat_prop(property)
                && let Some(message) = self.check_property(key)
            {
                report(cx, property.span(), key, message, "property", None);
            }
        }
    }

    fn prop<'a>(&self, property: Prop<'a>, cx: &mut Cx<'a, Self>) {
        self.check_prop(property, false, cx);
    }
}
