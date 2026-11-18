//! https://wayland.app/protocols/text-input-unstable-v3

use std::cell::{Cell, RefCell};
use std::ops::Range;

use super::wire::{Event, Kind};
use super::{Global, Wayland};
use crate::input::TextInput;
use crate::platform::Window as _;

#[derive(Clone, Default, PartialEq)]
struct Field {
    /// Around the selection, without what is being composed.
    text: String,
    /// In bytes of that.
    selection: Range<usize>,
    caret: [i32; 4],
}

#[derive(Default)]
struct Edit {
    composed: Option<(String, i32, i32)>,
    typed: Option<String>,
    deleted: [u32; 2],
}

#[derive(Default)]
pub struct State {
    object: Cell<u32>,
    window: Cell<Option<u32>>,
    pub has_changed: Cell<bool>,
    /// What the input method knows.
    told: RefCell<Option<Field>>,
    edit: RefCell<Edit>,
    is_composing: Cell<bool>,
    was_edited: Cell<bool>,
    /// The input method may take it for granted that the text has changed.
    was_typed: Cell<bool>,
}

fn describe(input: TextInput) -> Option<Field> {
    const AROUND: usize = 400;
    let (caret, selected) = (input.caret()?, input.composing().or(input.selection())?);
    let part = |range: Range<usize>| {
        input
            .text(range)
            .map(|it| String::from_utf16_lossy(&it.0).replace('\0', " "))
            .unwrap_or_default()
    };
    let before = part(selected.start.saturating_sub(AROUND)..selected.start);
    let inside = if input.composing().is_some() || selected.len() > AROUND {
        String::new()
    } else {
        part(selected.clone())
    };
    Some(Field {
        selection: before.len()..before.len() + inside.len(),
        text: before + &inside + &part(selected.end..selected.end + AROUND),
        caret: [caret.x, caret.y, caret.width.max(1.), caret.height].map(|it| it as i32),
    })
}

fn in_utf16(text: &str, bytes: Range<usize>) -> usize {
    text[text.floor_char_boundary(bytes.start)..text.floor_char_boundary(bytes.end)]
        .encode_utf16()
        .count()
}

impl Wayland {
    pub fn watch_text_input(&self) {
        let seat = self.global(Global::Seat);
        if seat != 0 {
            self.text_input.object.set(self.wire.create(
                Kind::TextInput,
                0,
                self.global(Global::TextInput),
                1,
                &[seat],
            ));
        }
    }

    pub fn update_text_input(&'static self) {
        const COMPLETION_SPELLCHECK: u32 = 3;
        let (state, object) = (&self.text_input, self.text_input.object.get());
        if !state.has_changed.take() {
            return;
        }
        if object == 0 {
            let window = self
                .keyboard
                .focus
                .get()
                .filter(|it| TextInput(*it).is_enabled())
                .and_then(|it| self.window(it));
            return self.typing.tell_input_method(window.and_then(|window| {
                let (caret, frame) = (TextInput(window.id).caret()?, window.geometry());
                Some((
                    window.id,
                    [
                        frame.x + caret.x,
                        frame.y + caret.y,
                        caret.width,
                        caret.height,
                    ]
                    .map(|it| (it * frame.scale) as i32),
                ))
            }));
        }
        let Some(input) = state.window.get().map(TextInput) else {
            return;
        };
        if state.is_composing.get() && input.composing().is_none() {
            self.forget_composition();
        }
        let field = input.is_enabled().then(|| describe(input)).flatten();
        let before = state.told.replace(field.clone());
        let (was_edited, was_typed) = (state.was_edited.take(), state.was_typed.take());
        if before == field && !was_typed {
            return;
        }
        match field {
            None => self.wire.send(object, 2, &[]),
            Some(Field {
                text,
                selection,
                caret,
            }) => {
                if before.is_none() {
                    self.wire.send(object, 1, &[]);
                    self.wire.send(object, 5, &[COMPLETION_SPELLCHECK, 0]);
                }
                if was_typed
                    || before.is_none_or(|it| {
                        (it.text, it.selection) != (text.clone(), selection.clone())
                    })
                {
                    self.wire.send_text(
                        object,
                        3,
                        &[],
                        &text,
                        &[selection.end as u32, selection.start as u32],
                    );
                }
                self.wire.send(object, 4, &[(!was_edited).into()]);
                self.wire.send(object, 6, &caret.map(|it| it as u32));
            }
        }
        self.wire.send(object, 7, &[]);
    }

    /// The input method does so when it is turned off.
    fn forget_composition(&self) {
        let state = &self.text_input;
        state.is_composing.set(false);
        if state.told.take().is_some() {
            self.wire.send(state.object.get(), 2, &[]);
            self.wire.send(state.object.get(), 7, &[]);
        }
        state.has_changed.set(true);
    }

    /// What is being composed stays as it is.
    pub fn end_composition(&self) {
        self.typing.input_method().iter().for_each(|it| it.reset());
        if let Some(window) = self
            .text_input
            .window
            .get()
            .filter(|_| self.text_input.is_composing.get())
        {
            TextInput(window).end_composition();
            self.forget_composition();
        }
    }

    fn apply_edit(&self, input: TextInput) {
        let state = &self.text_input;
        let Edit {
            composed,
            typed,
            deleted: [before, after],
        } = state.edit.take();
        if before + after > 0 && input.composing().is_some() {
            input.insert(None, "");
        }
        let around = state
            .told
            .borrow()
            .as_ref()
            .filter(|_| before + after > 0)
            .and_then(
                |Field {
                     text, selection, ..
                 }| {
                    let range = input.selection()?;
                    let before = in_utf16(
                        text,
                        selection.start.saturating_sub(before as usize)..selection.start,
                    );
                    Some(
                        range.start.saturating_sub(before)
                            ..range.end
                                + in_utf16(text, selection.end..selection.end + after as usize),
                    )
                },
            );
        let composed = composed.filter(|it| !it.0.is_empty());
        let was_composing = state.is_composing.replace(composed.is_some());
        if typed.is_some() || around.is_some() || was_composing && composed.is_none() {
            input.insert(around, &typed.unwrap_or_default());
            state.was_edited.set(true);
            state.was_typed.set(true);
        }
        if let Some((text, start, end)) = composed {
            let selection = (start >= 0 && end >= start)
                .then(|| in_utf16(&text, 0..start as usize)..in_utf16(&text, 0..end as usize));
            input.compose(None, &text, selection);
            state.was_edited.set(true);
        }
        state.has_changed.set(true);
    }

    pub fn text_input_event(&self, event: &Event) {
        let state = &self.text_input;
        match event.opcode {
            0 => {
                state
                    .window
                    .set(self.window_of(event.u32(0)).map(|it| it.id));
                state.has_changed.set(true);
            }
            1 => {
                self.end_composition();
                self.forget_composition();
                state.window.set(None);
            }
            2 => {
                let (text, next) = event.text(0);
                state.edit.borrow_mut().composed =
                    Some((text, event.i32(next), event.i32(next + 1)));
            }
            3 => state.edit.borrow_mut().typed = Some(event.text(0).0).filter(|it| !it.is_empty()),
            4 => state.edit.borrow_mut().deleted = [event.u32(0).min(4000), event.u32(1).min(4000)],
            _ => state
                .window
                .get()
                .into_iter()
                .for_each(|it| self.apply_edit(TextInput(it))),
        }
    }
}
