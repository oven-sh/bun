use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::regex::{self, ast::NodeType};
use bun_lint::utils::char_source::Written;

/// Disallow multiple spaces in regular expressions.
pub struct NoRegexSpaces;

const MULTIPLE_SPACES: Message =
    Message::new("multipleSpaces", "Spaces are hard to count. Use {{{length}}}.");

/// The first match of `/( {2,})(?: [+*{?]|[^+*{?]|$)/gu` at or after `from`: where the group
/// starts, its length, and where to go on searching.
fn next_spaces(pattern: &[u8], mut from: usize) -> Option<(usize, usize, usize)> {
    loop {
        let start = from + strings::index_of(pattern.get(from..)?, b"  ")?;
        let count = pattern.get(start..)?.iter().take_while(|b| **b == b' ').count();
        let end = start + count;
        // The last space belongs to the quantifier.
        let length = match pattern.get(end) {
            Some(b'+' | b'*' | b'{' | b'?') => count - 1,
            _ => count,
        };
        if length >= 2 {
            return Some((start, length, end));
        }
        from = end;
    }
}

/// `raw`: the pattern as it is written in the source, from `raw_start`.
fn check_regex<'a>(
    node_to_report: Expr<'a>,
    pattern: &'a [u8],
    raw: &'a [u8],
    raw_start: u32,
    flags: &[u8],
    cx: &mut Cx<'a, NoRegexSpaces>,
) {
    let Ok(ast) = regex::parse_pattern(pattern, regex::Mode::of_flags(flags), regex::Options::default())
    else {
        return;
    };
    // Where the character classes start, each with the greatest end of those up to it.
    let mut character_classes: Option<Vec<(u32, u32)>> = None;
    let mut is_in_character_class = |index: u32| {
        let classes = character_classes.get_or_insert_with(|| {
            let nodes = ast.root().descendants().filter(|it| it.ty() == NodeType::CharacterClass);
            let mut classes: Vec<(u32, u32)> = nodes.map(|it| (it.start(), it.end())).collect();
            classes.sort_unstable();
            let mut end = 0;
            for class in &mut classes {
                end = end.max(class.1);
                class.1 = end;
            }
            classes
        });
        let before = classes.partition_point(|it| it.0 <= index);
        before.checked_sub(1).and_then(|it| classes.get(it)).is_some_and(|it| index < it.1)
    };
    let mut from = 0;
    while let Some((index, length, end)) = next_spaces(pattern, from) {
        from = end;
        if is_in_character_class(index as u32) {
            continue;
        }
        // TODO(api): the key `{length` is for `context::interpolate`, which takes the first `{{`.
        // oxlint points at the spaces, where they are written.
        let place = match node_to_report.kind() {
            _ if !cx.language().is_oxlint => node_to_report.span(),
            _ if pattern == raw => Span::new(raw_start + index as u32, raw_start + (index + length) as u32),
            ExprKind::Call(call) | ExprKind::New(call) => {
                let start = regex::utf16_index(pattern, index) as u32;
                (call.args().first().and_then(Written::new))
                    .and_then(|it| it.span(start, start + length as u32))
                    .unwrap_or_else(|| node_to_report.span())
            }
            _ => node_to_report.span(),
        };
        cx.report(place, MULTIPLE_SPACES)
            .data("length", length)
            .data("{length", format!("{{{length}"))
            .fix(|fixer| {
                let start = raw_start + index as u32;
                (pattern == raw)
                    .then(|| fixer.replace(Span::new(start, start + length as u32), format!(" {{{length}}}")))
            });
        return;
    }
}

fn has_double_space(raw: &[u8]) -> bool {
    strings::contains(raw, b"  ")
}

fn check_literal<'a>(_: &NoRegexSpaces, e: Expr<'a>, cx: &mut Cx<'a, NoRegexSpaces>) {
    let ExprKind::Regex(literal) = e.kind() else {
        return;
    };
    let pattern = literal.pattern();
    if has_double_space(pattern) {
        check_regex(e, pattern, pattern, e.span().start + 1, literal.flags(), cx);
    }
}

fn check_function<'a>(_: &NoRegexSpaces, e: Expr<'a>, cx: &mut Cx<'a, NoRegexSpaces>) {
    let (ExprKind::Call(call) | ExprKind::New(call)) = e.kind() else {
        return;
    };
    if !call.callee().is_ident("RegExp") {
        return;
    }
    let args = call.args();
    let Some(pattern_node) = args.first() else {
        return;
    };
    let Some(pattern) = pattern_node.as_string() else {
        return;
    };
    let raw_span = pattern_node.span().shrink(1, 1);
    let raw = cx.slice(raw_span);
    if !has_double_space(raw) {
        return;
    }
    let flags: &[u8] = match args.get(1) {
        None => b"",
        Some(flags_node) => match flags_node.as_string() {
            Some(flags) => flags.bytes(),
            None => return,
        },
    };
    if ast_utils::get_variable_by_name(Node::Expr(e).scope(), "RegExp").is_some() {
        return;
    }
    check_regex(e, pattern.bytes(), raw, raw_span.start, flags, cx);
}

impl Rule for NoRegexSpaces {
    const META: Meta = Meta::eslint("no-regex-spaces", Kind::Suggestion)
        .fixable(Fixable::Code)
        .recommended();
    const ON: On = On::new().exprs(&[ExprTag::Regex, ExprTag::Call, ExprTag::New]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoRegexSpaces
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new().exprs(&[ExprTag::Regex]);
        if file.mentions("RegExp") {
            on = on.exprs(&[ExprTag::Call, ExprTag::New]);
        }
        on
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Regex => check_literal(self, e, cx),
            ExprTag::Call | ExprTag::New => check_function(self, e, cx),
            _ => {}
        }
    }
}
