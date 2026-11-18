//! As far as it goes without a script and without the heap: straight from shapes, slots and elements.

use core::hint::{black_box, cold_path};
use core::ops::Range;
use core::slice::Iter;

use bun_engine_number::push_i32;
use bun_engine_text::{CodeUnit, Cursor, StringBuilder};

use super::options::{Gap, Replacer};
use super::plan::{Member, Plan, lacks_to_json};
use super::primitives::{
    Kind, VALUE_ROOM, push_date, push_literal, push_null, try_push_key, try_push_string,
    write_number, write_number_apart,
};
use super::steps::has_ordinary_properties;
use super::{Holder, Keys, MAX_DEPTH, Members, Settled, Writer};
use crate::heap::RootStack;
use crate::heap::stack::stack_pointer;
use crate::{
    CellType, Cx, DateInstance, ElementKind, Gc, JsCell, JsObject, JsString, NoGc, PropertyEntry,
    Traps, Value,
};

/// After so many units it is time to look for traps. What takes time without writing much looks for itself.
pub(super) const WINDOW: usize = 1 << 18;
const PREFETCH_DISTANCE: isize = 768;
/// For a separator, a key of a plan and a value that is no string.
const ROOM: usize = 1 + Member::KEY_CAPACITY + VALUE_ROOM;

#[derive(Clone, Copy)]
pub(super) enum Stop {
    Done,
    /// Nothing has been done about it.
    Outermost(Value),
    /// The next member is for `Writer::step`.
    Step,
    /// It may take so much.
    Room(usize),
    /// It leads further down.
    Depth,
    /// Much time has gone by without much text.
    Pause,
    /// The value of the last member is yet to be written.
    String(Gc<JsString>),
}

/// What holds while nothing else runs.
#[derive(Clone, Copy)]
struct Facts<'a> {
    no_gc: &'a NoGc<'a>,
    traps: &'a Traps,
    epoch: u64,
    /// What a plan has to have to be followed.
    complete_epoch: u64,
    has_list: bool,
}

/// What to do with a cell that has no complete plan.
enum Verdict {
    Omit,
    Step,
    WriteDate,
    Open(Members),
}

impl<'a> Facts<'a> {
    /// `None` if each value goes through the replacer.
    #[inline(always)]
    fn new(
        epoch: u64,
        replacer: &Replacer,
        (no_gc, traps): &'a (NoGc<'a>, &'a Traps),
    ) -> Option<Facts<'a>> {
        let has_list = match replacer {
            Replacer::None => false,
            Replacer::List(_) => true,
            Replacer::Function(_) => return None,
        };
        Some(Facts {
            no_gc,
            traps,
            epoch,
            complete_epoch: if has_list { u64::MAX } else { epoch } | Plan::IS_COMPLETE,
            has_list,
        })
    }

    #[inline(always)]
    fn members_of(&self, object: &JsObject) -> &'a [Member] {
        Plan::for_cell(object, self.no_gc).map_or_default(Plan::members)
    }

    #[inline(always)]
    fn complete_plan(&self, cell: &JsCell) -> Option<&'a Plan> {
        Plan::for_cell(cell, self.no_gc).filter(|plan| plan.epoch() == self.complete_epoch)
    }

    #[inline(never)]
    extern "rust-cold" fn can_pass_over_hole(&self, array: &JsObject) -> bool {
        !self.traps.need_handling() && !array.holes_must_forward_to_prototype()
    }

    #[inline(never)]
    extern "rust-cold" fn look_at(&self, cell: Gc<JsCell>) -> Verdict {
        let Some(object) = cell.as_object() else {
            return if cell.is_symbol() {
                Verdict::Omit
            } else {
                Verdict::Step
            };
        };
        let (shape, lacks_to_json) = (cell.shape(), || lacks_to_json(&object, self.epoch));
        match cell.cell_type() {
            _ if self.traps.need_handling() => Verdict::Step,
            CellType::FinalObject
            | CellType::Map
            | CellType::Set
            | CellType::WeakMap
            | CellType::WeakSet
            | CellType::Promise
                if !self.has_list
                    && !cell.indexing_mode().has_elements()
                    && has_ordinary_properties(&object)
                    && lacks_to_json() =>
            {
                let plan = Plan::ensure_with_members(&shape);
                Verdict::Open(plan.map_or(Members::Stored, |plan| {
                    plan.complete(self.epoch);
                    Members::Planned
                }))
            }
            CellType::Array if lacks_to_json() => {
                if let Some(plan) = Plan::ensure(&shape) {
                    plan.complete(self.epoch);
                }
                Verdict::Open(Members::Elements)
            }
            CellType::Function if lacks_to_json() => Verdict::Omit,
            CellType::Date
                if (cell.downcast::<DateInstance>())
                    .is_some_and(|it| it.is_known_to_have_pristine_conversions()) =>
            {
                Verdict::WriteDate
            }
            _ => Verdict::Step,
        }
    }
}

/// `out` is empty and has units of type `T`.
#[inline(always)]
pub(super) fn begin<T: CodeUnit, const HAS_GAP: bool>(
    cx: &mut Cx,
    out: &mut StringBuilder,
    value: Value,
    replacer: &Replacer,
    gap: Option<&Gap>,
    holders: &mut RootStack<'_, Holder>,
) -> Stop {
    let (epoch, no_gc) = (cx.full_prototype_chain_epoch(), cx.no_gc_with_traps());
    let mut stop = Stop::Outermost(value);
    if let Some(cell) = value.as_cell()
        && let Some(facts) = Facts::new(epoch, replacer, &no_gc)
    {
        Run::<T, HAS_GAP>::in_window(
            facts,
            gap,
            (holders, None),
            usize::MAX,
            out,
            #[inline(always)]
            |run, to| {
                let after;
                (after, stop) = run.write_outermost(to, cell);
                after
            },
        );
    }
    stop
}

impl Writer<'_, '_> {
    /// Leaves the holders as they are where it stops.
    #[inline(always)]
    pub(super) fn write_quickly(&mut self, cx: &mut Cx, out: &mut StringBuilder) -> Stop {
        if self.holders.is_empty() {
            return Stop::Done;
        }
        let limit = cx.soft_stack_limit();
        let (epoch, no_gc) = (cx.full_prototype_chain_epoch(), cx.no_gc_with_traps());
        let Some(facts) = Facts::new(epoch, self.replacer, &no_gc) else {
            return Stop::Step;
        };
        if !self.settled.can_resume(self.holders) {
            return Stop::Step;
        }
        match (out.is_latin1(), self.gap.is_some()) {
            (true, false) => self.write_in_window::<u8, false>(facts, limit, out),
            (false, false) => self.write_in_window::<u16, false>(facts, limit, out),
            (true, true) => self.write_in_window::<u8, true>(facts, limit, out),
            (false, true) => self.write_in_window::<u16, true>(facts, limit, out),
        }
    }

    #[inline(never)]
    fn write_in_window<T: CodeUnit, const HAS_GAP: bool>(
        &mut self,
        facts: Facts<'_>,
        stack_limit: usize,
        out: &mut StringBuilder,
    ) -> Stop {
        let mut stop = Stop::Step;
        Run::<T, HAS_GAP>::in_window(
            facts,
            self.gap,
            (self.holders, Some(&mut self.settled)),
            stack_limit,
            out,
            |run, to| {
                let after;
                (after, stop) = run.write_holders(to);
                after
            },
        );
        stop
    }
}

impl Settled {
    /// Whether the members of the innermost holder are plain, and where they were at the start.
    #[inline(always)]
    fn can_resume(&mut self, holders: &[Holder]) -> bool {
        holders.len() > self.count || self.try_unsettle(holders)
    }

    #[inline(never)]
    fn try_unsettle(&mut self, holders: &[Holder]) -> bool {
        let Some((holder, around)) = holders.split_last() else {
            return false;
        };
        let (object, shape) = (holder.object, holder.object.shape());
        let is_as_it_was = match holder.members {
            Members::Elements => {
                object.cell_type() == CellType::Array
                    && object.element_kind().is_dense()
                    && object.public_length() >= holder.length
            }
            Members::Planned => holder.shape == Some(shape),
            Members::Stored => match self.keys.last() {
                Some(Keys::Stored(it) | Keys::Indexed(_, it)) => it.are_those_of(&shape),
                _ => false,
            },
            _ => false,
        };
        if is_as_it_was {
            self.remove(holder, around.len());
        }
        is_as_it_was
    }
}

/// An object or array is written by a call, which returns the cursor unless it stops. Then each call on the way back
/// leaves a holder.
#[repr(C)]
struct Run<'a, 'h, 'c, T, const HAS_GAP: bool> {
    /// At the address of the whole, which is at hand.
    facts: Facts<'a>,
    gap: Option<&'a Gap>,
    holders: &'a mut RootStack<'h, Holder>,
    settled: Option<&'a mut Settled>,
    /// To enter one of them again need not lead round in a circle.
    has_exposed_holders: bool,
    max_depth: usize,
    /// From the innermost call down to there.
    levels_left: usize,
    /// For calls beyond `Run::MAX_CALLS`.
    stack_limit: usize,
    omissions_left: usize,
    stop: Stop,
    stopped_at: Option<Cursor<'c, T>>,
}

/// Out of the loop of `for_each`, with the number of members to pass over.
macro_rules! stop {
    ($run:ident, $stop:expr, $passed:literal) => {{
        cold_path();
        $run.stop = $stop;
        break $passed;
    }};
    ($run:ident, $stop:expr, $to:ident back to $start:ident) => {{
        $to.rewind($start);
        stop!($run, $stop, 0)
    }};
}

/// There is room for a number. The member began at `$start`.
macro_rules! write_value {
    (
        $run:ident, $to:ident, $separator:ident, $start:ident, $slot:expr, $leave:ident, $write_planned:expr,
        if empty $empty:block, if omitted $omit:block
    ) => {{
        macro_rules! descend {
            ($cell:ident, $members:expr, |$inner:ident, $object:ident| $write:expr) => {{
                // SAFETY: only the shapes of objects have complete plans, and only objects are to be opened.
                let $object = unsafe { $cell.cast_unchecked::<JsObject>() };
                if $run.has_exposed_holders && $run.is_settled($object) {
                    stop!($run, Stop::Step, $to back to $start)
                }
                let result = if let Some(levels_left) = $run.levels_left.checked_sub(1) {
                    $run.levels_left = levels_left;
                    let result = $to.hand_on(
                        #[inline(always)]
                        |$inner| $write,
                    );
                    $run.levels_left += 1;
                    result
                } else if $run.can_go_deeper() {
                    $to.hand_on(|to| $run.write_deeper(to, $object, $members))
                } else {
                    stop!($run, Stop::Depth, $to back to $start)
                };
                let Some(after) = result else {
                    return $leave!(1, b',');
                };
                $to = after;
            }};
        }
        match Kind::of($slot) {
            Kind::Integer(integer) => push_i32(integer, &mut $to),
            Kind::Double(number) => $to.push_written(|out| write_number_apart(number, out)),
            Kind::Cell(cell) => {
                if let Some(string) = cell.downcast::<JsString>() {
                    if !try_push_string(string, $run.facts.no_gc, &mut $to) {
                        $separator = b',';
                        stop!($run, Stop::String(string), 1)
                    }
                } else if let Some(plan) = $run.facts.complete_plan(&cell) {
                    descend!(cell, plan.kind(), |to, object| match plan.known_members() {
                        Some(all) => ($write_planned)(&mut *$run, to, object, all.iter()),
                        None => $run.write_array(to, object),
                    });
                } else {
                    cold_path();
                    match $run.facts.look_at(cell) {
                        Verdict::Omit => $omit,
                        Verdict::WriteDate => $to.apart(|to| push_date(cell, to)),
                        Verdict::Open(members) => {
                            descend!(cell, members, |to, object| $run.write_new(to, object, members))
                        }
                        Verdict::Step => stop!($run, Stop::Step, $to back to $start),
                    }
                }
            }
            Kind::Other(Some(Value::UNDEFINED)) => $omit,
            Kind::Other(Some(literal)) => push_literal(literal, &mut $to),
            Kind::Other(None) => $empty,
        }
    }};
}

/// `$write` is done for each of `$rest`, with room for a member of a plan. Then the end is written.
macro_rules! for_each {
    (
        $run:ident, $to:ident, $object:ident, $members:ident, $rest:ident, $separator:ident, $closer:literal,
        |$member:ident, $start_line:ident, $leave:ident| $write:block $(, then |$room:ident| $then:block)?
    ) => {{
        let end = $rest.as_slice().as_ptr_range().end;
        let gap = $run.gap.filter(|_| HAS_GAP);
        let line = gap.map_or(0, |it| it.line_length($run.depth() + 1));
        let room = ROOM + if HAS_GAP { Gap::room_for(line) } else { 0 };
        macro_rules! $start_line {
            () => {{
                $to.prefetch(PREFETCH_DISTANCE);
                $to.push($separator.into());
                if let Some(gap) = gap {
                    gap.start_line(line, &mut $to);
                }
            }};
        }
        macro_rules! $leave {
            ($passed:expr, $next_separator:expr) => {{
                let rest = $rest.as_slice().as_ptr().cast()..end.cast();
                $run.leave($object, Members::$members, rest, ($passed, $next_separator))
            }};
        }
        let passed = loop {
            if !$to.has_room(room) {
                stop!($run, Stop::Room(room), 0)
            }
            let Some($member) = $rest.as_slice().first() else {
                if $separator != b',' {
                    cold_path();
                    $to.push($separator.into());
                } else if let Some(gap) = gap {
                    gap.start_line(gap.line_length($run.depth()), &mut $to);
                }
                $to.push($closer.into());
                $(
                    let $room = room;
                    $then
                )?
                return Some($to);
            };
            $write
            $separator = b',';
            $rest.next();
        };
        $run.stopped_at = Some($to);
        $leave!(passed, $separator)
    }};
}

/// The compiler is not to see that nothing has changed, or else it makes this the inner of two loops.
macro_rules! omit {
    ($run:ident, $to:ident back to $start:ident, $separator:ident, $rest:ident) => {{
        $run.omissions_left -= 1;
        if $run.omissions_left == 0 {
            stop!($run, Stop::Pause, $to back to $start)
        }
        $to.rewind(black_box($start));
        $separator = black_box($separator);
        $rest.next();
        continue;
    }};
}

macro_rules! write_hole {
    ($run:ident, $to:ident, $array:ident, $start:ident) => {{
        cold_path();
        if !$run.facts.can_pass_over_hole(&$array) {
            stop!($run, Stop::Step, $to back to $start)
        }
        push_null(&mut $to);
    }};
}

impl<'a, 'h, 'c, T: CodeUnit, const HAS_GAP: bool> Run<'a, 'h, 'c, T, HAS_GAP> {
    /// Without a look at the stack.
    const MAX_CALLS: usize = 32;

    #[inline(always)]
    fn in_window(
        facts: Facts<'a>,
        gap: Option<&'a Gap>,
        (holders, settled): (&'a mut RootStack<'h, Holder>, Option<&'a mut Settled>),
        stack_limit: usize,
        out: &mut StringBuilder,
        write: impl for<'d> FnOnce(&mut Run<'a, 'h, 'd, T, HAS_GAP>, Cursor<'d, T>) -> Cursor<'d, T>,
    ) {
        out.write_in_room::<T>(
            out.spare().min(WINDOW),
            #[inline(always)]
            |to| {
                to.by_value(
                    #[inline(always)]
                    |to| {
                        let mut run = Run {
                            facts,
                            gap,
                            holders,
                            settled,
                            has_exposed_holders: false,
                            max_depth: Self::MAX_CALLS,
                            levels_left: Self::MAX_CALLS,
                            stack_limit,
                            omissions_left: WINDOW,
                            stop: Stop::Step,
                            stopped_at: None,
                        };
                        write(&mut run, to)
                    },
                );
            },
        );
    }

    #[inline(always)]
    fn depth(&self) -> usize {
        self.max_depth - self.levels_left
    }

    #[inline(never)]
    extern "rust-cold" fn is_settled(&self, object: Gc<JsObject>) -> bool {
        (self.settled.as_ref()).is_some_and(|it| it.contains(self.holders, object))
    }

    #[cold]
    #[inline(never)]
    extern "rust-cold" fn can_go_deeper(&self) -> bool {
        stack_pointer() > self.stack_limit && self.max_depth + Self::MAX_CALLS < MAX_DEPTH
    }

    #[inline(never)]
    extern "rust-preserve-none" fn write_deeper(
        &mut self,
        to: Cursor<'c, T>,
        object: Gc<JsObject>,
        members: Members,
    ) -> Option<Cursor<'c, T>> {
        self.max_depth += Self::MAX_CALLS;
        self.levels_left = Self::MAX_CALLS - 1;
        let result = self.write_new(to, object, members);
        self.max_depth -= Self::MAX_CALLS;
        self.levels_left = 0;
        result
    }

    /// `rest` has the addresses of the members that are left, of which some are to be passed over. The innermost call
    /// comes first.
    #[cold]
    #[inline(never)]
    fn leave(
        &mut self,
        object: Gc<JsObject>,
        members: Members,
        rest: Range<*const ()>,
        (passed, separator): (u32, u8),
    ) -> Option<Cursor<'c, T>> {
        let (all, size) = match members {
            Members::Planned => (self.facts.members_of(&object).len(), size_of::<Member>()),
            Members::Stored => {
                let entries = object.shape().entries(self.facts.no_gc);
                (entries.len(), size_of::<PropertyEntry>())
            }
            _ => {
                let bytes = rest.end.addr() - object.storage().address();
                (bytes / size_of::<Value>(), size_of::<Value>())
            }
        };
        let holder = Holder {
            next: (all - (rest.end.addr() - rest.start.addr()) / size) as u32 + passed,
            length: all as u32,
            separator,
            ..Holder::new(object, members)
        };
        let depth = self.depth();
        while self.holders.len() <= depth {
            self.holders.push(holder);
        }
        self.holders[depth] = holder;
        None
    }

    /// The calls have left holders from that depth on. A path that goes round in a circle has the same object at some
    /// depth and at half of it.
    #[inline(never)]
    fn did_stop(&mut self, from: usize) -> (Cursor<'c, T>, Stop) {
        let to = self.stopped_at.take().expect("where it has stopped");
        let has_cycle = (from.max(1)..self.holders.len())
            .any(|depth| self.holders[depth].object == self.holders[depth / 2].object);
        (to, if has_cycle { Stop::Step } else { self.stop })
    }

    #[inline(always)]
    fn write_outermost(
        &mut self,
        mut to: Cursor<'c, T>,
        cell: Gc<JsCell>,
    ) -> (Cursor<'c, T>, Stop) {
        let Some(object) = cell.as_object() else {
            let stop = match cell.downcast::<JsString>() {
                Some(string) if try_push_string(string, self.facts.no_gc, &mut to) => Stop::Done,
                Some(string) => Stop::String(string),
                None => Stop::Outermost(cell.into()),
            };
            return (to, stop);
        };
        let after = match self.facts.complete_plan(&cell).map(Plan::known_members) {
            Some(Some(all)) => self.write_planned(to, object, all.iter(), b'{', None),
            Some(None) => self.write_array(to, object),
            None => match self.facts.look_at(cell) {
                Verdict::Open(members) => self.write_new(to, object, members),
                Verdict::WriteDate => {
                    to.apart(|to| push_date(cell, to));
                    Some(to)
                }
                _ => return (to, Stop::Outermost(cell.into())),
            },
        };
        match after {
            Some(after) => (after, Stop::Done),
            None => self.did_stop(0),
        }
    }

    #[inline(always)]
    fn write_holders(&mut self, mut to: Cursor<'c, T>) -> (Cursor<'c, T>, Stop) {
        loop {
            if self.holders.is_empty() {
                return (to, Stop::Done);
            }
            if let Some(settled) = &mut self.settled {
                if !settled.can_resume(self.holders) {
                    return (to, Stop::Step);
                }
                self.has_exposed_holders = settled.exposed != 0;
            }
            let holder = self.holders.pop().expect("not empty");
            let depth = self.holders.len();
            self.max_depth = (depth + Self::MAX_CALLS).min(MAX_DEPTH - 1);
            self.levels_left = self.max_depth - depth;
            match self.write_holder(to, &holder) {
                Some(after) => to = after,
                None => return self.did_stop(depth),
            }
        }
    }

    #[inline(always)]
    fn write_holder(&mut self, to: Cursor<'c, T>, holder: &Holder) -> Option<Cursor<'c, T>> {
        let (object, separator) = (holder.object, holder.separator);
        let (next, length) = (holder.next as usize, holder.length as usize);
        match holder.members {
            Members::Planned => {
                let rest = self.facts.members_of(&object)[next..].iter();
                self.write_planned(to, object, rest, separator, None)
            }
            Members::Elements => match object.contiguous_elements(self.facts.no_gc) {
                Some(all) => self.write_values(to, object, all[next..length].iter(), separator),
                None => self.write_numbers(to, object, next..length, separator),
            },
            _ => {
                let rest = object.shape().entries(self.facts.no_gc)[next..].iter();
                self.write_stored(to, object, rest, separator)
            }
        }
    }

    #[inline(never)]
    extern "rust-preserve-none" fn write_new(
        &mut self,
        to: Cursor<'c, T>,
        object: Gc<JsObject>,
        members: Members,
    ) -> Option<Cursor<'c, T>> {
        let holder = match members {
            Members::Elements => Holder::of_array(object, object.public_length()),
            _ => Holder::new(object, members),
        };
        self.write_holder(to, &holder)
    }

    #[inline(always)]
    fn write_array(&mut self, to: Cursor<'c, T>, array: Gc<JsObject>) -> Option<Cursor<'c, T>> {
        match array.contiguous_elements(self.facts.no_gc) {
            Some(all) => self.write_values(to, array, all.iter(), b'['),
            None => self.write_numbers(to, array, 0..array.public_length() as usize, b'['),
        }
    }

    #[inline(always)]
    fn write_alone(
        &mut self,
        to: Cursor<'c, T>,
        object: Gc<JsObject>,
        all: Iter<'a, Member>,
    ) -> Option<Cursor<'c, T>> {
        self.write_planned(to, object, all, b'{', None)
    }

    /// If it is new and the first of `siblings`, it goes on with those that are of the same shape.
    #[inline(never)]
    extern "rust-preserve-none" fn write_planned(
        &mut self,
        mut to: Cursor<'c, T>,
        mut object: Gc<JsObject>,
        mut rest: Iter<'a, Member>,
        mut separator: u8,
        mut siblings: Option<&mut Iter<'a, Option<Value>>>,
    ) -> Option<Cursor<'c, T>> {
        let all = rest.clone();
        for_each! {
            self, to, object, Planned, rest, separator, b'}',
            |member, start_line, leave| {
                let start = to.mark();
                start_line!();
                if !member.push_key(HAS_GAP, &mut to)
                    && !(to.apart(|to| try_push_key::<T, HAS_GAP>(member.name(), to)) && to.has_room(VALUE_ROOM))
                {
                    stop!(self, Stop::Step, to back to start)
                }
                // SAFETY: of the shape of the object.
                let slot = unsafe { member.value_in(&object) };
                write_value! {
                    self, to, separator, start, slot, leave, Self::write_alone,
                    if empty { stop!(self, Stop::Step, to back to start) },
                    if omitted { omit!(self, to back to start, separator, rest) }
                }
            },
            then |room| {
                if let Some(siblings) = &mut siblings
                    && let [_, next, ..] = *siblings.as_slice()
                    && let Kind::Cell(next) = Kind::of(next)
                    && next.shape_id() == object.shape_id()
                    && to.has_room(room)
                {
                    siblings.next();
                    to.push(b','.into());
                    if let Some(gap) = self.gap.filter(|_| HAS_GAP) {
                        gap.start_line(gap.line_length(self.depth()), &mut to);
                    }
                    // SAFETY: of the shape of an object.
                    object = unsafe { next.cast_unchecked() };
                    (rest, separator) = (all.clone(), b'{');
                    continue;
                }
            }
        }
    }

    #[inline(never)]
    extern "rust-preserve-none" fn write_stored(
        &mut self,
        mut to: Cursor<'c, T>,
        object: Gc<JsObject>,
        mut rest: Iter<'a, PropertyEntry>,
        mut separator: u8,
    ) -> Option<Cursor<'c, T>> {
        for_each! {
            self, to, object, Stored, rest, separator, b'}',
            |entry, start_line, leave| {
                let start = to.mark();
                let Some((name, offset)) = entry.as_enumerable_string() else {
                    omit!(self, to back to start, separator, rest)
                };
                let has_key = if HAS_GAP {
                    start_line!();
                    to.apart(|to| try_push_key::<T, true>(name, to))
                } else {
                    to.try_push_json_key(separator, name.text())
                };
                if !has_key || !to.has_room(VALUE_ROOM) {
                    stop!(self, Stop::Step, to back to start)
                }
                // SAFETY: as above.
                let slot = unsafe { object.slot_unchecked(offset) }.get();
                write_value! {
                    self, to, separator, start, slot, leave, Self::write_alone,
                    if empty { stop!(self, Stop::Step, to back to start) },
                    if omitted { omit!(self, to back to start, separator, rest) }
                }
            }
        }
    }

    #[inline(never)]
    extern "rust-preserve-none" fn write_values(
        &mut self,
        mut to: Cursor<'c, T>,
        array: Gc<JsObject>,
        mut rest: Iter<'a, Option<Value>>,
        mut separator: u8,
    ) -> Option<Cursor<'c, T>> {
        for_each! {
            self, to, array, Elements, rest, separator, b']',
            |slot, start_line, leave| {
                let start = to.mark();
                start_line!();
                let mut write_records = |run: &mut Self, to, object, all| {
                    let mut siblings = rest.clone();
                    let unchecked = (!run.has_exposed_holders).then_some(&mut siblings);
                    let result = run.write_planned(to, object, all, b'{', unchecked);
                    rest = siblings;
                    result
                };
                write_value! {
                    self, to, separator, start, *slot, leave, write_records,
                    if empty { write_hole!(self, to, array, start) },
                    if omitted { push_null(&mut to) }
                }
            }
        }
    }

    /// Unless the elements are not dense.
    #[inline(never)]
    extern "rust-preserve-none" fn write_numbers(
        &mut self,
        mut to: Cursor<'c, T>,
        array: Gc<JsObject>,
        range: Range<usize>,
        mut separator: u8,
    ) -> Option<Cursor<'c, T>> {
        let elements = array.elements(self.facts.no_gc);
        let Some(elements) = elements.filter(|_| array.element_kind().is_dense()) else {
            (self.stop, self.stopped_at) = (Stop::Step, Some(to));
            let address = |index| array.storage().elements_ptr().wrapping_add(index) as *const ();
            let rest = address(range.start)..address(range.end);
            return self.leave(array, Members::Elements, rest, (0, separator));
        };
        let mut rest = elements.words()[range].iter();
        macro_rules! write_words {
            (|$word:ident| $is_hole:expr, $write:expr) => {
                for_each! {
                    self, to, array, Elements, rest, separator, b']',
                    |$word, start_line, leave| {
                        let start = to.mark();
                        start_line!();
                        if $is_hole {
                            write_hole!(self, to, array, start);
                        } else {
                            $write;
                        }
                    }
                }
            };
        }
        if elements.kind() == ElementKind::Double {
            write_words!(
                |word| f64::from_bits(*word).is_nan(),
                to.push_written(|out| write_number(f64::from_bits(*word), out))
            )
        } else {
            write_words!(|word| *word == 0, push_i32(*word as i32, &mut to))
        }
    }
}
