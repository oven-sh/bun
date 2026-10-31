//! `bun fmt --debug-check`: checks that formatting didn't lose or invent anything.
//!
//! The output is parsed and compared with the original file:
//!
//! - The elements, comments, blocks and declarations are the same, in the same order and with the same nesting, and the
//!   elements have the same attributes in the same order. Case is ignored.
//! - HTML text that isn't just whitespace shows up in the same positions as before and nowhere else. A stray `>`
//!   between two elements counts as new text.
//! - Everything textual has each letter the same number of times, ignoring whitespace, punctuation, numbers and case.
//!   That covers text, comments, scripts, style sheets, attribute values and expressions. So nothing with a letter in
//!   it is lost or duplicated, whatever language it's in. Reordered letters aren't detected.

use super::Parser;
use super::ast::{Id, Kind, Tree};
use super::parse;
use bun_collections::ByteSet;
use rustc_hash::FxHasher;
use std::hash::Hasher;

/// The facts about a text that are compared.
#[derive(PartialEq, Eq)]
pub(crate) struct Signature {
    /// A hash of the nodes that aren't text.
    structure: u64,
    /// The count of each letter, and of each byte of non-ASCII characters.
    letters: [u64; 26 + 128],
}

pub(crate) struct Reader {
    structure: FxHasher,
    /// The count of each byte that matters.
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

/// Bytes that don't always count, or that can make a neighboring byte not count.
const SPECIAL: ByteSet = ByteSet::of(b"eE\\\xC2\xC4\xE1\xE2\xE3\xEF");

/// `/^[+-]?0+(?!\d)/.test(text)`
#[optimize(size)]
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
    #[optimize(size)]
    fn add(&mut self, byte: u8) {
        let count = &mut self.bytes[usize::from(byte)];
        *count = count.wrapping_add(1);
    }

    /// Un-counts `byte`, whether it has already been added or will be added later.
    #[optimize(size)]
    fn uncount(&mut self, byte: u8) {
        let count = &mut self.bytes[usize::from(byte)];
        *count = count.wrapping_sub(1);
    }

    /// Records something that isn't text.
    #[optimize(size)]
    pub(crate) fn mark(&mut self, mark: u8) {
        self.structure.write_u8(mark);
    }

    #[optimize(size)]
    pub(crate) fn finish(&self) -> Signature {
        Signature {
            structure: self.structure.finish(),
            letters: self.letters(),
        }
    }

    #[optimize(size)]
    pub(crate) fn count(&mut self, text: &[u8]) {
        for (at, &byte) in text.iter().enumerate() {
            self.add(byte);
            if SPECIAL.has(byte) {
                self.adjust_for_special_byte(text, at);
            }
        }
    }

    /// Un-counts the bytes that shouldn't count because of the byte at `at`, which is one of `SPECIAL`.
    #[optimize(size)]
    fn adjust_for_special_byte(&mut self, text: &[u8], at: usize) {
        let (before, rest) = text.split_at_checked(at).unwrap_or_default();
        let previous = before.last().copied().unwrap_or(0);
        match *rest {
            // A number's exponent, which is dropped if it's zero.
            [byte @ (b'e' | b'E'), ref exponent @ ..] => {
                if matches!(*before, [.., b'0'..=b'9'] | [.., b'0'..=b'9', b'.'])
                    && is_zero(exponent)
                {
                    self.uncount(byte);
                }
            }
            // `\n` in a template with HTML in it is whitespace.
            [b'\\', next, ..] => self.uncount(next),
            _ if previous == b'\\' => {}
            // Lowercased, U+0130 becomes an `i` and U+0307.
            [0xC4, 0xB0, ..] => {
                b"\xC4\xB0".iter().for_each(|&byte| self.uncount(byte));
                b"i\xCC\x87".iter().for_each(|&byte| self.add(byte));
            }
            _ => (rest.iter().take(bun_core::strings::js_whitespace_len(rest)))
                .for_each(|&byte| self.uncount(byte)),
        }
    }

    /// Like `count`, for an attribute value, where a quote can be written as an entity.
    #[optimize(size)]
    pub(crate) fn count_value(&mut self, value: &[u8]) {
        self.count(value);
        for entity in [&b"&quot;"[..], b"&apos;"] {
            let mut rest = value;
            while let Some(at) = bun_core::strings::index_of(rest, entity) {
                entity.iter().for_each(|&byte| self.uncount(byte));
                rest = &rest[at + entity.len()..];
            }
        }
    }

    /// Returns the count of each letter, and of each byte of non-ASCII characters.
    #[optimize(size)]
    fn letters(&self) -> [u64; 26 + 128] {
        let mut letters = [0; 26 + 128];
        for (count, lower) in letters.iter_mut().zip(b'a'..=b'z') {
            let upper = lower.to_ascii_uppercase();
            *count = self.bytes[usize::from(lower)].wrapping_add(self.bytes[usize::from(upper)]);
        }
        letters[26..].copy_from_slice(&self.bytes[0x80..]);
        letters
    }

    /// Records text that has to stay where it is, byte for byte.
    #[optimize(size)]
    pub(crate) fn exact(&mut self, text: &[u8]) {
        self.structure.write(text);
        self.structure.write_u8(0);
    }

    #[optimize(size)]
    pub(crate) fn name(&mut self, namespace: &[u8], name: &[u8]) {
        for &byte in namespace.iter().chain(b":").chain(name) {
            self.structure.write_u8(byte.to_ascii_lowercase());
        }
        self.structure.write_u8(0);
    }

    /// Records `id` itself, before its children.
    #[optimize(size)]
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

/// True if `id` contains code in another language. Formatting can remove all of it, as in `<script>;</script>`.
#[optimize(size)]
fn has_other_language(tree: &Tree<'_>, id: Id, parser: Parser) -> bool {
    matches!(&tree[id].name[..], b"script" | b"style" | b"mj-style")
        || (parser == Parser::Vue && tree.parent(id) == Some(tree.root))
}

#[optimize(size)]
fn signature(text: &[u8], parser: Parser) -> Option<Signature> {
    let (content, front_matter_len) = super::without_front_matter(text);
    let mut tree = Tree::default();
    parse::parse(&content, front_matter_len, parser, &mut tree).ok()?;
    let mut reader = Reader::default();
    // Preorder: a node's children come right after it.
    let root = tree.root;
    let mut next = tree.first_child(root);
    // Adjacent text nodes count as one.
    let mut is_after_text = false;
    while let Some(id) = next {
        if !matches!(tree[id].kind, Kind::Text | Kind::Cdata) {
            is_after_text = false;
        } else if !is_after_text
            && !tree[id].value.trim_ascii().is_empty()
            && !(tree.parent(id)).is_some_and(|parent| has_other_language(&tree, parent, parser))
        {
            reader.mark(1 + Kind::Text as u8);
            is_after_text = true;
        }
        reader.enter(&tree, id, text);
        next = tree.first_child(id).or_else(|| {
            let mut at = id;
            loop {
                if !matches!(tree[at].kind, Kind::Text | Kind::Cdata) {
                    reader.structure.write_u8(0);
                    is_after_text = false;
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

/// True if `after`, the result of formatting `before`, has the same content as `before`. Both must have gone through
/// `prepared_text`.
#[optimize(size)]
pub(crate) fn has_same_content(before: &[u8], after: &[u8], parser: Parser) -> bool {
    match (signature(before, parser), signature(after, parser)) {
        (Some(before), Some(after)) => before == after,
        _ => false,
    }
}
