//! A check that formatting has not lost or made up anything. `bun format` makes it before it writes a file.
//!
//! What has been written is parsed, and compared with the file:
//!
//! - The elements, comments, blocks and declarations are the same, in the same order and in each other the same way, and the
//!   elements have the same attributes in the same order. Upper and lower case do not count.
//! - All that is text has the same letters as often, whatever becomes of white space, punctuation, digits and upper and
//!   lower case: text, comments, scripts, style sheets, the values of attributes, expressions. So nothing with a letter in
//!   it is lost or there twice, in whatever language it is. That letters have changed places is not noticed.

use super::Parser;
use super::ast::{Id, Kind, Tree};
use super::parse;
use rustc_hash::FxHasher;
use std::hash::Hasher;

/// What is compared of a text.
#[derive(PartialEq, Eq)]
struct Signature {
    /// Of the nodes that are not text.
    structure: u64,
    /// How often each letter is there, and each byte of a character that is not ASCII.
    letters: [u64; 26 + 128],
}

struct Reader {
    structure: FxHasher,
    letters: [u64; 26 + 128],
}

impl Reader {
    fn count(&mut self, text: &[u8]) {
        for &byte in text {
            match byte {
                b'a'..=b'z' => self.letters[usize::from(byte - b'a')] += 1,
                b'A'..=b'Z' => self.letters[usize::from(byte - b'A')] += 1,
                0x80.. => self.letters[26 + usize::from(byte - 0x80)] += 1,
                _ => {}
            }
        }
    }

    /// The same for the value of an attribute, in which a quote can be written as an entity.
    fn count_value(&mut self, value: &[u8]) {
        self.count(value);
        for entity in [&b"&quot;"[..], b"&apos;"] {
            let mut rest = value;
            while let Some(at) = bun_core::strings::index_of(rest, entity) {
                for &byte in &entity[1..5] {
                    self.letters[usize::from(byte - b'a')] -= 1;
                }
                rest = &rest[at + entity.len()..];
            }
        }
    }

    fn name(&mut self, namespace: &[u8], name: &[u8]) {
        for &byte in namespace.iter().chain(b":").chain(name) {
            self.structure.write_u8(byte.to_ascii_lowercase());
        }
        self.structure.write_u8(0);
    }

    /// What is said of `id` before what is in it.
    fn enter(&mut self, tree: &Tree<'_>, id: Id, text: &[u8]) {
        let node = &tree[id];
        if !matches!(node.kind, Kind::Text | Kind::Cdata) {
            self.structure.write_u8(1 + node.kind as u8);
        }
        match node.kind {
            Kind::Element => {
                self.name(node.namespace, &node.name);
                for attr in tree.attrs(id) {
                    self.name(attr.namespace, &attr.name);
                    self.count_value(attr.value.unwrap_or_default());
                }
                for comment in tree.start_tag_comments(id) {
                    self.count(comment.value);
                }
            }
            Kind::FrontMatter => self.count(node.span.of(text)),
            Kind::AngularControlFlowBlock
            | Kind::AngularLetDeclaration
            | Kind::AngularIcuExpression => {
                self.count(&node.name);
                self.count(&node.value);
                for parameter in tree
                    .parameters(id)
                    .into_iter()
                    .flat_map(|parameters| tree.children(parameters))
                {
                    self.count(&tree[parameter].value);
                }
            }
            _ => self.count(&node.value),
        }
    }
}

fn signature(text: &[u8], parser: Parser) -> Option<Signature> {
    let (content, front_matter_len) = super::without_front_matter(text);
    let mut tree = Tree::default();
    parse::parse(&content, front_matter_len, parser, &mut tree).ok()?;
    let mut reader = Reader {
        structure: FxHasher::default(),
        letters: [0; 26 + 128],
    };
    // What is in a node comes behind it.
    let root = tree.root;
    let mut next = tree.first_child(root);
    while let Some(id) = next {
        reader.enter(&tree, id, text);
        next = tree.first_child(id).or_else(|| {
            let mut at = id;
            loop {
                if !matches!(tree[at].kind, Kind::Text | Kind::Cdata) {
                    reader.structure.write_u8(0);
                }
                if let Some(next) = tree.next(at) {
                    return Some(next);
                }
                at = tree.parent(at).filter(|&parent| parent != root)?;
            }
        });
    }
    Some(Signature {
        structure: reader.structure.finish(),
        letters: reader.letters,
    })
}

/// Whether `after`, which is what has become of `before`, has all that is in `before` and nothing else. Both are what
/// `prepared_text` makes of a text.
pub(crate) fn has_same_content(before: &[u8], after: &[u8], parser: Parser) -> bool {
    match (signature(before, parser), signature(after, parser)) {
        (Some(before), Some(after)) => before == after,
        _ => false,
    }
}
