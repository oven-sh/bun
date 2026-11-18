//! <https://drafts.csswg.org/cssom/#css-style-sheets>

use core::cell::{Cell, Ref, RefCell};
use std::rc::Rc;

use crate::document::Document;
use crate::prelude::Prelude;
use crate::rule_tree::{EngineText, Place, Rank, Rule, RuleError, Settings};
use crate::sheet::{Block, Compiling, Import, Prepared, Sheet, Source, Within};
use crate::tree::NodeId;
use crate::values::Out;

/// Together they are the text of the sheet. Rules that are inserted at the end do not have the rest compiled again.
struct Chunk {
    source: Source,
    blocks: Vec<(u32, Rc<Block>)>,
    compiled: Option<Compiling>,
}

impl Chunk {
    fn new(source: Source) -> Chunk {
        Chunk {
            source,
            blocks: Vec::new(),
            compiled: None,
        }
    }
}

pub(crate) struct StyleSheet {
    settings: Rc<Settings>,
    is_constructed: bool,
    media: RefCell<Out>,
    pub(crate) is_disabled: Cell<bool>,
    /// The rules that an imported sheet is in.
    wrapping: RefCell<Out>,
    chunks: RefCell<Vec<Chunk>>,
    /// Since the last chunk.
    appended: RefCell<Out>,
    compiled_for: Cell<Option<(Within, NodeId)>>,
    rules: RefCell<Option<Vec<Rc<Rule>>>>,
    /// The rules are not what the chunks say.
    is_stale: Cell<bool>,
    pub(crate) imports: RefCell<Vec<Rc<StyleSheet>>>,
}

impl StyleSheet {
    const MAX_CHUNKS: usize = 24;

    pub(crate) fn new(source: Source, base_url: &[u8], is_constructed: bool) -> StyleSheet {
        StyleSheet {
            settings: Rc::new(Settings {
                base_url: Rc::<[u8]>::from(base_url).into(),
                ..Settings::default()
            }),
            is_constructed,
            media: RefCell::default(),
            is_disabled: Cell::new(false),
            wrapping: RefCell::default(),
            chunks: vec![Chunk::new(source)].into(),
            appended: RefCell::default(),
            compiled_for: Cell::default(),
            rules: RefCell::default(),
            is_stale: Cell::new(false),
            imports: RefCell::default(),
        }
    }

    pub(crate) fn is_constructed(&self) -> bool {
        self.is_constructed
    }

    pub(crate) fn base_url(&self) -> Rc<[u8]> {
        Rc::clone(&self.settings.base_url.borrow())
    }

    pub(crate) fn set_base_url(&self, url: &[u8]) {
        self.settings
            .base_url
            .replace([url, crate::values::FETCHED].concat().into());
        self.forget_compiled();
    }

    pub(crate) fn set_quirky(&self, is_quirky: bool) {
        self.settings.is_quirky.set(is_quirky);
    }

    pub(crate) fn media(&self) -> Ref<'_, Out> {
        self.media.borrow()
    }

    pub(crate) fn set_media(&self, media: &[u8]) {
        self.media.replace(media.to_vec());
        self.forget_compiled();
    }

    pub(crate) fn wrapping(&self) -> Ref<'_, Out> {
        self.wrapping.borrow()
    }

    /// Whether it is another one.
    pub(crate) fn set_wrapping(&self, wrapping: Out) -> bool {
        let has_changed = *self.wrapping.borrow() != wrapping;
        if has_changed {
            self.wrapping.replace(wrapping);
            self.forget_compiled();
        }
        has_changed
    }

    fn forget_compiled(&self) {
        self.compiled_for.set(None);
    }

    pub(crate) fn replace(&self, source: Source) {
        self.chunks.replace(vec![Chunk::new(source)]);
        self.appended.take();
        self.rules.take();
        self.is_stale.set(false);
    }

    pub(crate) fn has_parsed_rules(&self) -> bool {
        self.rules.borrow().is_some()
    }

    fn with_rules<R>(&self, run: impl FnOnce(&mut Vec<Rc<Rule>>) -> R) -> R {
        let parse = || {
            Place::top(&self.settings)
                .parse_sheet(&self.chunks.borrow()[0].source, !self.is_constructed)
        };
        run(self.rules.borrow_mut().get_or_insert_with(parse))
    }

    pub(crate) fn len(&self) -> usize {
        self.with_rules(|it| it.len())
    }

    pub(crate) fn rule(&self, index: usize) -> Option<Rc<Rule>> {
        self.with_rules(|it| it.get(index).cloned())
    }

    pub(crate) fn rules_changed(&self) {
        self.is_stale.set(true);
    }

    fn update_namespaces(&self, rules: &[Rc<Rule>]) {
        let of = |it: &Rc<Rule>| {
            if let Prelude::Namespace { prefix, url } = &*it.prelude() {
                Some((prefix.clone(), Rc::clone(url)))
            } else {
                None
            }
        };
        self.settings
            .namespaces
            .replace(rules.iter().filter_map(of).collect());
    }

    fn affects_imports(&self, rule: &Rule) -> bool {
        rule.rank() == Rank::Import
            || rule.is_layer_statement() && !self.imports.borrow().is_empty()
    }

    /// Whether what is imported has changed.
    pub(crate) fn insert_rule(&self, source: &[u8], index: usize) -> Result<bool, RuleError> {
        self.with_rules(|rules| {
            (index <= rules.len()).ok_or(RuleError::IndexSize)?;
            let place = Place::top(&self.settings);
            let rule = place
                .parse_rule(source)
                .filter(|it| !self.is_constructed || it.rank() != Rank::Import)
                .map(Rc::new)
                .ok_or(RuleError::Syntax)?;
            let is_appended = index == rules.len()
                && rule.rank() == Rank::Other
                && self.settings.namespaces.borrow().is_empty();
            place.insert(rules, Rc::clone(&rule), index)?;
            if is_appended && self.chunks.borrow().len() < Self::MAX_CHUNKS {
                let mut written = EngineText {
                    text: self.appended.take(),
                    ..EngineText::default()
                };
                rule.write_for_engine(&mut written);
                self.appended.replace(written.text);
            } else {
                self.update_namespaces(rules);
                self.rules_changed();
            }
            Ok(self.affects_imports(&rule))
        })
    }

    /// Whether what is imported has changed.
    pub(crate) fn delete_rule(&self, index: usize) -> Result<bool, RuleError> {
        self.with_rules(|rules| {
            let rank = rules.get(index).ok_or(RuleError::IndexSize)?.rank();
            (rank != Rank::Namespace || rules.iter().all(|it| it.rank() != Rank::Other))
                .ok_or(RuleError::InvalidState)?;
            let rule = rules.remove(index);
            self.update_namespaces(rules);
            self.rules_changed();
            Ok(self.affects_imports(&rule))
        })
    }

    fn update_chunks(&self) {
        let appended = self.appended.take();
        if self.is_stale.take() {
            let mut written = EngineText::default();
            self.with_rules(|rules| {
                rules
                    .iter()
                    .for_each(|it| it.write_for_engine(&mut written))
            });
            self.chunks.replace(vec![Chunk {
                blocks: written.blocks,
                ..Chunk::new(Source::copy_of(&written.text))
            }]);
        } else if !appended.is_empty() {
            self.chunks
                .borrow_mut()
                .push(Chunk::new(Source::copy_of(&appended)));
        }
    }

    /// `owner` is the root of an `@scope` rule that names none. A large sheet goes to another thread.
    pub(crate) fn start_compiling(&self, document: &mut Document, owner: NodeId) {
        self.update_chunks();
        let is_outdated =
            self.compiled_for.replace(Some((document.within(), owner))) != self.compiled_for.get();
        let wrapping = self.wrapping.borrow();
        let closing = vec![b'}'; bun_core::strings::count_char(&wrapping, b'{')];
        for chunk in self
            .chunks
            .borrow_mut()
            .iter_mut()
            .filter(|it| is_outdated || it.compiled.is_none())
        {
            let _shared = chunk.compiled.take().and_then(|it| document.take_back(it));
            let source = if wrapping.is_empty() {
                chunk.source.clone()
            } else {
                Source::copy_of(&[&wrapping, &chunk.source[..], &closing].concat())
            };
            let blocks = chunk
                .blocks
                .iter()
                .map(|it| (it.0 + wrapping.len() as u32, Rc::clone(&it.1)))
                .collect();
            chunk.compiled = Some(document.compile_sheet(
                source,
                &self.base_url(),
                &self.media.borrow(),
                owner,
                blocks,
            ));
        }
    }

    /// An imported sheet comes before the one that imports it.
    pub(crate) fn collect(
        &self,
        document: &mut Document,
        owner: NodeId,
        into: &mut Vec<Rc<Sheet>>,
    ) {
        if self.is_disabled.get() {
            return;
        }
        self.imports
            .borrow()
            .iter()
            .for_each(|it| it.collect(document, owner, into));
        self.start_compiling(document, owner);
        into.extend(
            self.chunks
                .borrow_mut()
                .iter_mut()
                .filter_map(|it| Some(it.compiled.as_mut()?.finish())),
        );
    }

    /// They are other ones once the text has changed.
    pub(crate) fn sources(&self) -> Vec<Source> {
        self.update_chunks();
        self.chunks
            .borrow()
            .iter()
            .map(|it| it.source.clone())
            .collect()
    }

    /// With the declarations that scripts have edited.
    pub(crate) fn text(&self) -> Out {
        let mut text = Out::new();
        for chunk in &*self.chunks.borrow() {
            let end = chunk.blocks.iter().fold(0, |start, (at, block)| {
                text.extend(
                    [
                        &chunk.source[start..*at as usize],
                        &block.editable().list.serialize(),
                    ]
                    .concat(),
                );
                *at as usize + EngineText::PLACEHOLDER.len()
            });
            text.extend_from_slice(&chunk.source[end..]);
        }
        text
    }

    /// In `text`.
    pub(crate) fn place_of(&self, block: &Rc<Block>) -> Option<usize> {
        let ((source, start), mut shift) = (block.place(), 0);
        for chunk in &*self.chunks.borrow() {
            let is_in_it = matches!(&chunk.compiled, Some(Compiling::Done(it)) if core::ptr::eq(&raw const **it.source(), &raw const **source) && !source.is_empty());
            let edited = || {
                chunk
                    .blocks
                    .iter()
                    .find(|it| Rc::ptr_eq(&it.1, block))
                    .map(|it| it.0 as usize)
            };
            let found = if is_in_it {
                start.checked_sub(self.wrapping.borrow().len())
            } else {
                edited()
            };
            let before = chunk
                .blocks
                .iter()
                .take_while(|it| found.is_none_or(|found| (it.0 as usize) < found));
            let (added, replaced) = before.fold((0, 0), |sum, it| {
                (
                    sum.0 + it.1.editable().list.serialize().len(),
                    sum.1 + EngineText::PLACEHOLDER.len(),
                )
            });
            shift += found.unwrap_or(chunk.source.len()) + added - replaced;
            if found.is_some() {
                return Some(shift);
            }
        }
        None
    }

    /// What its `@import` rules ask for.
    pub(crate) fn wanted_imports(&self, document: &mut Document, owner: NodeId) -> Vec<Import> {
        let can_wait = |it: &Chunk| {
            it.source.len() < Prepared::WORTHWHILE && Prepared::cannot_import(&it.source)
        };
        if !self.is_stale.get() && self.chunks.borrow().first().is_some_and(can_wait) {
            return Vec::new();
        }
        self.start_compiling(document, owner);
        let chunks = self.chunks.borrow();
        match (
            bun_core::strings::contains_char(&self.wrapping.borrow(), b'{'),
            &chunks[0].compiled,
        ) {
            (true, _) => {
                Sheet::parse(&chunks[0].source, &self.base_url(), document.within()).imports
            }
            (_, Some(Compiling::Done(sheet))) => sheet.imports.clone(),
            _ => Vec::new(),
        }
    }
}
