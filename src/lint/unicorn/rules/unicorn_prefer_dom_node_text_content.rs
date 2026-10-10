use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces the use of `.textContent` over `.innerText` for DOM nodes.
pub struct PreferDomNodeTextContent;

const PREFER_TEXT_CONTENT: Message = Message::new("", "Prefer `.textContent` over `.innerText`.");

/// Where the key is written, if it is the identifier `innerText`.
fn inner_text_key<'a>(key: Option<Key<'a>>, file: &File<'a>) -> Option<Span> {
    let key = key?;
    matches!(key.kind(), KeyKind::Ident(name) if name.is("innerText")).then(|| key.span(file))
}

impl Rule for PreferDomNodeTextContent {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "prefer-dom-node-text-content", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Dot]).pats(&[PatTag::Object]).props();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferDomNodeTextContent
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("innerText") {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, member: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(name) = member.member_name()
            && name.name().is("innerText")
            && !member.is_jsx_tag_name()
            && !member.is_in_type_query()
        {
            cx.report(name, PREFER_TEXT_CONTENT).fix(|fixer| fixer.replace(name, "textContent"));
        }
    }

    // `const {innerText} = node`, `function foo({innerText: text}) {}`
    fn pat<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        let PatKind::Object(properties) = pat.kind() else {
            return;
        };
        for span in properties.iter().filter_map(|it| inner_text_key(it.key(), cx.file())) {
            cx.report(span, PREFER_TEXT_CONTENT);
        }
    }

    // `({innerText: text} = node)`, `({innerText} = node)`
    fn prop<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        let Some(span) = inner_text_key(prop.key(), cx.file()).filter(|_| !prop.is_jsx_attribute()) else {
            return;
        };
        let Node::Expr(object) = prop.parent() else {
            return;
        };
        let is_reported = match prop.kind() {
            PropKind::Init => object.is_assignment_target(),
            // Only directly on the left of an assignment.
            PropKind::Shorthand => matches!(object.parent(), Node::Expr(assignment)
                if assignment.tag() == ExprTag::Assign
                    && assignment.left() == Some(object)
                    && !assignment.is_assignment_target()),
            _ => false,
        };
        if is_reported {
            cx.report(span, PREFER_TEXT_CONTENT);
        }
    }
}
