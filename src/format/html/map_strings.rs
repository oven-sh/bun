//! Prettier's `mapDoc(doc, (doc) => (typeof doc === "string" ? .. : doc))`, for captured content.

use crate::ir::element::{Group, GroupMode, Interned};
use crate::prelude::*;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

/// A transformation of a document's strings.
pub(crate) trait MapString {
    /// True if `text`, or a string that contains it, might change.
    fn changes(&self, text: &[u8]) -> bool;

    /// Writes the replacement for `text`. For `is_one_string`, see `TextWidth::multiline_string`.
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

/// Writes the captured `content` with its strings transformed by `map`. Adjacent strings are treated as one string,
/// because the document that Prettier maps has been through `cleanDoc`.
pub(crate) fn write_mapped(content: Interned, map: &mut impl MapString, f: &mut Formatter<'_>) {
    let source = f.source_text().as_bytes();
    // Nested captures are stored inside `content`'s own range, so this scan covers them too.
    let changes = f.storage.interned(content).iter().any(|element| {
        text_of(element, source, &f.storage.text).is_some_and(|text| map.changes(text))
    });
    match changes {
        false => f.write_element(FormatElement::Interned(content)),
        true => {
            let mut mapper = Mapper {
                map,
                mapped: FxHashMap::default(),
                strings: SmallVec::new(),
                text: Vec::new(),
                line_breaks: LineBreaks::None,
            };
            mapper.write(content, f);
        }
    }
}

/// True if a line-suffix comment in the captured `content` is still pending where `content` ends.
pub(crate) fn ends_with_line_suffix(content: Interned, f: &Formatter<'_>) -> bool {
    let (mut depth, mut is_waiting) = (0u32, false);
    for element in f.storage.interned(content) {
        match element {
            FormatElement::Tag(Tag::StartLineSuffix) => (depth, is_waiting) = (depth + 1, true),
            FormatElement::Tag(Tag::EndLineSuffix) => depth = depth.saturating_sub(1),
            FormatElement::Line(_)
            | FormatElement::IndentedLineGroup(_)
            | FormatElement::LineSuffixBoundary
            | FormatElement::Tag(Tag::StartIndentWithLine(_) | Tag::EndIndentWithLine(_))
                if depth == 0 =>
            {
                is_waiting = false;
            }
            _ => {}
        }
    }
    is_waiting
}

/// How the line breaks in strings are printed.
#[derive(Copy, Clone, PartialEq, Eq)]
enum LineBreaks {
    /// The strings have none.
    None,
    /// As plain characters. See `TextWidth::multiline_string`.
    Characters,
    /// Each as a `literalline`.
    LiteralLines,
}

/// Writes elements again, so that the facts recorded about the groups around them are right for the new texts.
struct Mapper<'m, M> {
    map: &'m mut M,
    /// Maps each capture to its copy with the new texts.
    mapped: FxHashMap<Interned, Interned>,
    /// The strings since the last non-string element. They haven't been written yet.
    strings: SmallVec<[FormatElement; 8]>,
    /// The same strings, concatenated.
    text: Vec<u8>,
    line_breaks: LineBreaks,
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

    /// Writes the pending strings.
    fn flush(&mut self, f: &mut Formatter<'_>) {
        if self.strings.is_empty() {
            return;
        }
        match self.map.changes(&self.text) {
            true => self
                .map
                .write(&self.text, self.line_breaks == LineBreaks::Characters, f),
            false => self
                .strings
                .iter()
                .for_each(|&string| f.write_element(string)),
        }
        self.strings.clear();
        self.text.clear();
        self.line_breaks = LineBreaks::None;
    }

    fn write(&mut self, content: Interned, f: &mut Formatter<'_>) {
        let source = f.source_text().as_bytes();
        let mut indices = content.range();
        while let Some(&element) = indices.next().and_then(|index| f.storage.pool.get(index)) {
            let line_breaks = match element {
                FormatElement::SourceText(text) | FormatElement::OwnedText(text) => {
                    match (text.width.is_one_string(), text.width.is_multiline()) {
                        (true, _) => LineBreaks::Characters,
                        (false, true) => LineBreaks::LiteralLines,
                        (false, false) => LineBreaks::None,
                    }
                }
                _ => LineBreaks::None,
            };
            if line_breaks != LineBreaks::None {
                // A string can only have one kind of line break.
                if self.line_breaks != LineBreaks::None && self.line_breaks != line_breaks {
                    self.flush(f);
                }
                self.line_breaks = line_breaks;
            }
            if let Some(text) = text_of(&element, source, &f.storage.text) {
                self.text.extend_from_slice(text);
                self.strings.push(element);
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
                    let variants: SmallVec<[Interned; 4]> =
                        f.storage.variants(best_fitting).iter().copied().collect();
                    let variants: SmallVec<[Interned; 4]> = variants
                        .into_iter()
                        .map(|variant| self.capture(variant, f))
                        .collect();
                    let mapped = f.best_fitting_with(&variants, best_fitting.fallback);
                    f.write_element(mapped);
                }
                // Its contents are measured again.
                FormatElement::Tag(Tag::StartGroup(group)) => {
                    let mode = match group.mode() {
                        GroupMode::Propagated => GroupMode::Flat,
                        mode => mode,
                    };
                    f.write_element(FormatElement::Tag(Tag::StartGroup(
                        Group::new().with_id(group.id()).with_mode(mode),
                    )));
                }
                element => f.write_element(element),
            }
        }
        self.flush(f);
    }
}
