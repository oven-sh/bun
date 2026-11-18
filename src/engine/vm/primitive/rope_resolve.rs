//! Puts the characters of a rope together.

use core::mem::MaybeUninit;

use bun_alloc::AllocError;
use bun_engine_text::{CodeUnit, Cursor, StringBuilder, StringImpl, StringRef, Text};

use crate::{Cx, Gc, JsResult, JsRopeString, JsString, Vm};

#[derive(Clone, Copy)]
enum Task {
    Write { rope: Gc<JsRopeString>, at: u32 },
    Repeat { from: u32, to: u32, length: u32 },
}

/// The shortest fiber goes first, so a task is put off only while what is worked on is half as long as what contains
/// both, and two tasks while it is a third as long. 3^20 is more than any length.
const MAX_PENDING_TASKS: usize = 40;

struct Pending {
    tasks: [MaybeUninit<Task>; MAX_PENDING_TASKS],
    count: usize,
}

impl Pending {
    fn push(&mut self, task: Task) {
        self.tasks[self.count].write(task);
        self.count += 1;
    }

    #[inline(always)]
    fn pop(&mut self) -> Option<Task> {
        self.count = self.count.checked_sub(1)?;
        // SAFETY: those below the count are written.
        Some(unsafe { self.tasks[self.count].assume_init() })
    }

    /// Puts off all but the shortest, which it returns.
    #[inline(never)]
    fn put_off(&mut self, ropes: &mut [(Gc<JsRopeString>, u32)]) -> (Gc<JsRopeString>, u32) {
        ropes.sort_unstable_by_key(|&(rope, _)| (!rope.rope_length(), rope.address()));
        for pair in ropes.array_windows::<2>() {
            let [(rope, at), (next, from)] = *pair;
            self.push(if rope == next {
                let length = rope.rope_length();
                Task::Repeat {
                    from,
                    to: at,
                    length,
                }
            } else {
                Task::Write { rope, at }
            });
        }
        ropes[ropes.len() - 1]
    }
}

/// Returns what is in front of it. `piece` is no concatenation.
#[inline(always)]
fn copy_to_end<'a, T: CodeUnit>(
    piece: &JsString,
    target: &'a mut [MaybeUninit<T>],
) -> &'a mut [MaybeUninit<T>] {
    #[inline(never)]
    fn copy_unusual<T: CodeUnit>(piece: &JsString, target: &mut [MaybeUninit<T>]) {
        piece.try_view().expect("one piece").text().copy_to(target);
    }
    let (front, place) = target.split_at_mut(target.len() - piece.len() as usize);
    match piece.try_impl().map(StringImpl::text) {
        Some(Text::Latin1(characters)) => T::copy_from_latin1(place, characters),
        _ => copy_unusual(piece, place),
    }
    front
}

impl JsRopeString {
    /// `self` is a concatenation. This is for one that has grown at its end.
    #[inline(never)]
    fn copy_fibers_to<T: CodeUnit>(&self, mut target: &mut [MaybeUninit<T>]) {
        assert!(target.len() == self.rope_length() as usize);
        let (mut first, mut last, mut behind) = self.fibers();
        loop {
            // The one loop does for all three fibers, so that there is one copy of the code that copies.
            let piece = behind.unwrap_or(last);
            if let Some(rope) = piece.as_concatenation() {
                if rope.rope_length() as usize != target.len() {
                    let (front, place) = target.split_at_mut(target.len() - piece.len() as usize);
                    rope.copy_tree_to(place);
                    target = front;
                } else {
                    (first, last, behind) = rope.fibers();
                    continue;
                }
            } else {
                target = copy_to_end(&piece, target);
            }
            if target.is_empty() {
                return;
            }
            if behind.take().is_none() {
                last = first;
            }
        }
    }

    /// The same for any shape.
    #[inline(never)]
    fn copy_tree_to<T: CodeUnit>(&self, target: &mut [MaybeUninit<T>]) {
        assert!(target.len() == self.rope_length() as usize);
        let mut pending = Pending {
            tasks: [const { MaybeUninit::uninit() }; MAX_PENDING_TASKS],
            count: 0,
        };
        // SAFETY: a rope is a cell.
        let (mut rope, mut at) = (unsafe { Gc::from_address(self.address()) }, 0);
        loop {
            let (mut nested, mut count) = ([(rope, 0); 3], 0);
            let mut place = |fiber: Gc<JsString>| match fiber.as_concatenation() {
                Some(concatenation) => {
                    nested[count] = (concatenation, at);
                    count += 1;
                    at += concatenation.rope_length();
                }
                None => {
                    let view = fiber.try_view().expect("one piece");
                    let text = view.text();
                    text.copy_to(&mut target[at as usize..][..text.len()]);
                    at += text.len() as u32;
                }
            };
            let (first, second, third) = JsRopeString::fibers(&rope);
            place(first);
            place(second);
            if let Some(third) = third {
                place(third);
            }
            (rope, at) = match count {
                0 => loop {
                    match pending.pop() {
                        Some(Task::Write { rope, at }) => break (rope, at),
                        Some(Task::Repeat { from, to, length }) => {
                            target
                                .copy_within(from as usize..(from + length) as usize, to as usize);
                        }
                        None => return,
                    }
                },
                1 => nested[0],
                _ => pending.put_off(&mut nested[..count]),
            };
        }
    }

    pub(super) fn characters(&self) -> Result<StringRef, AllocError> {
        if let Some((base, start)) = self.as_substring() {
            let range = start as usize..(start + self.rope_length()) as usize;
            return Ok(StringRef::substring(
                base.try_impl().expect("no rope"),
                range,
            ));
        }
        let length = self.rope_length() as usize;
        if self.is_latin1() {
            StringRef::try_write::<u8>(length, |cursor| self.write_to(cursor))
        } else {
            StringRef::try_write::<u16>(length, |cursor| self.write_to(cursor))
        }
    }

    /// `string` has the characters. May collect.
    #[inline(always)]
    pub(super) fn become_flat(&self, vm: &Vm, string: StringRef) {
        let cost = string.take_cost();
        self.set_characters(string);
        vm.heap.report_extra_memory_allocated(self, cost);
    }

    #[inline(never)]
    pub(super) fn flatten(&self, vm: &Vm) -> Result<(), AllocError> {
        self.become_flat(vm, self.characters()?);
        Ok(())
    }

    #[inline(never)]
    pub(super) fn flatten_without_collecting(&self) -> Result<(), AllocError> {
        let string = self.characters()?;
        (self.heap()).note_extra_memory_allocated(self, string.take_cost());
        self.set_characters(string);
        Ok(())
    }
}

/// None of these changes the string, or allocates in the heap unless it gets the `Cx`.
impl JsString {
    /// Writes all of `target`. Panics unless it is as long as the string. Of a unit that is too wide, the low byte is
    /// kept.
    #[inline(always)]
    pub fn copy_to<T: CodeUnit>(&self, target: &mut [MaybeUninit<T>]) {
        match self.try_view() {
            Some(view) => view.text().copy_to(target),
            None => self.as_rope().expect("a rope").copy_fibers_to(target),
        }
    }

    /// Of a unit that is too wide, the low byte is kept.
    #[inline(always)]
    pub fn write_to<T: CodeUnit>(&self, cursor: &mut Cursor<'_, T>) {
        // SAFETY: all of it is written.
        self.copy_to(unsafe { cursor.take_uninit(self.len() as usize) });
    }

    #[inline(always)]
    pub fn append_to(&self, builder: &mut StringBuilder) {
        match self.try_view() {
            Some(view) => builder.push_text(view.text()),
            None => self.append_fibers_to(builder),
        }
    }

    #[inline(never)]
    fn append_fibers_to(&self, builder: &mut StringBuilder) {
        let length = self.len() as usize;
        if self.is_latin1() && builder.is_latin1() {
            builder.write_latin1(length, |cursor| self.write_to(cursor));
        } else {
            builder.write_utf16(length, |cursor| self.write_to(cursor));
        }
    }

    /// Empty if there is no memory.
    pub fn to_string_without_resolving(&self) -> StringRef {
        match self.as_rope() {
            Some(rope) => rope.characters().unwrap_or_default(),
            None => self.try_impl().map_or_default(StringRef::retain),
        }
    }

    /// Lends the characters of `parts`, one after the other. Panics if there are more than `CAPACITY`.
    #[inline(always)]
    pub(super) fn with_copy_on_stack<const CAPACITY: usize, R>(
        parts: &[Gc<JsString>],
        read: impl FnOnce(Text<'_>) -> R,
    ) -> R {
        #[inline(always)]
        fn copy<'a, T: CodeUnit>(
            parts: &[Gc<JsString>],
            buffer: &'a mut [MaybeUninit<T>],
        ) -> Text<'a> {
            T::text(Cursor::fill_uninit(buffer, |cursor| {
                parts.iter().for_each(|part| part.write_to(cursor));
            }))
        }
        let mut narrow = [const { MaybeUninit::<u8>::uninit() }; CAPACITY];
        let mut wide = [const { MaybeUninit::<u16>::uninit() }; CAPACITY];
        read(if parts.iter().all(|part| part.is_latin1()) {
            copy(parts, &mut narrow)
        } else {
            copy(parts, &mut wide)
        })
    }

    /// For characters that are looked at once: only a long concatenation is put together for good.
    #[inline(always)]
    pub fn with_text<R>(&self, cx: &Cx, read: impl FnOnce(Text<'_>) -> R) -> JsResult<R> {
        const MAX_COPIED_LENGTH: usize = 64;
        if self.is_concatenation() && self.len() as usize <= MAX_COPIED_LENGTH {
            let parts = [self.into()];
            return Ok(Self::with_copy_on_stack::<MAX_COPIED_LENGTH, R>(
                &parts, read,
            ));
        }
        Ok(read(self.view(cx)?.text()))
    }
}
