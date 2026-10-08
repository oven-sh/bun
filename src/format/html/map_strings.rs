//! Prettier's `mapDoc(doc, (doc) => (typeof doc === "string" ? .. : doc))`, for content that has been captured.

use crate::ir::element::{Group, GroupMode, Interned};
use crate::prelude::*;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

/// What becomes of the strings of a document.
pub(crate) trait MapString {
    /// Whether `text`, or a string that it is a part of, may become something else.
    fn changes(&self, text: &[u8]) -> bool;

    /// Writes what `text` becomes. `is_one_string`: see `TextWidth::multiline_string`.
    fn write(&mut self, text: &[u8], is_one_string: bool, f: &mut Formatter<'_>);
}

fn text_of<'t>(element: &'t FormatElement, source: &'t [u8], owned: &'t [u8]) -> Option<&'t [u8]> {
    match element {
        FormatElement::Token(token) => Some(token.as_bytes()),
        FormatElement::SourceText(text) => source.get(text.range()),
        FormatElement::OwnedText(text) => owned.get(text.range()),
        _ => None,
    }
}

/// Writes `content`, which has been captured, with what `map` makes of its strings. Strings that follow each other are one
/// string: the document that Prettier maps has been through `cleanDoc`.
pub(crate) fn write_mapped(content: Interned, map: &mut impl MapString, f: &mut Formatter<'_>) {
    let source = f.source_text().as_bytes();
    // Everything that `content` stands for is in it: what is captured stays where it is written.
    let changes = f.storage.interned(content).iter().any(|element| text_of(element, source, &f.storage.text).is_some_and(|text| map.changes(text)));
    match changes {
        false => f.write_element(FormatElement::Interned(content)),
        true => {
            let mut mapper = Mapper {
                map,
                mapped: FxHashMap::default(),
                strings: SmallVec::new(),
                text: Vec::new(),
                is_one_string: false,
                has_literal_lines: false,
            };
            mapper.write(content, f);
        }
    }
}

/// Writes elements once more, so that what is known about the groups around them is right for the new texts.
struct Mapper<'m, M> {
    map: &'m mut M,
    /// What has been captured, and the same with the new texts.
    mapped: FxHashMap<Interned, Interned>,
    /// The strings since the last element that is not one, which have not been written yet.
    strings: SmallVec<[FormatElement; 8]>,
    /// The same, put together.
    text: Vec<u8>,
    /// One of them has line breaks that are nothing but characters.
    is_one_string: bool,
    /// One of them has line breaks that are a `literalline` each.
    has_literal_lines: bool,
}

impl<M: MapString> Mapper<'_, M> {
    fn capture(&mut self, content: Interned, f: &mut Formatter<'_>) -> Interned {
        if let Some(&mapped) = self.mapped.get(&content) {
            return mapped;
        }
        if !f.context_mut().has_stack_left() {
            return content;
        }
        let slot = f.start_capture();
        self.write(content, f);
        let mapped = f.end_capture(slot);
        self.mapped.insert(content, mapped);
        mapped
    }

    /// Writes the strings that have not been written yet.
    fn flush(&mut self, f: &mut Formatter<'_>) {
        if self.strings.is_empty() {
            return;
        }
        match self.map.changes(&self.text) {
            true => self.map.write(&self.text, self.is_one_string, f),
            false => self.strings.iter().for_each(|&string| f.write_element(string)),
        }
        self.strings.clear();
        self.text.clear();
        (self.is_one_string, self.has_literal_lines) = (false, false);
    }

    fn write(&mut self, content: Interned, f: &mut Formatter<'_>) {
        let source = f.source_text().as_bytes();
        let mut indices = content.range();
        while let Some(&element) = indices.next().and_then(|index| f.storage.pool.get(index)) {
            let (is_one_string, has_literal_lines) = match element {
                FormatElement::SourceText(text) | FormatElement::OwnedText(text) => {
                    (text.width.is_one_string(), text.width.is_multiline() && !text.width.is_one_string())
                }
                _ => (false, false),
            };
            if (is_one_string && self.has_literal_lines) || (has_literal_lines && self.is_one_string) {
                self.flush(f);
            }
            if let Some(text) = text_of(&element, source, &f.storage.text) {
                self.text.extend_from_slice(text);
                self.strings.push(element);
                self.is_one_string |= is_one_string;
                self.has_literal_lines |= has_literal_lines;
                continue;
            }
            match element {
                FormatElement::Skip(skip) => {
                    if skip.len > 0 {
                        indices.nth(skip.len as usize - 1);
                    }
                    continue;
                }
                FormatElement::Nop => continue,
                _ => self.flush(f),
            }
            match element {
                FormatElement::Interned(interned) => {
                    let mapped = self.capture(interned, f);
                    if mapped.len > 0 {
                        f.write_element(FormatElement::Interned(mapped));
                    }
                }
                FormatElement::BestFitting(best_fitting) => {
                    let variants: SmallVec<[Interned; 4]> = f.storage.variants(best_fitting).iter().copied().collect();
                    let variants: SmallVec<[Interned; 4]> = variants.into_iter().map(|variant| self.capture(variant, f)).collect();
                    let mapped = f.best_fitting_of(&variants);
                    f.write_element(mapped);
                }
                // What is in it is measured anew.
                FormatElement::Tag(Tag::StartGroup(group)) => {
                    let mode = if group.mode() == GroupMode::Expand { GroupMode::Expand } else { GroupMode::Flat };
                    f.write_element(FormatElement::Tag(Tag::StartGroup(Group::new().with_id(group.id()).with_mode(mode))));
                }
                element => f.write_element(element),
            }
        }
        self.flush(f);
    }
}
