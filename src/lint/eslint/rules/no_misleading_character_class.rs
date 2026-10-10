use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::regex::{self, ast::NodeType};
use bun_lint::utils::char_source::{CharInfo, parse_string_literal, parse_template_token};
use bun_lint::utils::eslint_utils::{
    ReferenceTracker, StaticValue, TraceMap, get_static_value, get_string_if_constant,
};
use bun_lint::utils::regular_expressions::{UnicodeFlag, is_valid_with_unicode_flag};
use bun_lint::utils::unicode::{
    is_combining_character, is_emoji_modifier, is_regional_indicator_symbol, is_surrogate_pair,
};
use rustc_hash::FxHashSet;
use smallvec::SmallVec;
use std::borrow::Cow;
use std::cell::OnceCell;

/// Disallow characters which are made with multiple code points in character class syntax.
pub struct NoMisleadingCharacterClass {
    allow_escape: bool,
}

const SUGGEST_UNICODE_FLAG: Message =
    Message::new("suggestUnicodeFlag", "Add unicode 'u' flag to regex.");

/// ESLint's `kinds`, in the order in which they are reported.
const KINDS: [Message; 6] = [
    Message::new(
        "surrogatePairWithoutUFlag",
        "Unexpected surrogate pair in character class. Use 'u' flag.",
    ),
    Message::new("surrogatePair", "Unexpected surrogate pair in character class."),
    Message::new("combiningClass", "Unexpected combined character in character class."),
    Message::new("emojiModifier", "Unexpected modified Emoji in character class."),
    Message::new("regionalIndicatorSymbol", "Unexpected national flag in character class."),
    Message::new("zwj", "Unexpected joined character sequence in character class."),
];
const SURROGATE_PAIR_WITHOUT_U_FLAG: usize = 0;
const SURROGATE_PAIR: usize = 1;
const COMBINING_CLASS: usize = 2;
const EMOJI_MODIFIER: usize = 3;
const REGIONAL_INDICATOR_SYMBOL: usize = 4;
const ZWJ: usize = 5;

const ZERO_WIDTH_JOINER: u32 = 0x200D;

const TRACE_MAP: TraceMap<'static, ()> =
    TraceMap::new(&[("RegExp", TraceMap::EMPTY.call(()).construct(()))]);

/// A `Character` of regexpp.
type Character<'r> = regex::Node<'r>;

/// The first and the last character of what is reported.
type Match<'r> = (Character<'r>, Character<'r>);

/// What is found of each of the [`KINDS`].
type Found<'r> = [Vec<Match<'r>>; 6];

fn value_of(char: Character) -> u32 {
    char.character().unwrap_or(0)
}

/// Whether anything can be found in `pattern`: it has a class, and a character beyond U+00FF, which
/// is either written as such or as `\u..`.
fn may_be_misleading(pattern: &[u8]) -> bool {
    strings::contains_char(pattern, b'[')
        && (strings::first_non_ascii(pattern).is_some() || strings::contains(pattern, b"\\u"))
}

/// ESLint's `isUnicodeCodePointEscape`: `\u{..}`
fn is_unicode_code_point_escape(char: Character) -> bool {
    let digits = char.raw().strip_prefix(b"\\u{").and_then(|it| it.strip_suffix(b"}"));
    digits.is_some_and(|it| !it.is_empty() && it.iter().all(u8::is_ascii_hexdigit))
}

/// The blocks of combining characters that oxlint knows.
fn is_combining_character_for_oxlint(value: u32) -> bool {
    matches!(
        value,
        0x0300..=0x036F
            | 0x1AB0..=0x1AFF
            | 0x1DC0..=0x1DFF
            | 0x20D0..=0x20FF
            | 0xFE00..=0xFE0F
            | 0xFE20..=0xFE2F
            | 0xE0100..=0xE01EF
    )
}

/// ESLint's `findCharacterSequences`, all kinds at once. In `chars` the characters that are not to
/// be flagged are `None`.
fn find_character_sequences<'r>(
    chars: &[Option<Character<'r>>],
    unfiltered_chars: &[Character<'r>],
    found: &mut Found<'r>,
    is_oxlint: bool,
) {
    let at = |index: usize| chars.get(index).copied().flatten();
    let is_combining_character: fn(u32) -> bool = match is_oxlint {
        true => is_combining_character_for_oxlint,
        false => is_combining_character,
    };
    let mut zwj_sequence: Option<Match<'r>> = None;
    for index in 1..chars.len() {
        let Some(char) = at(index) else {
            continue;
        };
        let value = value_of(char);

        // The base character counts even if it is escaped.
        if is_combining_character(value)
            && let Some(&previous) = unfiltered_chars.get(index - 1)
            && !is_combining_character(value_of(previous))
        {
            found[COMBINING_CLASS].push((previous, char));
        }

        let Some(previous) = at(index - 1) else {
            continue;
        };
        let previous_value = value_of(previous);
        if is_surrogate_pair(previous_value, value) {
            let is_escaped = is_unicode_code_point_escape(previous) || is_unicode_code_point_escape(char);
            let kind = if is_escaped { SURROGATE_PAIR } else { SURROGATE_PAIR_WITHOUT_U_FLAG };
            found[kind].push((previous, char));
        }
        if is_emoji_modifier(value) && !is_emoji_modifier(previous_value) {
            found[EMOJI_MODIFIER].push((previous, char));
        }
        if is_regional_indicator_symbol(value) && is_regional_indicator_symbol(previous_value) {
            found[REGIONAL_INDICATOR_SYMBOL].push((previous, char));
        }
        if value == ZERO_WIDTH_JOINER
            && previous_value != ZERO_WIDTH_JOINER
            && let Some(next) = at(index + 1)
            && value_of(next) != ZERO_WIDTH_JOINER
        {
            zwj_sequence = Some(match zwj_sequence {
                // oxlint reports each joiner with what is before and after it.
                Some((first, last)) if last == previous && !is_oxlint => (first, next),
                Some(finished) => {
                    found[ZWJ].push(finished);
                    (previous, next)
                }
                None => (previous, next),
            });
        }
    }
    found[ZWJ].extend(zwj_sequence);
}

/// ESLint's `checkForAcceptableEscape`: whether `source`, which is what the character `value` is
/// written as, is an escape sequence other than backslashes before the character itself.
fn check_for_acceptable_escape(value: u32, source: &[u8]) -> bool {
    let backslashes = source.iter().take_while(|it| **it == b'\\').count();
    if backslashes == 0 {
        return false;
    }
    // `/(?<=^\\+).$/su`
    let escaped = match source.get(backslashes..).unwrap_or_default() {
        [] => (backslashes > 1).then_some(u32::from(b'\\')),
        // The first half of a character outside the BMP, which can only stand for itself.
        [0xF0..=0xFF, _] => Some(value),
        rest => {
            let mut code_points = strings::wtf8_codepoints(rest).map(|it| it.1);
            code_points.next().filter(|_| code_points.next().is_none())
        }
    };
    escaped != Some(value)
}

/// Whether the source of `unit` in `literal` ends with a character outside the BMP: `unit` is one
/// half of it, and the other half has the same source.
fn is_half_of_character(literal: &[u8], unit: CharInfo) -> bool {
    unit.end >= unit.start + 4 && literal.get(unit.end as usize - 4).is_some_and(|it| *it >= 0xF0)
}

/// ESLint's `codeUnit.start`. Between the halves of a character is its offset plus 2, as in
/// [`regex::ast`].
fn start_of_unit(literal: &[u8], unit: CharInfo) -> u32 {
    match unit.code_unit {
        0xDC00..=0xDFFF if is_half_of_character(literal, unit) => unit.end - 2,
        _ => unit.start,
    }
}

/// ESLint's `codeUnit.end`.
fn end_of_unit(literal: &[u8], unit: CharInfo) -> u32 {
    match unit.code_unit {
        0xD800..=0xDBFF if is_half_of_character(literal, unit) => unit.end - 2,
        _ => unit.end,
    }
}

/// TODO(api): replace by integrator::File::position, once it takes the offset of a character
/// outside the BMP plus 2 for the position between its two UTF-16 code units. It does with plus 1.
fn reportable_offset(text: &[u8], offset: u32) -> u32 {
    let start = (offset as usize).checked_sub(2);
    let is_between_halves = start.and_then(|it| text.get(it)).is_some_and(|it| *it >= 0xF0);
    offset - u32::from(is_between_halves)
}

#[derive(Copy, Clone)]
enum LiteralKind {
    Regex,
    String,
    /// Without substitutions.
    Template,
}

/// The node that a pattern is the value of.
struct PatternNode<'a> {
    node: Expr<'a>,
    /// `None`: where a character of the pattern is written is not known.
    literal: Option<LiteralKind>,
    code_units: OnceCell<Vec<CharInfo>>,
}

impl<'a> PatternNode<'a> {
    fn new(node: Expr<'a>) -> Self {
        PatternNode {
            node,
            literal: match node.kind() {
                ExprKind::Regex(_) => Some(LiteralKind::Regex),
                ExprKind::String(_) => Some(LiteralKind::String),
                ExprKind::Template(template) if template.exprs().is_empty() => Some(LiteralKind::Template),
                _ => None,
            },
            code_units: OnceCell::new(),
        }
    }

    /// Where the characters from `first` to `last` are written, from the start of the node.
    fn range_of(&self, first: Character, last: Character) -> Option<(u32, u32)> {
        let parse = match self.literal? {
            // After the slash.
            LiteralKind::Regex => return Some((first.start() + 1, last.end() + 1)),
            LiteralKind::String => parse_string_literal,
            LiteralKind::Template => parse_template_token,
        };
        let literal = self.node.text();
        let code_units = self.code_units.get_or_init(|| parse(literal));
        let first = *code_units.get(first.utf16_start() as usize)?;
        let last = *code_units.get((last.utf16_end() as usize).checked_sub(1)?)?;
        Some((start_of_unit(literal, first), end_of_unit(literal, last)))
    }

    /// ESLint's `isAcceptableEscapeSequence`
    fn is_acceptable_escape_sequence(&self, char: Character) -> bool {
        self.range_of(char, char).is_some_and(|(start, end)| {
            let source = self.node.text().get(start as usize..end as usize).unwrap_or_default();
            check_for_acceptable_escape(value_of(char), source)
        })
    }
}

/// oxlint reads a pattern that is a string or a template without substitutions, not the value of `String.raw` or of a
/// constant.
fn oxlint_can_read(pattern: Expr) -> bool {
    match pattern.skip_type_wrappers().kind() {
        ExprKind::String(_) => true,
        ExprKind::Template(template) => template.exprs().is_empty(),
        _ => false,
    }
}

impl NoMisleadingCharacterClass {
    /// One of the sequences of ESLint's `iterateCharacterSequence`.
    fn check_sequence<'r>(&self, unfiltered_chars: &[Character<'r>], node: &PatternNode, found: &mut Found<'r>) {
        let is_flagged = |char: &Character<'r>| !(self.allow_escape && node.is_acceptable_escape_sequence(*char));
        let chars: SmallVec<[Option<Character<'r>>; 8]> =
            unfiltered_chars.iter().map(|char| is_flagged(char).then_some(*char)).collect();
        find_character_sequences(&chars, unfiltered_chars, found, node.node.file().language().is_oxlint);
    }

    /// `unicode_fixer`: adds the `u` flag.
    fn verify<'a>(
        &self,
        node: Expr<'a>,
        pattern: &[u8],
        flags: &[u8],
        unicode_fixer: impl Fn(Fixer<'a>) -> Option<Fix>,
        cx: &Cx<'a, Self>,
    ) {
        if !may_be_misleading(pattern) {
            return;
        }
        let Ok(ast) = regex::parse_pattern(pattern, regex::Mode::of_flags(flags), regex::Options::default())
        else {
            return;
        };
        let node = PatternNode::new(node);
        let mut found = Found::default();
        for class in ast.root().descendants().filter(|it| it.ty() == NodeType::CharacterClass) {
            // A range takes a part of a sequence of characters, which this gives back.
            let mut sequence: SmallVec<[Character; 8]> = SmallVec::new();
            for element in class.elements() {
                match element.kind() {
                    regex::ast::Kind::Character { .. } => sequence.push(element),
                    regex::ast::Kind::CharacterClassRange { min, max } => {
                        sequence.push(min);
                        self.check_sequence(&sequence, &node, &mut found);
                        sequence.clear();
                        sequence.push(max);
                    }
                    _ => {
                        self.check_sequence(&sequence, &node, &mut found);
                        sequence.clear();
                    }
                }
            }
            self.check_sequence(&sequence, &node, &mut found);
        }

        let report = |kind: usize, span: Span| {
            let Some(&message) = KINDS.get(kind) else {
                return;
            };
            // Two kinds start together only at an escape that is two code units, and the kind that is about that alone is the
            // first of `KINDS`: the shorter first.
            let report = cx.report(span, message).shorter_first();
            if kind == SURROGATE_PAIR_WITHOUT_U_FLAG {
                report.suggest(SUGGEST_UNICODE_FLAG, &unicode_fixer);
            }
        };
        let (text, whole) = (cx.text(), node.node.span());
        for (kind, matches) in found.iter().enumerate() {
            if node.literal.is_none() {
                if !matches.is_empty() {
                    report(kind, whole);
                }
                continue;
            }
            for &(first, last) in matches {
                if let Some((start, end)) = node.range_of(first, last) {
                    let offset = |at: u32| reportable_offset(text, whole.start + at);
                    report(kind, Span::new(offset(start), offset(end)));
                }
            }
        }
    }
}

impl Rule for NoMisleadingCharacterClass {
    const META: Meta = Meta::eslint("no-misleading-character-class", Kind::Problem)
        .has_suggestions()
        .recommended();
    const ON: On = On::new().exprs(&[ExprTag::Regex]).finish();
    /// The regular expression literals in which something can be found.
    type State<'a> = Vec<Expr<'a>>;

    fn new(options: &Options) -> Self {
        NoMisleadingCharacterClass {
            allow_escape: options.object(0).bool_or("allowEscape", false),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Vec<Expr<'a>>> {
        Some(Vec::new())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if matches!(e.kind(), ExprKind::Regex(literal) if may_be_misleading(literal.pattern())) {
            cx.state.push(e);
        }
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let scope = Some(file.scope());
        let ecma_version = file.language().ecma_version;
        let is_valid_with_u = |pattern: &[u8]| is_valid_with_unicode_flag(ecma_version, pattern, UnicodeFlag::U);

        // The literals whose flags are replaced by those given to `RegExp`.
        let mut checked_pattern_nodes: FxHashSet<Expr<'a>> = FxHashSet::default();
        for reference in ReferenceTracker::new(file).iterate_global_references(&TRACE_MAP) {
            let (Some(ref_node), Some(call)) = (reference.expr(), reference.call()) else {
                continue;
            };
            let args = call.args();
            let Some(pattern_node) = args.first() else {
                continue;
            };
            let flags_node = args.get(1);
            let pattern = match (pattern_node.kind(), flags_node) {
                (ExprKind::Regex(_), None) => continue,
                (ExprKind::Regex(literal), Some(_)) => {
                    checked_pattern_nodes.insert(pattern_node);
                    Cow::Borrowed(literal.pattern())
                }
                _ if file.language().is_oxlint && !oxlint_can_read(pattern_node) => continue,
                _ => match get_static_value(pattern_node, scope) {
                    None | Some(StaticValue::Regex { .. }) => continue,
                    Some(value) => match value.to_js_string() {
                        Some(pattern) => pattern,
                        None => continue,
                    },
                },
            };
            let flags = match flags_node {
                None => Cow::Borrowed(&b""[..]),
                // For oxlint flags that it cannot read are not there, but for a template with substitutions.
                Some(flags_node) if file.language().is_oxlint && !oxlint_can_read(flags_node) => {
                    match (flags_node.skip_type_wrappers().kind(), pattern_node.kind()) {
                        (ExprKind::Template(_), _) => continue,
                        (_, ExprKind::Regex(literal)) => Cow::Borrowed(literal.flags()),
                        _ => Cow::Borrowed(&b""[..]),
                    }
                }
                Some(flags_node) => match get_string_if_constant(flags_node, scope) {
                    Some(flags) => flags,
                    None => continue,
                },
            };
            // The same for each of the characters that are reported.
            let is_valid = OnceCell::new();
            let unicode_fixer = |fixer: Fixer<'a>| {
                if !*is_valid.get_or_init(|| is_valid_with_u(&pattern)) {
                    return None;
                }
                let Some(flags_node) = flags_node else {
                    // The last token is the closing parenthesis.
                    let penultimate_token = file.tokens_in(ref_node).nth_back(1)?;
                    let argument = match ast_utils::is_comma_token(&penultimate_token) {
                        true => " \"u\",",
                        false => ", \"u\"",
                    };
                    return Some(fixer.insert_after(penultimate_token, argument));
                };
                matches!(flags_node.kind(), ExprKind::String(_) | ExprKind::Template(_))
                    .then(|| fixer.insert_before(Span::empty(flags_node.span().end - 1), "u"))
            };
            self.verify(pattern_node, &pattern, &flags, unicode_fixer, cx);
        }

        for e in std::mem::take(&mut cx.state) {
            if let ExprKind::Regex(literal) = e.kind()
                && !checked_pattern_nodes.contains(&e)
            {
                let is_valid = OnceCell::new();
                let unicode_fixer = |fixer: Fixer<'a>| {
                    (*is_valid.get_or_init(|| is_valid_with_u(literal.pattern()))).then(|| fixer.insert_after(e, "u"))
                };
                self.verify(e, literal.pattern(), literal.flags(), unicode_fixer, cx);
            }
        }
    }
}
