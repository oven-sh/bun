use crate::{Document, NodeKind};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashSet;

/// Disallow duplicate keys in JSON objects
pub struct NoDuplicateKeys;

const DUPLICATE_KEY: Message = Message::new("duplicateKey", "Duplicate key \"{{key}}\" found.");

/// An object with at most this many members gets a linear search instead of a hash set.
const LINEAR_SEARCH_MAX: usize = 16;

impl Rule for NoDuplicateKeys {
    const META: Meta = Meta::plugin(Plugin::Json, "no-duplicate-keys", Kind::Problem)
        .recommended()
        .languages(crate::LANGUAGES);
    const ON: On = On::new().finish();
    type State<'a> = Document<'a>;

    fn new(_: &Options) -> Self {
        NoDuplicateKeys
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Document<'a>> {
        Document::of(file)
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let mut first: Vec<&[u8]> = Vec::with_capacity(LINEAR_SEARCH_MAX);
        let objects = cx.state.nodes();
        for object in objects.filter(|it| it.kind() == NodeKind::Object) {
            first.clear();
            let mut all: FxHashSet<&[u8]> = FxHashSet::default();
            for member in object.members() {
                let key = member.key();
                if first.len() == LINEAR_SEARCH_MAX && all.is_empty() {
                    all.extend(&first);
                }
                let is_new = match first.len() < LINEAR_SEARCH_MAX {
                    true => !first.contains(&key),
                    false => all.insert(key),
                };
                if !is_new {
                    cx.report(member.name, DUPLICATE_KEY)
                        .data("key", member.raw_key())
                        .listened_on(member);
                } else if first.len() < LINEAR_SEARCH_MAX {
                    first.push(key);
                }
            }
        }
    }
}
