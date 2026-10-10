use bun_lint::prelude::*;
use bun_lint::selector::{self, EsNode, Selector};

/// Disallow specified syntax.
pub struct NoRestrictedSyntax {
    /// In the order in which ESLint calls the listeners for a node.
    restrictions: Vec<Restriction>,
}

struct Restriction {
    selector: Selector,
    message: Box<[u8]>,
}

const RESTRICTED_SYNTAX: Message = Message::new("restrictedSyntax", "{{message}}");

impl Rule for NoRestrictedSyntax {
    const META: Meta = Meta::eslint("no-restricted-syntax", Kind::Suggestion);
    const ON: On = On::new().nodes(NodeTags::ALL).finish();
    /// What matches, with the index of the restriction.
    type State<'a> = Vec<(EsNode<'a>, usize)>;

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
        utils::sort::sort_by(&mut restrictions, |a, b| a.selector.compare(&b.selector));
        NoRestrictedSyntax { restrictions }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let tags = self.restrictions.iter().fold(NodeTags::EMPTY, |tags, it| tags | it.selector.listens_to());
        On::new().nodes(tags).finish()
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(Vec::new())
    }

    fn node<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        EsNode::for_each_at(node, |it| {
            let matching = self.restrictions.iter().enumerate().filter(|(_, restriction)| restriction.selector.matches(it));
            cx.state.extend(matching.map(|(i, _)| (it, i)));
        });
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let mut found = std::mem::take(&mut cx.state);
        if self.restrictions.len() > 1 {
            selector::sort_as_called(&mut found, |i| self.restrictions.get(i).is_some_and(|it| it.selector.is_exit()));
        }
        for (node, i) in found {
            if let Some(restriction) = self.restrictions.get(i) {
                cx.report(node, RESTRICTED_SYNTAX).data("message", restriction.message.to_vec());
            }
        }
    }
}
