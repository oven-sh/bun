//! `JSON.stringify`.

mod options;
mod plan;
mod primitives;
mod quick;
mod steps;

use core::cell::Cell;
use core::mem::MaybeUninit;

use bun_engine_text::{CodeUnit, Identifier, StringBuilder, StringRef};
use smallvec::SmallVec;

use crate::heap::RootStack;
use crate::{Cx, FastHashSet, Gc, JsObject, JsResult, JsString, Properties, Shape, Value};
use options::{Gap, Replacer};
pub(crate) use plan::Plan;
use quick::Stop;

const MAX_DEPTH: usize = 40_000;
const BYTES_ON_STACK: usize = 2048;

/// `None` stands for `undefined`.
pub fn stringify(
    cx: &mut Cx,
    value: Value,
    replacer: Value,
    space: Value,
) -> JsResult<Option<StringRef>> {
    text_of(cx, value, replacer, space)
}

#[inline(always)]
fn text_of(
    cx: &mut Cx,
    value: Value,
    replacer: Value,
    space: Value,
) -> JsResult<Option<StringRef>> {
    if replacer.is_cell() || !space.is_undefined() {
        return stringify_with_options(cx, value, replacer, space);
    }
    write_in_likely_width::<false>(cx, value, &Replacer::None, None)
}

#[inline(never)]
fn stringify_with_options(
    cx: &mut Cx,
    value: Value,
    replacer: Value,
    space: Value,
) -> JsResult<Option<StringRef>> {
    let replacer = Replacer::new(cx, replacer)?;
    match &Gap::new(cx, space)? {
        Some(gap) if !gap.is_latin1() => write::<u16, true>(cx, value, &replacer, Some(gap)),
        Some(gap) => write_in_likely_width::<true>(cx, value, &replacer, Some(gap)),
        None => write_in_likely_width::<false>(cx, value, &replacer, None),
    }
}

#[inline(always)]
fn write_in_likely_width<const HAS_GAP: bool>(
    cx: &mut Cx,
    value: Value,
    replacer: &Replacer,
    gap: Option<&Gap>,
) -> JsResult<Option<StringRef>> {
    let may_be_wide = value
        .as_cell()
        .is_some_and(|cell| match cell.downcast::<JsString>() {
            Some(string) => !string.is_latin1() && (string.len() as usize) < BYTES_ON_STACK / 2,
            None => Plan::of(&cell.shape()).is_some_and(|plan| plan.was_wide.get()),
        });
    if may_be_wide {
        write::<u16, HAS_GAP>(cx, value, replacer, gap)
    } else {
        write::<u8, HAS_GAP>(cx, value, replacer, gap)
    }
}

/// It begins with units of type `T`, which the gap fits in.
#[inline(never)]
fn write<T: CodeUnit, const HAS_GAP: bool>(
    cx: &mut Cx,
    value: Value,
    replacer: &Replacer,
    gap: Option<&Gap>,
) -> JsResult<Option<StringRef>> {
    let mut first_holders = [const { MaybeUninit::uninit() }; 16];
    let mut holders = RootStack::new(&mut first_holders);
    StringBuilder::on_stack::<BYTES_ON_STACK, _>(|out| {
        if !T::IS_LATIN1 {
            out.widen(0);
        }
        let stop = quick::begin::<T, HAS_GAP>(cx, out, value, replacer, gap, &mut holders);
        if !matches!(stop, Stop::Done) {
            let mut writer = Writer {
                replacer,
                gap,
                holders: &mut holders,
                settled: Settled::default(),
            };
            if !writer.go_on(cx, out, stop)? {
                return Ok(None);
            }
            if T::IS_LATIN1 && !out.is_latin1() {
                note_width(value, true);
            }
        }
        if !T::IS_LATIN1 && out.narrow_if_possible() {
            note_width(value, false);
        }
        cx.or_out_of_memory(out.take()).map(Some)
    })
}

#[inline(never)]
fn note_width(value: Value, is_wide: bool) {
    if let Some(shape) = value.as_cell().map(|cell| cell.shape())
        && let Some(plan) = Plan::of(&shape)
    {
        plan.was_wide.set(is_wide);
    }
}

/// The same for a script.
pub fn stringify_to_value(
    cx: &mut Cx,
    value: Value,
    replacer: Value,
    space: Value,
) -> JsResult<Value> {
    if value.is_cell() || replacer.is_cell() || space.is_cell() {
        let text = text_of(cx, value, replacer, space)?;
        return Ok(text.map_or_default(|text| JsString::new(cx, text).into()));
    }
    if value.is_undefined() {
        return Ok(value);
    }
    let is_finite = value.as_double().is_none_or(f64::is_finite);
    let value = if is_finite { value } else { Value::NULL };
    value.primitive_to_string(cx).map(Into::into)
}

/// Of the last texts that took memory from the allocator. The next one is likely to be like one of them.
#[derive(Default)]
pub(super) struct RecentLengths([Cell<usize>; 2]);

impl RecentLengths {
    fn add(&self, length: usize) {
        self.0[1].set(self.0[0].replace(length));
    }

    /// For so many more units at least, if that is possible.
    #[inline(never)]
    fn make_room(&self, out: &mut StringBuilder, required: usize) {
        /// So what a wrong guess wastes is in proportion to what has been written.
        const MAX_GROWTH: usize = 16;
        /// Where the lengths agree, and it is no short text.
        const MAX_SAFE_GUESS: usize = 32 << 20;
        if required <= out.spare() {
            return;
        }
        let (least, capacity) = (out.len() + required, out.capacity());
        let [last, other] = self.0.each_ref().map(Cell::get);
        let guess = [last, other].into_iter().filter(|&it| it > out.len()).min();
        let wanted = match guess.map(|it| it + it / 8 + 256) {
            Some(guess) if last.abs_diff(other) < last / 8 && capacity > BYTES_ON_STACK => {
                guess.min(MAX_SAFE_GUESS.max(MAX_GROWTH * capacity))
            }
            Some(guess) => guess.min(MAX_GROWTH * capacity),
            None => 2 * capacity,
        };
        out.reserve_if_possible(wanted.max(least) - out.len());
    }
}

/// An object or an array whose members are being written.
#[derive(Clone, Copy)]
struct Holder {
    object: Gc<JsObject>,
    /// What it had at the start, once it is settled.
    shape: Option<Gc<Shape>>,
    next: u32,
    /// Of an array.
    length: u32,
    members: Members,
    /// What comes before the next member: the opening bracket or a comma.
    separator: u8,
}

impl Holder {
    #[inline(always)]
    fn of_array(object: Gc<JsObject>, length: u32) -> Holder {
        Holder {
            length,
            separator: b'[',
            ..Holder::new(object, Members::Elements)
        }
    }

    #[inline(always)]
    fn new(object: Gc<JsObject>, members: Members) -> Holder {
        Holder {
            object,
            shape: None,
            next: 0,
            length: 0,
            members,
            separator: b'{',
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Members {
    Elements,
    /// Those of the plan of the shape.
    Planned,
    /// Those of the replacer.
    Listed,
    /// The entries of the table of the shape. From here on, a holder that is settled has `Keys`.
    Stored,
    /// What is stored follows.
    Indexed,
    Named,
}

enum Keys {
    Stored(Properties),
    Indexed(Vec<u32>, Properties),
    Named(Vec<Identifier>),
}

/// A holder is settled before a script can run, the heap can change or an error is thrown: it is known not to be inside
/// itself, and its keys are safe.
#[derive(Default)]
struct Settled {
    /// So many holders from the outermost one are.
    count: usize,
    /// So many of them a script may have changed since they were opened.
    exposed: usize,
    keys: SmallVec<[Keys; 4]>,
    /// The addresses of those from `Settled::SEARCHED` on.
    objects: FastHashSet<usize>,
}

struct Writer<'a, 'h> {
    replacer: &'a Replacer,
    gap: Option<&'a Gap>,
    holders: &'a mut RootStack<'h, Holder>,
    settled: Settled,
}

impl Writer<'_, '_> {
    /// False if there is no text for the outermost value.
    #[inline(never)]
    fn go_on(&mut self, cx: &mut Cx, out: &mut StringBuilder, mut stop: Stop) -> JsResult<bool> {
        /// If it has not got as far as that the quick way, it has not been worth the try.
        const LITTLE: usize = 32;
        const MAX_STEPS: usize = 16;
        /// It takes about as long to write so many units as to settle a holder.
        const UNITS_PER_HOLDER: usize = 64;
        let (mut steps, mut length, mut length_when_settled) = (1, 0, 0);
        let mut is_width_a_guess = !out.is_latin1() && self.gap.is_none_or(Gap::is_latin1);
        loop {
            if is_width_a_guess
                && (out.len() > BYTES_ON_STACK / 4 || matches!(stop, Stop::String(_)))
            {
                is_width_a_guess = false;
                out.narrow_if_possible();
            }
            // Or else a cycle that takes much text might be gone through many times.
            let unsettled = self.holders.len() - self.settled.count;
            if out.len() - length_when_settled >= UNITS_PER_HOLDER * unsettled {
                length_when_settled = out.len();
                self.settle(cx)?;
            }
            match stop {
                Stop::Done => break,
                Stop::Outermost(value) => {
                    if !self.begin(cx, out, value)? {
                        return Ok(false);
                    }
                }
                Stop::Depth if self.holders.len() < MAX_DEPTH => {}
                Stop::Pause => self.settle(cx)?,
                Stop::Room(required) => {
                    (cx.services.text.json.recent_lengths).make_room(out, required);
                    if required > out.spare().min(quick::WINDOW) {
                        self.step(cx, out, 1)?;
                    }
                }
                Stop::String(string) => self.write_string(cx, out, &string)?,
                _ => {
                    let got_far = out.len() - length >= LITTLE;
                    steps = if got_far { 1 } else { MAX_STEPS.min(2 * steps) };
                    self.step(cx, out, steps)?;
                }
            }
            if out.has_overflowed() {
                self.settle(cx)?;
                break;
            }
            if cx.traps().need_handling() {
                self.expose(cx)?;
                cx.check_traps()?;
            }
            length = out.len();
            stop = self.write_quickly(cx, out);
        }
        if out.len() > BYTES_ON_STACK {
            cx.services.text.json.recent_lengths.add(out.len());
        }
        Ok(true)
    }

    #[inline(never)]
    fn write_string(
        &mut self,
        cx: &Cx,
        out: &mut StringBuilder,
        string: &JsString,
    ) -> JsResult<()> {
        if string.is_concatenation() {
            self.settle(cx)?;
        }
        let (view, length) = (string.view(cx)?, string.len() as usize);
        if !out.is_latin1() || view.text().is_latin1() {
            (cx.services.text.json.recent_lengths).make_room(out, length + length / 8 + 256);
        } else if length < BYTES_ON_STACK && !view.text().fits_latin1() {
            out.widen(length + 2);
        }
        out.push_json_quoted(view.text());
        Ok(())
    }
}
