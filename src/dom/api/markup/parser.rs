//! The parser that a document is associated with while it loads.

use core::cell::{Cell, RefCell};

use bun_jsc::JSValue;
use bun_jsc::bindgen::{JsHeap, JsInterface, JsScope};
use bun_markup::Text as Buffer;
use bun_markup::html::{self, Sink as _, Stop};

use super::sink::{Cells, Client, Sink};
use super::{DocumentOptions, FragmentOptions, parse_html_fragment, xml};
use crate::api::core::{NodeFlags as F, *};
use crate::api::loading;
use crate::api::support::without_collecting;
use crate::generated_bindgen::markup::js_DocumentParser as js;

const MAX_SPECULATIONS: u32 = 16;
const MAX_KEPT: u32 = 4096;

/// The throw-on-dynamic-markup-insertion counter.
#[derive(Default)]
struct MarkupInsertion(Cell<u32>);

pub(super) struct Forbidden<'a>(&'a Cell<u32>);

impl Drop for Forbidden<'_> {
    fn drop(&mut self) {
        self.0.set(self.0.get() - 1);
    }
}

pub(super) fn forbid_markup_insertion(doc: &Doc) -> Forbidden<'_> {
    let counter = &doc.extra::<MarkupInsertion>().0;
    counter.set(counter.get() + 1);
    Forbidden(counter)
}

pub(crate) fn throws_on_markup_insertion(doc: &Doc) -> bool {
    doc.try_extra::<MarkupInsertion>()
        .is_some_and(|it| it.0.get() > 0)
}

enum Source {
    Html(Box<html::Parser<Cells>>),
    Xml(xml::Builder),
}

pub(crate) struct DocumentParser {
    source: RefCell<Source>,
    /// By what ran in the middle of a token.
    written_meanwhile: RefCell<Buffer>,
    /// From the network, while there is an insertion point before the end.
    received_meanwhile: RefCell<Buffer>,
    runs_scripts: bool,
    script_nesting_level: Cell<u32>,
    has_ended: Cell<bool>,
    ends_after_script: Cell<bool>,
    is_paused: Cell<bool>,
    has_stopped: Cell<bool>,
    is_from_script: Cell<bool>,
    is_inserting: Cell<bool>,
    kept: Cell<u32>,
    speculations: Cell<u32>,
    speculated_on: Cell<usize>,
}

impl DocumentParser {
    pub(super) fn create<'a>(
        heap: &JsHeap<'a>,
        doc: &'a Doc,
        options: html::Options,
        runs_scripts: bool,
    ) -> &'a DocumentParser {
        let parser = DocumentParser {
            source: RefCell::new(Source::Html(Box::new(html::Parser::new(options)))),
            written_meanwhile: RefCell::default(),
            received_meanwhile: RefCell::default(),
            runs_scripts,
            script_nesting_level: Cell::new(0),
            has_ended: Cell::new(false),
            ends_after_script: Cell::new(false),
            is_paused: Cell::new(false),
            has_stopped: Cell::new(false),
            is_from_script: Cell::new(false),
            is_inserting: Cell::new(false),
            kept: Cell::new(0),
            speculations: Cell::new(0),
            speculated_on: Cell::new(0),
        };
        let parser = js::create(doc.realm(heap), parser);
        js::set_document(parser, Some(doc));
        js::set_kept(parser, List::new(heap).to_js());
        parser
    }

    pub(crate) fn for_loading<'a>(heap: &JsHeap<'a>, doc: &'a Doc) -> &'a DocumentParser {
        DocumentParser::create(
            heap,
            doc,
            DocumentOptions {
                allows_shadow_roots: doc.is(DocFlags::HAS_PAGE | DocFlags::ALLOWS_SHADOW_ROOTS),
                scripting: doc.is(DocFlags::HAS_PAGE),
            }
            .into(),
            true,
        )
    }

    /// Of a document that nothing else has. What is in templates stays there.
    pub(crate) fn for_copy<'a>(heap: &JsHeap<'a>, doc: &'a Doc) -> &'a DocumentParser {
        DocumentParser::create(
            heap,
            doc,
            html::Options {
                scripting: true,
                allows_declarative_shadow_roots: false,
                allows_patches: false,
                keeps_mode: false,
            },
            false,
        )
    }

    pub(crate) fn run_on_copy<'a>(&'a self, cx: &mut JsScope<'a>) {
        without_collecting(cx, |cx| {
            self.with_html(|parser| {
                let mut sink = Sink::new(cx, self.doc(), Client::Inert);
                while !matches!(parser.run(&mut sink), Stop::NeedsInput) {}
                drop(sink);
                self.keep_only_what_is_needed(&cx.heap, parser);
            })
        });
    }

    /// With the document.
    pub(crate) fn kept_nodes(&self) -> impl Iterator<Item = &Node> {
        self.kept_list().nodes().chain([&**self.doc()])
    }

    fn doc(&self) -> &Doc {
        js::document(self).expect("it was set")
    }

    fn kept_list(&self) -> List<'_> {
        List::from_value(js::kept(self).expect("it was set"))
    }

    pub(super) fn runs_scripts(&self) -> bool {
        self.runs_scripts
    }

    /// Script can take it out of the tree while it is open.
    #[inline]
    pub(super) fn keep(&self, heap: &JsHeap<'_>, node: &Node) {
        self.kept_list().push(heap, node.to_js());
        self.kept.set(self.kept.get() + 1);
    }

    fn keep_only_what_is_needed(&self, heap: &JsHeap<'_>, parser: &html::Parser<Cells>) {
        let (kept, old) = (self.kept_list(), self.kept_list().len());
        parser.nodes().for_each(|it| kept.push(heap, it));
        kept.remove_range(heap, 0, old);
        self.kept.set(0);
    }

    #[inline]
    pub(super) fn needs_attention(&self) -> bool {
        self.is_paused.get() || self.kept.get() > MAX_KEPT
    }

    pub(super) fn set_inserting(&self, on: bool) {
        self.is_inserting.set(on);
    }

    fn step<'a>(&'a self, cx: &mut JsScope<'a>) -> Stop<JSValue> {
        let Ok(mut source) = self.source.try_borrow_mut() else {
            return Stop::NeedsInput;
        };
        match &mut *source {
            Source::Xml(builder) => builder.load(cx, self.doc(), self),
            Source::Html(parser) => {
                parser.write(self.written_meanwhile.take().chars());
                if self.script_nesting_level.get() == 0 {
                    parser.write(self.received_meanwhile.take().chars());
                }
                if self.has_ended.get() {
                    parser.end();
                }
                if self.kept.get() > MAX_KEPT {
                    self.keep_only_what_is_needed(&cx.heap, parser);
                }
                match parser.run(&mut Sink::new(cx, self.doc(), Client::Loading(self))) {
                    Stop::NeedsInput if !self.written_meanwhile.borrow().is_empty() => Stop::Paused,
                    Stop::NeedsInput
                        if !self.received_meanwhile.borrow().is_empty()
                            && self.script_nesting_level.get() == 0 =>
                    {
                        Stop::Paused
                    }
                    stop => stop,
                }
            }
        }
    }

    pub(crate) fn run<'a>(&'a self, cx: &mut JsScope<'a>) {
        while !self.is_paused.get() && !self.has_stopped.get() && !cx.global().has_exception() {
            let stop = self.step(cx);
            self.doc().report_bare(cx);
            match stop {
                Stop::NeedsInput => break,
                Stop::Paused => {}
                Stop::Insert(node, place) => {
                    Sink::new(cx, self.doc(), Client::Loading(self)).insert_element(node, place)
                }
                Stop::Script(_) if self.has_stopped.get() => break,
                Stop::Script(_) if !self.runs_scripts => {}
                // SAFETY: `keep` holds it.
                Stop::Script(script) => loading::script_was_parsed(cx, self, self.doc(), unsafe {
                    Node::from_cell(script)
                }),
                Stop::Finished if self.has_stopped.replace(true) || !self.runs_scripts => {}
                Stop::Finished => loading::parser_has_ended(cx, self.doc()),
            }
        }
    }

    pub(crate) fn write(&self, text: &DomString) {
        match self.source.try_borrow_mut().as_deref_mut() {
            Ok(Source::Html(parser)) if self.written_meanwhile.borrow().is_empty() => {
                parser.write(text.chars())
            }
            _ => self.written_meanwhile.borrow_mut().push(text.chars()),
        }
    }

    pub(crate) fn receive(&self, text: &DomString) {
        match self.source.try_borrow_mut().as_deref_mut() {
            Ok(Source::Html(parser))
                if self.script_nesting_level.get() == 0
                    && self.written_meanwhile.borrow().is_empty()
                    && self.received_meanwhile.borrow().is_empty() =>
            {
                parser.write(text.chars())
            }
            _ => self.received_meanwhile.borrow_mut().push(text.chars()),
        }
    }

    pub(crate) fn start_xml(&self, source: &DomString) {
        *self.source.borrow_mut() = Source::Xml(xml::Builder::for_document(source, self.doc()));
    }

    /// There is no more input.
    pub(crate) fn end(&self) {
        self.has_ended.set(true);
    }

    /// `document.close()`
    pub(crate) fn close<'a>(&'a self, cx: &mut JsScope<'a>) {
        if !self.is_from_script.get() {
            return;
        }
        if self.script_nesting_level.get() > 0 {
            return self.ends_after_script.set(true);
        }
        self.end();
        self.run(cx);
    }

    pub(crate) fn abort(&self) {
        self.is_paused.set(true);
        self.has_stopped.set(true);
        self.kept_list()
            .nodes()
            .for_each(|it| it.unset(F::BEING_PARSED));
    }

    fn with_html<R>(&self, run: impl FnOnce(&mut html::Parser<Cells>) -> R) -> Option<R> {
        match self.source.try_borrow_mut().as_deref_mut() {
            Ok(Source::Html(parser)) => Some(run(parser)),
            _ => None,
        }
    }

    /// What `run` writes is parsed before the rest of the input.
    pub(crate) fn with_insertion_point<'a>(
        &self,
        cx: &mut JsScope<'a>,
        run: impl FnOnce(&mut JsScope<'a>),
    ) {
        let (level, has_begun) = (
            &self.script_nesting_level,
            self.with_html(html::Parser::begin_script),
        );
        level.set(level.get() + 1);
        run(cx);
        level.set(level.get() - 1);
        if has_begun.is_some() {
            self.with_html(html::Parser::end_script);
        }
        if level.get() == 0 && self.ends_after_script.get() {
            self.end();
        }
    }

    /// The tree for <https://html.spec.whatwg.org/#speculative-html-parsing>.
    pub(crate) fn speculate<'a>(&'a self, cx: &mut JsScope<'a>) -> Option<&'a Node> {
        let unread = self
            .with_html(|it| {
                Some((
                    it.current_node().filter(|_| !it.is_in_template())?,
                    it.unread(),
                ))
            })
            .flatten();
        let (current, unread) = unread.filter(|it| it.1.chars().contains(b'<'))?;
        if self.speculated_on.replace(unread.len()) == unread.len()
            || self.speculations.get() == MAX_SPECULATIONS
        {
            return None;
        }
        self.speculations.set(self.speculations.get() + 1);
        // SAFETY: `keep` holds it.
        let context = unsafe { Node::from_cell(current) }.as_element()?;
        let options = FragmentOptions {
            allows_shadow_roots: true,
            is_inert: true,
            ..Default::default()
        };
        Some(parse_html_fragment(
            cx,
            context,
            unread.chars(),
            context,
            options,
        ))
    }

    /// It is in the middle of a token if it cannot tell.
    pub(crate) fn is_open(&self, node: &Node) -> bool {
        match self.source.try_borrow().as_deref() {
            Ok(Source::Html(parser)) => parser.is_open(node.to_js()),
            Ok(Source::Xml(_)) => false,
            Err(_) => true,
        }
    }

    pub(crate) fn has_insertion_point(&self) -> bool {
        self.is_from_script.get() && !self.has_ended.get() || self.script_nesting_level.get() > 0
    }

    pub(crate) fn script_nesting_level(&self) -> u32 {
        self.script_nesting_level.get()
    }

    pub(crate) fn is_paused(&self) -> bool {
        self.is_paused.get()
    }

    pub(crate) fn set_paused(&self, value: bool) {
        self.is_paused.set(value);
    }

    pub(crate) fn is_from_script(&self) -> bool {
        self.is_from_script.get()
    }

    pub(crate) fn set_is_from_script(&self, value: bool) {
        self.is_from_script.set(value);
    }

    pub(crate) fn is_inserting(&self) -> bool {
        self.is_inserting.get()
    }
}
