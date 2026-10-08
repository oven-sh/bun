use bun_core::strings;
use bun_lint::estree::{self, NodeType, Sink};
use bun_lint::prelude::*;

/// Disallow multiple spaces.
pub struct NoMultiSpaces {
    ignore_eol_comments: bool,
    /// The types of ESTree nodes in which anything goes.
    exceptions: Vec<NodeType>,
}

const MULTIPLE_SPACES: Message =
    Message::new("multipleSpaces", "Multiple spaces found before '{{displayValue}}'.");

/// ESLint's `getNodeByRangeIndex(offset).type` for several offsets at once. The option
/// `exceptions` names types of ESTree, some of which are not nodes of the syntax here.
// TODO(api): replace by utils::estree_types_at
struct TypesAt {
    /// Sorted by offset.
    at: Vec<(u32, Option<NodeType>)>,
}

impl Sink for TypesAt {
    fn start_node(&mut self, node_type: NodeType, span: Span) {
        let first = self.at.partition_point(|it| it.0 < span.start);
        // A node comes after those around it.
        for it in self.at.iter_mut().skip(first).take_while(|it| it.0 < span.end) {
            it.1 = Some(node_type);
        }
    }
    fn end_node(&mut self) {}
    fn start_object(&mut self) {}
    fn end_object(&mut self) {}
    fn start_list(&mut self) {}
    fn end_list(&mut self) {}
    fn field(&mut self, _: &'static str) {}
    fn null(&mut self) {}
    fn boolean(&mut self, _: bool) {}
    fn number(&mut self, _: f64) {}
    fn string(&mut self, _: &[u8]) {}
}

/// ESLint's `formatReportedCommentValue`, appended to `out`.
fn format_reported_comment_value(value: &[u8], out: &mut Vec<u8>) {
    let first_line = &value[..strings::index_of_char_usize(value, b'\n').unwrap_or(value.len())];
    if first_line.len() == value.len() && text::utf16_len(value) <= 12 {
        out.extend_from_slice(value);
    } else {
        out.extend_from_slice(text::utf16_slice(first_line, 0, 12));
        out.extend_from_slice(b"...");
    }
}

fn display_value(token: Token<'_>) -> Vec<u8> {
    let mut out = Vec::new();
    match token.kind() {
        TokenKind::Block => {
            out.extend_from_slice(b"/*");
            format_reported_comment_value(token.comment_value(), &mut out);
            out.extend_from_slice(b"*/");
        }
        TokenKind::Line => {
            out.extend_from_slice(b"//");
            format_reported_comment_value(token.comment_value(), &mut out);
        }
        // Its `value` is without the `#`.
        TokenKind::PrivateIdentifier => out.extend_from_slice(token.text().get(1..).unwrap_or_default()),
        _ => out.extend_from_slice(token.text()),
    }
    out
}

impl NoMultiSpaces {
    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let mut tokens = file.tokens().with_comments();
        let Some(mut left) = tokens.next() else {
            return;
        };
        // Where the token on the left ends, and the token on the right.
        let mut found: Vec<(u32, Token<'a>)> = Vec::new();
        while let Some(right) = tokens.next() {
            let left_end = left.end();
            left = right;
            let between = file.slice(Span::new(left_end, right.start()));
            if between.len() < 2 || !strings::contains(between, b"  ") || text::has_line_break(between) {
                continue;
            }
            if self.ignore_eol_comments && right.is_comment() {
                let mut rest = tokens;
                let is_last_on_line = rest
                    .next()
                    .is_none_or(|next| text::has_line_break(file.slice(Span::new(right.end(), next.start()))));
                if is_last_on_line {
                    continue;
                }
            }
            found.push((left_end, right));
        }
        if found.is_empty() {
            return;
        }
        let mut types = TypesAt { at: Vec::new() };
        if !self.exceptions.is_empty() {
            types.at.extend(found.iter().map(|it| (it.1.start() - 1, None)));
            estree::convert(file, &mut types);
        }
        for (i, (left_end, right)) in found.into_iter().enumerate() {
            let parent_type = types.at.get(i).and_then(|it| it.1);
            if parent_type.is_some_and(|it| self.exceptions.contains(&it)) {
                continue;
            }
            let spaces = Span::new(left_end, right.start());
            cx.report(spaces, MULTIPLE_SPACES)
                .data("displayValue", display_value(right))
                .fix(|fixer| fixer.replace(spaces, " "));
        }
    }
}

impl Rule for NoMultiSpaces {
    const META: Meta = Meta::eslint("no-multi-spaces", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let mut exceptions = vec![NodeType::Property];
        for (name, is_exception) in options.object("exceptions").entries() {
            let Some(&node_type) = NodeType::ALL.iter().find(|it| it.name().as_bytes() == &name[..]) else {
                continue;
            };
            exceptions.retain(|it| *it != node_type);
            if is_exception.as_bool() == Some(true) {
                exceptions.push(node_type);
            }
        }
        NoMultiSpaces {
            ignore_eol_comments: options.bool_or("ignoreEOLComments", false),
            exceptions,
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(Self::check);
    }
}
