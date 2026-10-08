use bun_lint::prelude::*;
use bun_lint::selector::{EsNode, Selector};
use smallvec::SmallVec;

/// Disallow specified syntax.
pub struct NoRestrictedSyntax {
    /// Each in the order in which ESLint calls the listeners for a node.
    on_enter: Vec<Restriction>,
    on_exit: Vec<Restriction>,
}

struct Restriction {
    selector: Selector,
    message: Box<[u8]>,
}

const RESTRICTED_SYNTAX: Message = Message::new("restrictedSyntax", "{{message}}");

fn check<'a>(restrictions: &[Restriction], node: EsNode<'a>, cx: &Cx<'a, NoRestrictedSyntax>) {
    for it in restrictions.iter().filter(|it| it.selector.matches(node)) {
        cx.report(node, RESTRICTED_SYNTAX).data("message", it.message.to_vec());
    }
}

fn listens_to(restrictions: &[Restriction]) -> NodeTags {
    restrictions.iter().fold(NodeTags::EMPTY, |tags, it| tags | it.selector.listens_to())
}

impl Rule for NoRestrictedSyntax {
    const META: Meta = Meta::eslint("no-restricted-syntax", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let mut restrictions: Vec<Restriction> = Vec::new();
        for option in options.all() {
            let object = Object::of(Some(option));
            let Some(source) = option.as_str().or_else(|| object.get("selector")?.as_str()) else {
                continue;
            };
            let message: Box<[u8]> = match object.get("message").and_then(Json::as_str) {
                Some(message) if !message.is_empty() => message.into(),
                _ => [b"Using '", source, b"' is not allowed."].concat().into(),
            };
            // The listeners are the properties of an object, named by the selectors.
            if let Some(same) = restrictions.iter_mut().find(|it| it.selector.source() == source) {
                same.message = message;
            } else if let Ok(selector) = Selector::parse(source) {
                // TODO(api): ESLint throws if a selector is not valid. A rule has no way to refuse its options.
                restrictions.push(Restriction { selector, message });
            }
        }
        restrictions.sort_by(|a, b| a.selector.compare(&b.selector));
        let (on_exit, on_enter) = restrictions.into_iter().partition(|it| it.selector.is_exit());
        NoRestrictedSyntax { on_enter, on_exit }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        if !self.on_enter.is_empty() {
            on.enter(listens_to(&self.on_enter), |rule, node, cx| {
                EsNode::for_each_at(node, |it| check(&rule.on_enter, it, cx));
            });
        }
        if !self.on_exit.is_empty() {
            on.exit(listens_to(&self.on_exit), |rule, node, cx| {
                let mut nodes: SmallVec<[EsNode<'a>; 8]> = SmallVec::new();
                EsNode::for_each_at(node, |it| nodes.push(it));
                nodes.iter().rev().for_each(|it| check(&rule.on_exit, *it, cx));
            });
        }
    }
}
