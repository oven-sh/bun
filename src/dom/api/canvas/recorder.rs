//! One list of commands for all the canvases of a thread, because one can be drawn on another.

use core::ffi::c_void;
use core::ptr::NonNull;
use std::rc::Rc;

use bun_jsc::bindgen::JsInterface as _;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JsCell, Strong};

use super::context::Context;
use crate::abi::{Filter, GradientStop, Slice, Span};
use crate::abi_graphics::{Command, Commands};
use crate::platform::graphics;

#[derive(Default)]
pub(super) struct List {
    commands: Vec<u32>,
    pub(super) parts: Vec<u32>,
    pub(super) stops: Vec<GradientStop>,
    pub(super) filters: Vec<Filter>,
    pub(super) dashes: Vec<f32>,
    pub(super) text: Vec<u8>,
    selected: u32,
    /// How often it was sent.
    pub(super) generation: u32,
    is_queued: bool,
    has_sent_part: bool,
}

pub(super) fn add<T>(to: &mut Vec<T>, items: impl IntoIterator<Item = T>) -> Span {
    let start = to.len() as u32;
    to.extend(items);
    Span {
        start,
        end: to.len() as u32,
    }
}

impl List {
    #[inline]
    pub(super) fn add_part(&mut self, write: impl FnOnce(&mut Vec<u32>)) -> Span {
        let start = self.parts.len() as u32;
        write(&mut self.parts);
        Span {
            start,
            end: self.parts.len() as u32,
        }
    }

    #[inline(always)]
    pub(super) fn push(&mut self, command: Command) {
        command.write(&mut self.commands);
    }

    fn send(&mut self, is_partial: bool) {
        self.generation = self.generation.wrapping_add(1);
        if self.commands.is_empty() && (is_partial || !self.has_sent_part) {
            return;
        }
        let commands = Commands {
            commands: Slice::new(&self.commands),
            parts: Slice::new(&self.parts),
            stops: Slice::new(&self.stops),
            filters: Slice::new(&self.filters),
            dashes: Slice::new(&self.dashes),
            text: Slice::new(&self.text),
            is_partial,
        };
        if let Some(graphics) = graphics() {
            // SAFETY: what the slices point to outlives the call.
            unsafe { (graphics.draw)(&raw const commands) };
        }
        (self.selected, self.has_sent_part) = (0, is_partial);
        self.commands.clear();
        self.parts.clear();
        self.stops.clear();
        self.filters.clear();
        self.dashes.clear();
        self.text.clear();
        if !is_partial {
            self.parts.shrink_to(MAX_WORDS * 2);
            self.text.shrink_to(MAX_WORDS);
        }
    }
}

const MAX_WORDS: usize = 1 << 15;

#[derive(Default)]
pub(crate) struct Recorder {
    list: JsCell<List>,
    /// The contexts whose placeholder is behind.
    to_present: JsCell<Vec<Strong>>,
}

thread_local! {
    static CURRENT: Rc<Recorder> = Rc::default();
}

unsafe extern "C" fn at_end_of_task(recorder: *mut c_void) -> bool {
    // SAFETY: `CURRENT` outlives the event loop of its thread.
    let recorder = unsafe { &*recorder.cast::<Recorder>() };
    recorder.list.with_mut(|list| list.is_queued = false);
    recorder.present();
    recorder.list.get().is_queued
}

impl Recorder {
    pub(crate) fn current() -> Rc<Recorder> {
        CURRENT.with(Rc::clone)
    }

    #[cold]
    fn queue(&self) {
        VirtualMachine::get()
            .event_loop()
            .deferred_tasks
            .post_task(Some(NonNull::from(self).cast()), at_end_of_task);
    }

    /// `write` does not touch the JS heap, whose destructors record too.
    #[inline]
    pub(super) fn record<R>(&self, canvas: u32, write: impl FnOnce(&mut List) -> R) -> R {
        self.list.with_mut(|list| {
            if list.commands.len() + list.parts.len() > MAX_WORDS {
                list.send(true);
            }
            if !list.is_queued {
                list.is_queued = true;
                self.queue();
            }
            if list.selected != canvas {
                list.selected = canvas;
                list.push(Command::Select(canvas));
            }
            write(list)
        })
    }

    /// It changes at the end of the task, if not before.
    pub(super) fn generation(&self) -> u32 {
        self.list.with_mut(|list| {
            if !core::mem::replace(&mut list.is_queued, true) {
                self.queue();
            }
            list.generation
        })
    }

    /// For a command that is not about the selected canvas. It needs no event loop.
    pub(super) fn send(&self, command: Command) {
        self.list.with_mut(|list| {
            list.push(command);
            list.send(list.is_queued);
        });
    }

    /// Before the pixels are used.
    pub(super) fn flush(&self) {
        self.list.with_mut(|list| list.send(true));
    }

    /// The pixels were changed without a command.
    pub(super) fn did_write(&self) {
        self.generation();
        self.list.with_mut(|list| list.has_sent_part = true);
    }

    pub(super) fn will_present(&self, context: &Context) {
        let context = Strong::create(context.to_js(), VirtualMachine::get().global());
        self.to_present.with_mut(|all| all.push(context));
    }

    /// May run JavaScript.
    pub(crate) fn present(&self) {
        self.list.with_mut(|list| list.send(false));
        self.to_present
            .with_mut(core::mem::take)
            .iter()
            .for_each(|it| {
                // SAFETY: what `will_present` was given, which `it` holds.
                super::host::present(unsafe { Context::from_js_unchecked(it.get()) })
            });
    }
}
