use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow a JSX element of one name anywhere inside an element of another name.
///
/// By default what the HTML Standard rules out for `a` and `button` (no interactive content among the descendants), and
/// for `form` and `label` (none of their own kind).
pub struct JsxNoForbiddenNesting {
    /// The name of the outer element and that of the inner one.
    pairs: Box<[(Box<[u8]>, Box<[u8]>)]>,
}

const FORBIDDEN_NESTING: Message = Message::new("forbiddenNesting", "`<{{inner}}>` cannot be inside `<{{outer}}>`.");

const HTML: [(&str, &str); 6] =
    [("a", "a"), ("a", "button"), ("button", "a"), ("button", "button"), ("form", "form"), ("label", "label")];

/// The name of an element, whose text is the name as it is written: `a`, `A.B`, `a-b`.
fn tag_of(node: Node<'_>) -> Option<Expr<'_>> {
    match node.as_expr()?.kind() {
        ExprKind::Jsx(jsx) => jsx.tag(),
        _ => None,
    }
}

impl Rule for JsxNoForbiddenNesting {
    const META: Meta = Meta::plugin(Plugin::Bun, "jsx-no-forbidden-nesting", Kind::Problem);
    const ON: On = On::new().enter(NodeTags::new().exprs(&[ExprTag::Jsx])).exit(NodeTags::new().exprs(&[ExprTag::Jsx]));
    /// For each of the pairs: how many of the outer elements the walk is in.
    type State<'a> = Vec<u32>;

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        let written = config.array("pairs").iter().filter_map(|it| {
            let pair = Object::of(Some(it));
            Some((pair.str("outer")?.as_bytes().into(), pair.str("inner")?.as_bytes().into()))
        });
        let html = HTML.iter().map(|it| (it.0.as_bytes().into(), it.1.as_bytes().into()));
        JsxNoForbiddenNesting { pairs: if config.has("pairs") { written.collect() } else { html.collect() } }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Vec<u32>> {
        if !file.has_exprs([ExprTag::Jsx]) {
            return None;
        }
        Some(vec![0; self.pairs.len()])
    }

    fn enter<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let Some(tag) = tag_of(node) else {
            return;
        };
        let mut is_reported = false;
        for (at, (outer, inner)) in self.pairs.iter().enumerate() {
            if !is_reported && **inner == *tag.text() && cx.state.get(at).is_some_and(|open| *open > 0) {
                cx.report(tag, FORBIDDEN_NESTING).data("inner", tag.text()).data("outer", outer.to_vec());
                is_reported = true;
            }
            if **outer == *tag.text()
                && let Some(open) = cx.state.get_mut(at)
            {
                *open += 1;
            }
        }
    }

    fn exit<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let Some(tag) = tag_of(node) else {
            return;
        };
        for ((outer, _), open) in self.pairs.iter().zip(&mut cx.state) {
            *open = open.saturating_sub(u32::from(**outer == *tag.text()));
        }
    }
}
