//! A check that formatting has not lost or made up anything. `bun format` makes it before it writes a file.
//!
//! What has been written is parsed, and compared with the file:
//!
//! - The elements, comments, blocks and declarations are the same, in the same order and in each other the same way, and the
//!   elements have the same attributes in the same order. Upper and lower case do not count.
//! - All that is text has the same letters as often, whatever becomes of white space, punctuation, numbers and upper and
//!   lower case: text, comments, scripts, style sheets, the values of attributes, expressions. So nothing with a letter in
//!   it is lost or there twice, in whatever language it is. That letters have changed places is not noticed.

use super::Parser;
use super::ast::{Id, Kind, Tree};
use super::parse;
use rustc_hash::FxHasher;
use std::hash::Hasher;

/// What is compared of a text.
#[derive(PartialEq, Eq)]
pub(crate) struct Signature {
    /// Of the nodes that are not text.
    structure: u64,
    /// How often each letter is there, and each byte of a character that is not ASCII.
    letters: [u64; 26 + 128],
}

pub(crate) struct Reader {
    structure: FxHasher,
    /// How often each byte is there, of those that count.
    bytes: [u64; 256],
}

impl Default for Reader {
    fn default() -> Reader {
        Reader {
            structure: FxHasher::default(),
            bytes: [0; 256],
        }
    }
}

/// The bytes that do not always count, or next to which another does not.
const IS_SPECIAL: [bool; 256] = {
    let mut is_special = [false; 256];
    let (bytes, mut at) = (b"eE\\\xC2\xC4\xE1\xE2\xE3\xEF", 0);
    while at < bytes.len() {
        is_special[bytes[at] as usize] = true;
        at += 1;
    }
    is_special
};

/// `/^[+-]?0+(?!\d)/.test(text)`
fn is_zero(text: &[u8]) -> bool {
    let digits = match text {
        [b'+' | b'-', digits @ ..] => digits,
        digits => digits,
    };
    let zeros = digits.iter().take_while(|&&byte| byte == b'0').count();
    zeros > 0 && !digits.get(zeros).is_some_and(u8::is_ascii_digit)
}

impl Reader {
    #[inline]
    fn add(&mut self, byte: u8) {
        let count = &mut self.bytes[usize::from(byte)];
        *count = count.wrapping_add(1);
    }

    /// `byte` does not count, whether it has been added or is going to be.
    fn take_back(&mut self, byte: u8) {
        let count = &mut self.bytes[usize::from(byte)];
        *count = count.wrapping_sub(1);
    }

    /// Something that is not text.
    pub(crate) fn mark(&mut self, mark: u8) {
        self.structure.write_u8(mark);
    }

    pub(crate) fn finish(&self) -> Signature {
        Signature {
            structure: self.structure.finish(),
            letters: self.letters(),
        }
    }

    pub(crate) fn count(&mut self, text: &[u8]) {
        for (at, &byte) in text.iter().enumerate() {
            self.add(byte);
            if IS_SPECIAL[usize::from(byte)] {
                self.look_around(text, at);
            }
        }
    }

    /// Takes back what does not count because of the byte at `at`, which is one of `IS_SPECIAL`.
    fn look_around(&mut self, text: &[u8], at: usize) {
        let (before, rest) = text.split_at_checked(at).unwrap_or_default();
        let previous = before.last().copied().unwrap_or(0);
        match *rest {
            // The exponent of a number, which goes if it is zero.
            [byte @ (b'e' | b'E'), ref exponent @ ..] => {
                if matches!(*before, [.., b'0'..=b'9'] | [.., b'0'..=b'9', b'.'])
                    && is_zero(exponent)
                {
                    self.take_back(byte);
                }
            }
            // `\n` in a template with HTML in it is white space.
            [b'\\', next, ..] => self.take_back(next),
            _ if previous == b'\\' => {}
            // In lower case, U+0130 is an `i` and U+0307.
            [0xC4, 0xB0, ..] => {
                b"\xC4\xB0".iter().for_each(|&byte| self.take_back(byte));
                b"i\xCC\x87".iter().for_each(|&byte| self.add(byte));
            }
            _ => (rest.iter().take(bun_core::strings::js_whitespace_len(rest)))
                .for_each(|&byte| self.take_back(byte)),
        }
    }

    /// The same for the value of an attribute, in which a quote can be written as an entity.
    pub(crate) fn count_value(&mut self, value: &[u8]) {
        self.count(value);
        for entity in [&b"&quot;"[..], b"&apos;"] {
            let mut rest = value;
            while let Some(at) = bun_core::strings::index_of(rest, entity) {
                entity.iter().for_each(|&byte| self.take_back(byte));
                rest = &rest[at + entity.len()..];
            }
        }
    }

    /// How often each letter is there, and each byte of a character that is not ASCII.
    fn letters(&self) -> [u64; 26 + 128] {
        let mut letters = [0; 26 + 128];
        for (count, lower) in letters.iter_mut().zip(b'a'..=b'z') {
            let upper = lower.to_ascii_uppercase();
            *count = self.bytes[usize::from(lower)].wrapping_add(self.bytes[usize::from(upper)]);
        }
        letters[26..].copy_from_slice(&self.bytes[0x80..]);
        letters
    }

    pub(crate) fn name(&mut self, namespace: &[u8], name: &[u8]) {
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
    let mut reader = Reader::default();
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
    Some(reader.finish())
}

/// Whether `after`, which is what has become of `before`, has all that is in `before` and nothing else. Both are what
/// `prepared_text` makes of a text.
pub(crate) fn has_same_content(before: &[u8], after: &[u8], parser: Parser) -> bool {
    match (signature(before, parser), signature(after, parser)) {
        (Some(before), Some(after)) => before == after,
        _ => false,
    }
}
