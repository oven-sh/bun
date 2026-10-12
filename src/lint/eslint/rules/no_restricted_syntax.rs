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

fn selector_of(option: &Json) -> Option<&[u8]> {
    option.as_str().or_else(|| option.get(b"selector")?.as_str())
}

impl Rule for NoRestrictedSyntax {
    const META: Meta = Meta::eslint("no-restricted-syntax", Kind::Suggestion);
    const ON: On = On::new().nodes(NodeTags::ALL).finish();
    /// What matches, with the index of the restriction.
    type State<'a> = Vec<(EsNode<'a>, usize)>;

    fn new(options: &Options) -> Self {
        let mut restrictions: Vec<Restriction> = Vec::new();
        for option in options.all() {
            let Some(source) = selector_of(option) else {
                continue;
            };
            let message: Box<[u8]> = match option.get(b"message").and_then(Json::as_str) {
                Some(message) if !message.is_empty() => message.into(),
                _ => [b"Using '", source, b"' is not allowed."].concat().into(),
            };
            // The listeners are the properties of an object, named by the selectors.
            if let Some(same) = restrictions.iter_mut().find(|it| it.selector.source() == source) {
                same.message = message;
            } else if let Ok(selector) = Selector::parse(source) {
                restrictions.push(Restriction { selector, message });
            }
        }
        utils::sort::sort_by(&mut restrictions, |a, b| a.selector.compare(&b.selector));
        NoRestrictedSyntax { restrictions }
    }

    fn validate(options: &Options) -> Result<(), Vec<u8>> {
        for source in options.all().iter().filter_map(selector_of) {
            Selector::parse(source).map_err(|error| error.message().to_vec())?;
        }
        Ok(())
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let tags = self.restrictions.iter().fold(NodeTags::EMPTY, |tags, it| tags | it.selector.listens_to());
        On::new().nodes(tags).finish()
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(Vec::new())
    }

    fn node<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if cx.has_thrown_for_selector() {
            return;
        }
        EsNode::for_each_at(node, |it| {
            for (i, restriction) in self.restrictions.iter().enumerate() {
                match restriction.selector.test(it) {
                    Ok(true) => cx.state.push((it, i)),
                    Ok(false) => {}
                    Err(error) => cx.throw_for_selector(&error),
                }
            }
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
