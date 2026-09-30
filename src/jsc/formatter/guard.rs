//! The one gate every value passes on its way to a printer.
//!
//! [`Formatter::print_as`] calls [`Formatter::enter`], which hands back an
//! [`Entered`] token or prints a placeholder. Printers take the token, so no
//! printer runs on a value that skipped the stack check, the cycle check and
//! the shared-reference budget.

use super::*;
use core::cell::Cell;
use std::rc::Rc;

/// The text a printer emits. The walk, the guards and the classifier are the
/// same for both.
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Style {
    /// `console.log`, `Bun.inspect`, the error printer, matcher messages.
    Console,
    /// `bun:test` snapshots and both sides of an assertion diff.
    Jest,
}

/// What the walk knows about a value that can hold other values.
#[derive(Copy, Clone, Eq, PartialEq, Default)]
pub(super) enum Mark {
    /// An ancestor of the value being printed. Meeting it again is a cycle.
    #[default]
    OnPath,
    /// Printed in full earlier. Meeting it again is a shared reference.
    Printed,
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum PastBudget {
    /// Print `[Object ...]` in place of the value.
    Abbreviate,
    /// A stored snapshot cannot abbreviate.
    Throw,
}

/// A value reachable N ways prints N times, so a small graph of shared
/// references can print exponentially much. Only bytes printed while
/// repeating an already printed value count, so output that is linear in the
/// size of the value is never cut.
#[derive(Copy, Clone)]
pub(crate) struct SharedReferenceBudget {
    pub(crate) bytes: usize,
    pub(crate) past: PastBudget,
}

impl SharedReferenceBudget {
    /// Where `util.inspect` stops descending, though it counts all output.
    pub(crate) const CONSOLE: Self = Self {
        bytes: 1 << 27,
        past: PastBudget::Abbreviate,
    };
    /// The text of an error, which someone has to read, and a diff, which is
    /// compared line by line.
    pub(crate) const MESSAGE: Self = Self {
        bytes: 1024 * 1024,
        past: PastBudget::Abbreviate,
    };
    pub(crate) const SNAPSHOT: Self = Self {
        bytes: 64 * 1024 * 1024,
        past: PastBudget::Throw,
    };
}

/// Proof that a value passed [`Formatter::enter`]. To print the same value
/// under another tag, hand the token to [`Formatter::dispatch`]; going back
/// through `print_as` would report the value as its own ancestor.
pub(crate) struct Entered {
    marked: bool,
    repeat: bool,
    opens_repeat: bool,
    /// See [`Tag::is_on_the_path_of_a_stored_snapshot`].
    off_path: bool,
}

impl Entered {
    const LEAF: Self = Self {
        marked: false,
        repeat: false,
        opens_repeat: false,
        off_path: false,
    };
    const ON_PATH: Self = Self {
        marked: true,
        repeat: false,
        opens_repeat: false,
        off_path: false,
    };

    #[inline]
    pub(super) fn opens_repeat(&self) -> bool {
        self.opens_repeat
    }

    #[inline]
    pub(super) fn is_off_path(&self) -> bool {
        self.off_path
    }
}

/// Undoes [`Formatter::enter`] at scope exit. Holds raw pointers so the
/// printers can take `&mut self` while it is live (see [`Restore`]). The
/// caller takes them from its own `self`: taken from a `&mut` parameter, they
/// would be invalidated by the caller's next write to those fields.
pub(super) struct Leave {
    map: *mut visited::Map,
    repeat_depth: *mut u32,
    value: JSValue,
    marked: bool,
    repeat: bool,
}

impl Leave {
    #[inline]
    pub(super) fn new(
        map: *mut visited::Map,
        repeat_depth: *mut u32,
        entered: &Entered,
        value: JSValue,
    ) -> Self {
        Self {
            map,
            repeat_depth,
            value,
            marked: entered.marked,
            repeat: entered.repeat,
        }
    }
}

impl Drop for Leave {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: both pointers were taken from fields of a `Formatter` that
        // outlives this guard; no other borrow is live at drop.
        unsafe {
            if self.marked
                && let Some(mark) = (*self.map).get_mut(&self.value)
            {
                *mark = Mark::Printed;
            }
            if self.repeat {
                *self.repeat_depth -= 1;
            }
        }
    }
}

/// Counts what the outermost repeat visit and everything below it prints.
pub(super) struct CountingWriter<'w> {
    pub(super) inner: &'w mut dyn bun_io::Write,
    pub(super) written: Rc<Cell<usize>>,
}

impl bun_io::Write for CountingWriter<'_> {
    #[inline]
    fn write_all(&mut self, buf: &[u8]) -> bun_io::Result<()> {
        self.written
            .set(self.written.get().saturating_add(buf.len()));
        self.inner.write_all(buf)
    }
    #[inline]
    fn flush(&mut self) -> bun_io::Result<()> {
        self.inner.flush()
    }
}

impl Tag {
    /// Whether the printer for this tag can reach another JS value. No `_`
    /// arm: a new tag does not compile until someone decides.
    pub(crate) const fn holds_values(self, style: Style) -> bool {
        match self {
            // `[Name: message]` in a snapshot.
            Tag::Error => matches!(style, Style::Console),

            Tag::Array
            | Tag::Object
            | Tag::Map
            | Tag::MapIterator
            | Tag::SetIterator
            | Tag::Set
            | Tag::CustomFormattedObject
            | Tag::Private
            | Tag::ToJSON
            | Tag::JSX
            | Tag::Event
            | Tag::Proxy => true,

            Tag::StringPossiblyFormatted
            | Tag::String
            | Tag::Undefined
            | Tag::Double
            | Tag::Integer
            | Tag::Null
            | Tag::Boolean
            | Tag::Function
            | Tag::Class
            | Tag::TypedArray
            | Tag::BigInt
            | Tag::Symbol
            | Tag::GlobalObject
            | Tag::Promise
            // `JSON.stringify` walks it, with its own cycle check and no budget.
            | Tag::JSON
            | Tag::NativeCode
            | Tag::GetterSetter
            | Tag::CustomGetterSetter
            | Tag::RevokedProxy => false,
        }
    }

    /// The formatter that wrote the stored snapshots looked for cycles under
    /// these tags only. A cycle through a React element, an event or a
    /// `Response` prints that value again and says `[Circular]` further in.
    pub(super) const fn is_on_the_path_of_a_stored_snapshot(self) -> bool {
        matches!(self, Tag::Array | Tag::Object | Tag::Map | Tag::Set)
    }

    fn abbreviation(self) -> &'static str {
        match self {
            Tag::Array => "Array",
            Tag::Map => "Map",
            Tag::Set => "Set",
            Tag::Error => "Error",
            _ => "Object",
        }
    }
}

impl<'a> Formatter<'a> {
    fn acquire_map(&mut self) {
        if self.map_node.is_some() {
            return;
        }
        let mut node = core::ptr::NonNull::new(visited::Pool::get_node())
            .expect("ObjectPool::get_node always returns a valid heap node");
        let data = visited::node_data_mut(&mut node);
        data.clear();
        self.map = core::mem::take(data);
        self.map_node = Some(node);
    }

    /// A `Printed` key does not keep its cell alive. What a hook returned dies
    /// once it is printed, and after a collection a new cell can have its
    /// address and would print as a repeat.
    fn marks(&mut self) -> &mut visited::Map {
        self.acquire_map();
        let collections = reader::collections(self.global_this);
        if self.collections != collections {
            self.collections = collections;
            let on_path: Vec<JSValue> = self
                .map
                .iter()
                .filter(|(_, mark)| **mark == Mark::OnPath)
                .map(|(value, _)| *value)
                .collect();
            self.map.clear();
            for value in on_path {
                self.map.insert(value, Mark::OnPath);
            }
        }
        &mut self.map
    }

    /// Starts a value that has nothing to do with the last one this printed.
    pub(super) fn forget_printed(&mut self) {
        debug_assert!(self.repeat_depth == 0);
        self.map.clear();
        if let Some(bytes) = &self.repeat_bytes {
            bytes.set(0);
        }
    }

    /// Puts `value` on the path. `None` when it was not seen before.
    fn mark_on_path(&mut self, value: JSValue) -> Option<Mark> {
        let entry = self.marks().get_or_put(value).expect("unreachable");
        if !entry.found_existing {
            return None;
        }
        Some(core::mem::replace(entry.value_ptr, Mark::OnPath))
    }

    pub(crate) fn is_on_path(&self, value: JSValue) -> bool {
        self.map.get(&value) == Some(&Mark::OnPath)
    }

    fn mark_printed(&mut self, value: JSValue) {
        if let Some(mark) = self.map.get_mut(&value) {
            *mark = Mark::Printed;
        }
    }

    /// Reports a native stack that is too deep to recurse on.
    pub(crate) fn stack_overflow(&mut self) -> JsResult<()> {
        self.failed = true;
        if self.can_throw_stack_overflow {
            return Err(self.global_this.throw_stack_overflow());
        }
        Ok(())
    }

    pub(super) fn repeat_counter(&mut self) -> Rc<Cell<usize>> {
        Rc::clone(
            self.repeat_bytes
                .get_or_insert_with(|| Rc::new(Cell::new(0))),
        )
    }

    pub fn style(&self) -> Style {
        self.style
    }

    /// The budget, if it ran out and a shared reference printed as `[Object ...]`.
    pub fn abbreviated_shared_references(&self) -> Option<usize> {
        self.abbreviated
            .then_some(self.shared_reference_budget.bytes)
    }

    /// Whether the print stopped early: the value nests deeper than the native
    /// stack allows, or the sink stopped accepting bytes.
    pub fn stopped_early(&self) -> bool {
        self.failed
    }

    /// `Ok(None)` when there is nothing left for a printer to do. Outlined so
    /// its locals live in a leaf frame that is popped before the descent: the
    /// 512-deep `Bun.inspect` test cannot afford them per level under ASAN.
    #[inline(never)]
    pub(super) fn enter<const C: bool>(
        &mut self,
        format: Tag,
        writer_: &mut dyn bun_io::Write,
        value: JSValue,
    ) -> JsResult<Option<Entered>> {
        if self.failed {
            return Ok(None);
        }
        if self.global_this.has_exception() {
            return Err(jsc::JsError::Thrown);
        }
        if !format.holds_values(self.style) {
            return Ok(Some(Entered::LEAF));
        }
        self.enter_holder::<C>(format, writer_, value)
    }

    fn enter_holder<const C: bool>(
        &mut self,
        format: Tag,
        writer_: &mut dyn bun_io::Write,
        value: JSValue,
    ) -> JsResult<Option<Entered>> {
        if !self.stack_check.is_safe_to_recurse() {
            self.stack_overflow()?;
            self.print_abbreviation::<C>(format, writer_)?;
            return Ok(None);
        }

        let off_path = self.stored_snapshot && !format.is_on_the_path_of_a_stored_snapshot();
        if off_path {
            let entry = self.marks().get_or_put(value).expect("unreachable");
            if !entry.found_existing {
                *entry.value_ptr = Mark::Printed;
                return Ok(Some(Entered {
                    off_path,
                    ..Entered::LEAF
                }));
            }
        } else {
            match self.mark_on_path(value) {
                None => return Ok(Some(Entered::ON_PATH)),
                Some(Mark::OnPath) => {
                    self.print_circular::<C>(writer_);
                    return Ok(None);
                }
                Some(Mark::Printed) => {}
            }
        }

        let spent = self.repeat_bytes.as_ref().map_or(0, |bytes| bytes.get());
        if spent >= self.shared_reference_budget.bytes {
            if !off_path {
                self.mark_printed(value);
            }
            self.past_budget::<C>(format, writer_)?;
            return Ok(None);
        }
        let opens_repeat = self.repeat_depth == 0;
        self.repeat_depth += 1;
        Ok(Some(Entered {
            marked: !off_path,
            repeat: true,
            opens_repeat,
            off_path,
        }))
    }

    fn print_circular<const C: bool>(&mut self, writer_: &mut dyn bun_io::Write) {
        if writer_
            .write_all(pfmt!("<r><cyan>[Circular]<r>", C).as_bytes())
            .is_err()
        {
            self.failed = true;
        }
    }

    /// Puts on the path a value that entered off it and now prints under a tag
    /// that is on it. `None` when it is its own ancestor there.
    pub(super) fn enter_path_of_stored_snapshot(
        &mut self,
        writer_: &mut dyn bun_io::Write,
        value: JSValue,
    ) -> Option<Entered> {
        if self.mark_on_path(value) == Some(Mark::OnPath) {
            self.print_circular::<false>(writer_);
            return None;
        }
        Some(Entered::ON_PATH)
    }

    /// The gate for an `Error` the error printer reached on its own: an
    /// uncaught exception, a `cause`, a member of `AggregateError.errors`.
    /// `Ok(None)` when there is nothing left to print. It runs with an
    /// exception pending, which the error printer clears as it goes.
    pub(crate) fn with_error_entered<R>(
        &mut self,
        writer: &mut bun_core::io::Writer,
        error: JSValue,
        enable_ansi_colors: bool,
        print: impl FnOnce(&mut Self, &Entered, &mut bun_core::io::Writer) -> R,
    ) -> JsResult<Option<R>> {
        let entered = if enable_ansi_colors {
            self.enter_holder::<true>(Tag::Error, writer, error)?
        } else {
            self.enter_holder::<false>(Tag::Error, writer, error)?
        };
        let Some(entered) = entered else {
            return Ok(None);
        };
        let _leave = Leave::new(
            &raw mut self.map,
            &raw mut self.repeat_depth,
            &entered,
            error,
        );
        if !entered.opens_repeat() {
            return Ok(Some(print(self, &entered, writer)));
        }
        let mut counting = CountingWriter {
            inner: writer,
            written: self.repeat_counter(),
        };
        let mut adapter = DynWriteAdapter::new(&mut counting);
        Ok(Some(print(self, &entered, adapter.interface())))
    }

    /// Whether the output is stored and compared. It is complete or it is an
    /// error, and its text is that of the formatter that wrote the stored ones.
    pub fn is_stored_snapshot(&self) -> bool {
        self.stored_snapshot
    }

    /// Whether a run of array holes prints as one line instead of one to a hole.
    pub(super) fn collapses_hole_run(&self, holes: u32) -> JsResult<bool> {
        if !self.is_stored_snapshot() {
            return Ok(holes > reader::MAX_EXPANDED_HOLE_RUN);
        }
        if holes <= reader::MOST_A_SNAPSHOT_LISTS {
            return Ok(false);
        }
        Err(self.global_this.throw(format_args!(
            "Snapshot value is too large to serialize: an array has {holes} empty items in a row. Snapshot a smaller part of the value."
        )))
    }

    #[cold]
    fn past_budget<const C: bool>(
        &mut self,
        format: Tag,
        writer_: &mut dyn bun_io::Write,
    ) -> JsResult<()> {
        if self.shared_reference_budget.past == PastBudget::Throw {
            return Err(self.global_this.throw(format_args!(
                "Snapshot value is too large to serialize: the objects that it references more than once print more than {} MiB. Snapshot a smaller part of the value.",
                self.shared_reference_budget.bytes / (1024 * 1024)
            )));
        }
        self.abbreviated = true;
        self.print_abbreviation::<C>(format, writer_)
    }

    fn print_abbreviation<const C: bool>(
        &mut self,
        format: Tag,
        writer_: &mut dyn bun_io::Write,
    ) -> JsResult<()> {
        match self.style {
            Style::Console => self.print_depth_exceeded_marker::<C>(writer_, format.abbreviation()),
            Style::Jest => {
                let _ = write!(writer_, "[{}]", format.abbreviation());
                Ok(())
            }
        }
    }
}
