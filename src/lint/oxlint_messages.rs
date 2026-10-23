//! oxlint's message texts for the rules it shares with ESLint and typescript-eslint. Our versions of those rules are
//! ports of the originals, so with an oxlint config their messages are replaced by oxlint's wording.
//!
//! The table was built from what oxlint and `bun lint` report at the same positions, for the test suites' cases and for
//! real code. An entry is oxlint's text with the values that the rule passes to
//! [`Report::data`](crate::context::Report::data) replaced by their names. It's only included if that template
//! reproduces oxlint's text exactly for every pair with that message id. A message that isn't listed keeps the
//! original's text.

use crate::rule::{Message, Meta, Plugin};
use bun_wyhash::hash_const;
use std::ops::Range;
use std::sync::OnceLock;

/// oxlint's replacements for the messages of the rule `meta`.
pub(crate) fn of_rule(meta: &Meta) -> [&'static [Message]; 2] {
    if !matches!(meta.plugin, Plugin::Eslint | Plugin::TypeScript) {
        return [&[], &[]];
    }
    let [eslint, typescript] = entries_for_name(meta);
    match meta.plugin {
        Plugin::Eslint => [eslint, &[]],
        // oxlint lists a rule that extends an ESLint rule under the ESLint rule's name.
        _ => [typescript, eslint],
    }
}

/// A rule, and where its messages are in [`Table::messages`], under `eslint` and under `typescript`.
struct Entry {
    /// [`Meta::key`]
    key: u32,
    name: &'static str,
    ranges: [Range<usize>; 2],
}

/// `oxlint_messages.txt`. After a line with `#`, oxlint's name for the plugin and the rule come the rule's messages, each
/// with its id, a space and the text. A text ends in a line break if an empty line follows.
struct Table {
    messages: Vec<Message>,
    /// Sorted by key.
    entries: Vec<Entry>,
}

impl Table {
    /// Release builds embed the file compressed. It's inflated and read for the first report with an oxlint config.
    fn get() -> &'static Table {
        static TABLE: OnceLock<Table> = OnceLock::new();
        TABLE.get_or_init(|| {
            let text = bun_zstd::embed_compressed!(
                "src/lint/oxlint_messages.txt",
                include_bytes!("oxlint_messages.txt")
            );
            let (mut messages, mut entries) = (Vec::new(), Vec::<Entry>::new());
            // Which range of which entry the messages belong to.
            let mut current = None;
            let mut rest = std::str::from_utf8(text).unwrap_or_default();
            while let Some((line, after)) = rest.split_once('\n') {
                if let Some((plugin, name)) =
                    line.strip_prefix("# ").and_then(|it| it.split_once(' '))
                {
                    let at = entries
                        .iter()
                        .position(|it| it.name == name)
                        .unwrap_or_else(|| {
                            entries.push(Entry {
                                key: hash_const(0, name.as_bytes()) as u32,
                                name,
                                ranges: [0..0, 0..0],
                            });
                            entries.len() - 1
                        });
                    entries[at].ranges[usize::from(plugin == "typescript")] =
                        messages.len()..messages.len();
                    current = Some((at, usize::from(plugin == "typescript")));
                } else if let (Some((id, text)), Some((at, plugin))) =
                    (line.split_once(' '), current)
                {
                    let with_break = rest
                        .get(id.len() + 1..=line.len())
                        .filter(|_| after.starts_with('\n'));
                    messages.push(Message::new(id, with_break.unwrap_or(text)));
                    entries[at].ranges[plugin].end = messages.len();
                }
                rest = after;
            }
            crate::utils::sort::sort_unstable_by_key(&mut entries, |it| it.key);
            Table { messages, entries }
        })
    }
}

/// The messages for `meta`'s name, under `eslint` and under `typescript`.
fn entries_for_name(meta: &Meta) -> [&'static [Message]; 2] {
    let table = Table::get();
    let first = table.entries.partition_point(|it| it.key < meta.key);
    let same_key = table.entries[first..]
        .iter()
        .take_while(|it| it.key == meta.key);
    let found = same_key
        .filter(|it| it.name == meta.name)
        .map(|it| &it.ranges)
        .next();
    let messages = |plugin: usize| {
        found
            .and_then(|it| table.messages.get(it[plugin].clone()))
            .unwrap_or_default()
    };
    [messages(0), messages(1)]
}

/// oxlint's version of `message`. `replacements` comes from [`of_rule`].
pub(crate) fn of(replacements: &[&'static [Message]; 2], message: Message) -> Message {
    let mut all = replacements.iter().flat_map(|it| it.iter());
    all.find(|it| it.id == message.id)
        .copied()
        .unwrap_or(message)
}
