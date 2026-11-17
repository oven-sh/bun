//! Marks the words that the spell checker of the system does not know.

use core::cell::{Cell, RefCell};

use super::{characters, edit_target, input_method, selected};
use crate::api::forms::{InputType, text_control};
use crate::api::ui::members::is_spellchecked;
use crate::api::ui::prelude::*;
use crate::generated_bindgen::interaction::js_Spelling;
use crate::name::Name;

const AFTER_WORD: f64 = 60.0;
const IN_WORD: f64 = 1000.0;
/// The first use keeps the user interface busy for a moment.
const BEFORE_FIRST_USE: f64 = 2000.0;
const MAX_NODES: usize = 64;
const MAX_LENGTH: u32 = 8192;

thread_local! {
    static IS_IN_USE: Cell<bool> = const { Cell::new(false) };
}

struct Checked {
    text: DomString,
    words: Vec<[u32; 2]>,
    is_current: bool,
}

impl Checked {
    /// Keeps the words that an edit has not touched.
    fn follow(&mut self, text: DomString) {
        let (old, new) = (self.text.len(), text.len());
        let head = self
            .text
            .units()
            .zip(text.units())
            .take_while(|(a, b)| a == b)
            .count() as u32;
        let tail = self
            .text
            .units()
            .rev()
            .zip(text.units().rev())
            .take((old.min(new) - head) as usize)
            .take_while(|(a, b)| a == b)
            .count() as u32;
        self.words.retain(|it| it[1] < head || it[0] > old - tail);
        self.words
            .iter_mut()
            .filter(|it| it[1] >= head)
            .for_each(|it| *it = it.map(|it| it + new - old));
        (self.text, self.is_current) = (text, false);
    }
}

#[derive(Default)]
pub(crate) struct Spelling {
    /// For each of `nodes`.
    checked: RefCell<Vec<Checked>>,
    serial: Cell<i32>,
}

slots!(Spelling = js_Spelling {} [nodes: Node,]);

impl Spelling {
    fn show(&self, ui: &Ui) {
        let checked = self.checked.borrow();
        let words = self.nodes().iter().zip(&*checked).flat_map(|(node, it)| {
            it.words
                .iter()
                .map(move |&[start, end]| [node.id(), start, node.id(), end])
        });
        let words: Vec<_> = words.collect();
        ui.doc().engine(|engine, _| {
            engine.set_marks(
                crate::editing::Mark::Highlight(Name::new(b"::spelling-error")),
                -3,
                &words,
            )
        });
    }

    pub(super) fn before_frame<'a>(&'a self, cx: &mut Cx<'a>, ui: &'a Ui) {
        let (nodes, mut has_changed) = (self.nodes(), false);
        let is_there = |it: &Node| it.is_connected() && it.doc() == ui.doc();
        let mut rest = nodes.iter();
        self.checked.borrow_mut().retain_mut(|checked| {
            let text = rest.next().filter(|it| is_there(it)).map(NodeExt::text);
            if text.as_ref() == Some(&checked.text) {
                return true;
            }
            has_changed |= !checked.words.is_empty();
            text.map(|it| checked.follow(it)).is_some()
        });
        if self.checked.borrow().len() < nodes.len() {
            self.set_nodes(Refs::collect(
                &cx.heap,
                nodes.iter().filter(|it| is_there(it)),
            ));
        }
        if has_changed {
            self.show(ui);
        }
    }

    /// Whether the system is to be asked.
    fn begin_check(&self, heap: &JsHeap<'_>, node: &Node, text: &DomString) -> bool {
        let Some(index) = self.nodes().position(node) else {
            self.set_nodes(self.nodes().with(heap, node));
            self.checked.borrow_mut().push(Checked {
                text: text.clone(),
                words: Vec::new(),
                is_current: true,
            });
            return true;
        };
        let checked = &mut self.checked.borrow_mut()[index];
        checked.text == *text && !core::mem::replace(&mut checked.is_current, true)
    }

    fn check<'a>(&'a self, cx: &mut Cx<'a>, ui: &'a Ui) -> Option<()> {
        let target = edit_target(cx, ui).filter(|_| {
            ui.has_window.get() && ui.composition_node().is_none() && host::checks_spelling(ui)
        })?;
        let control = text_control(target);
        if control.is_some_and(|it| {
            !matches!(it.kind(), None | Some(InputType::Text | InputType::Search))
        }) {
            return None;
        }
        IS_IN_USE.set(true);
        let root = control.and_then(|it| it.editor_text()).unwrap_or(target);
        let texts = root.inclusive_descendants().filter(|it| {
            it.is_text() && it.length() <= MAX_LENGTH && !it.text().to_utf8().trim().is_empty()
        });
        let checked = texts
            .filter(|it| {
                (control.is_some() || looks_like(cx, it, Looks::EDITABLE)) && is_spellchecked(it)
            })
            .take(MAX_NODES);
        let checked: Vec<_> = checked.collect();
        for node in Refs::collect(&cx.heap, checked).iter() {
            let text = node.text();
            if self.begin_check(&cx.heap, node, &text) {
                host::check_spelling(cx, ui, node, text);
            }
        }
        None
    }
}

/// The answer to `host::check_spelling`.
pub(crate) fn found<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    node: &'a Node,
    text: &DomString,
    words: &[[u32; 2]],
) -> Option<()> {
    let spelling = ui.spelling()?;
    let index = spelling
        .nodes()
        .position(node)
        .filter(|_| node.text() == *text)?;
    let words = words
        .iter()
        .copied()
        .filter(|it| it[0] <= it[1] && it[1] <= text.len())
        .collect();
    let old = core::mem::replace(&mut spelling.checked.borrow_mut()[index].words, words);
    if old != spelling.checked.borrow()[index].words {
        spelling.show(ui);
        ui.doc().invalidate(cx);
    }
    None
}

pub(super) fn caret_or_text_changed<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    if !ui.has_spell_checker {
        return;
    }
    let spelling = ui
        .spelling()
        .unwrap_or_else(|| js_Spelling::create(&cx.heap, Spelling::default()));
    ui.set_spelling(Some(spelling));
    spelling.serial.update(|it| it.wrapping_add(1));
    let Some(is_in_word) = input_method::with_surroundings(ui, |it| {
        characters::ends_in_word(&it.text, it.selection[1])
    }) else {
        return;
    };
    let delay = if !IS_IN_USE.get() {
        BEFORE_FIRST_USE
    } else if is_in_word {
        IN_WORD
    } else {
        AFTER_WORD
    };
    host::set_timeout(
        cx,
        ui,
        delay,
        [ui.value(), spelling.serial.get().into()],
        |cx, [ui, serial]| {
            let ui = Ui::from_value(ui);
            ui.and_then(|ui| {
                ui.spelling()
                    .filter(|it| it.serial.get() == serial.as_int32())?
                    .check(cx, ui)
            });
        },
    );
}

/// Selects the marked word where the selection starts.
pub(crate) fn select_misspelling<'a>(cx: &mut Cx<'a>, ui: &'a Ui) -> DomString {
    let find = || {
        let (spelling, range) = (ui.spelling()?, selected(ui)?);
        let (start, end) = (range.start(), range.end());
        let checked = &spelling.checked.borrow()[spelling
            .nodes()
            .position(start.node)
            .filter(|_| start.node == end.node)?];
        let word = checked
            .words
            .iter()
            .find(|it| it[0] <= start.offset && end.offset <= it[1])
            .filter(|_| checked.text == start.node.text())?;
        Some(word.map(|offset| Point { offset, ..start }))
    };
    let Some([start, end]) = find() else {
        return DomString::default();
    };
    range::selection_of(&cx.heap, ui.doc()).select(cx, start, end);
    start
        .node
        .text()
        .substring(start.offset, end.offset - start.offset)
}

/// The dictionary has changed.
pub(crate) fn check_again<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    if let Some(spelling) = ui.spelling() {
        spelling
            .checked
            .borrow_mut()
            .iter_mut()
            .for_each(|it| it.is_current = false);
        spelling.check(cx, ui);
    }
}
