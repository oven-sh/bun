use core::cell::{Cell, UnsafeCell};
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU16, Ordering};

use bun_engine_macros::{cell, object_ops};
use bun_engine_text::{PropertyName, StringRef, Text, names};

use crate::heap::Survivors;
use crate::{
    Attributes, Cx, DeletePropertySlot, DontEnumMode, Gc, GcFree, GlobalObject, InternalMethod,
    JsArray, JsDestructibleObject, JsObject, JsObjectInit, JsResult, JsString, LineColumn, Message,
    PropertyDescriptor, PropertyNameList, PropertySlot, PutPropertySlot, RealmSlot, RootVec, Shape,
    SourceAppender, StackFrame, StackTrace, StackTraceRequest, Value, Visitor, Vm, options,
    root_vec, stack_trace_text,
};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum ErrorType {
    Error,
    EvalError,
    RangeError,
    ReferenceError,
    SyntaxError,
    TypeError,
    UriError,
    AggregateError,
    SuppressedError,
}

impl ErrorType {
    pub const fn name(self) -> PropertyName<'static> {
        match self {
            ErrorType::Error => names::Error,
            ErrorType::EvalError => names::EvalError,
            ErrorType::RangeError => names::RangeError,
            ErrorType::ReferenceError => names::ReferenceError,
            ErrorType::SyntaxError => names::SyntaxError,
            ErrorType::TypeError => names::TypeError,
            ErrorType::UriError => names::URIError,
            ErrorType::AggregateError => names::AggregateError,
            ErrorType::SuppressedError => names::SuppressedError,
        }
    }
}

bitflags::bitflags! {
    #[derive(Clone, Copy)]
    pub(super) struct ErrorFlags: u16 {
        const IS_STACK_OVERFLOW = 1 << 0;
        const IS_OUT_OF_MEMORY = 1 << 1;
        const IS_NATIVE_GETTER_TYPE_ERROR = 1 << 2;
        const IS_PARSE_ERROR = 1 << 3;
        const PASSES_WASM_HANDLERS = 1 << 4;
        /// There is a list, which may be empty.
        const HAS_FRAMES = 1 << 5;
        const HAS_CAPTURED_FRAMES = 1 << 6;
        /// The position, the URL and the text are what to define the properties with.
        const HAS_INFO = 1 << 7;
        const IS_MATERIALIZED = 1 << 8;
        /// `stack` does not come from the frames that the error was made with.
        const STACK_IS_PROVIDED = 1 << 9;
        /// The name and the message go in front of it.
        const TEXT_LACKS_HEADER = 1 << 10;
    }
}

/// An error does not keep the functions alive that it has passed through. It turns into text what is about to go.
#[repr(transparent)]
pub(super) struct WeakFrames<T>(UnsafeCell<T>);

// SAFETY: see `reconcile_weak_references`. The barrier follows each change.
unsafe impl<T> GcFree for WeakFrames<T> {}

/// `stack`, `line`, `column` and `sourceURL` are defined when something asks for one of them.
#[cell(name = "Error", cell_type = ErrorInstance, ops, export = "engine_class_ErrorInstance",
    visit_children, reconcile_weak_references, estimated_size)]
pub struct ErrorInstance {
    base: JsDestructibleObject,
    frames: WeakFrames<StackTrace>,
    /// Of `Error.captureStackTrace`.
    captured_frames: WeakFrames<Option<Box<StackTrace>>>,
    position: Cell<LineColumn>,
    source_url: Cell<Option<StringRef>>,
    stack_text: Cell<Option<StringRef>>,
    flags: AtomicU16,
    /// What the frames and the text take, for markers, which may not look at them.
    reported_kilobytes: AtomicU16,
    error_type: ErrorType,
}

#[object_ops]
impl ErrorInstance {
    fn get_own_property_slot(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        if Self::is_lazy_property(name) {
            if !(slot.is_inquiry() && self.materializing_may_run_script(cx)) {
                self.materialize(cx)?;
            }
            // Others of its shape have the property without showing it.
            if !self.is_materialized() && self.shape().get(name).is_none() {
                slot.taint_by_opaque_object();
                return Ok(false);
            }
        }
        self.ordinary_get_own_property_slot(cx, name, slot)
    }

    fn own_special_property_names(
        &self,
        cx: &mut Cx,
        _: &mut PropertyNameList,
        mode: DontEnumMode,
    ) -> JsResult<()> {
        if mode == DontEnumMode::Include {
            self.materialize(cx)?;
        }
        Ok(())
    }

    fn put(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
        slot: &mut PutPropertySlot,
    ) -> JsResult<bool> {
        if self.materialize_for(cx, name)? {
            slot.disable_caching();
        }
        self.ordinary_put(cx, name, value, slot)
    }

    fn delete_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut DeletePropertySlot,
    ) -> JsResult<bool> {
        if self.materialize_for(cx, name)? {
            slot.disable_caching();
        }
        self.ordinary_delete_property(cx, name, slot)
    }

    fn define_own_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        descriptor: &PropertyDescriptor,
        should_throw: bool,
    ) -> JsResult<bool> {
        self.materialize_for(cx, name)?;
        self.ordinary_define_own_property(cx, name, descriptor, should_throw)
    }
}

impl GlobalObject {
    #[inline]
    pub fn shape_for_error(&self, vm: &Vm, error_type: ErrorType) -> Gc<Shape> {
        let slot = RealmSlot::error_shape.offset_by(error_type as usize);
        self.slot(vm, slot).cast()
    }

    /// `None` unless `Error.stackTraceLimit` is a number.
    pub fn stack_trace_limit(&self) -> Option<u32> {
        let Some(constructor) = self.slot_if_initialized(RealmSlot::error_constructor) else {
            return Some(options().default_error_stack_trace_limit);
        };
        let caches = &self.heap().vm().services.errors.caches;
        let limit = caches.stack_trace_limit(&*constructor.as_object()?)?;
        let limit = limit.as_number().filter(|it| !it.is_nan())?;
        Some(limit as u32)
    }
}

impl ErrorInstance {
    #[inline]
    fn allocate(vm: &Vm, shape: Gc<Shape>, error_type: ErrorType) -> Gc<ErrorInstance> {
        vm.allocate::<ErrorInstance>(ErrorInstanceInit {
            base: JsObjectInit::new(vm, shape),
            frames: WeakFrames(UnsafeCell::new(StackTrace::EMPTY)),
            captured_frames: WeakFrames(UnsafeCell::new(None)),
            position: Cell::default(),
            source_url: Cell::new(None),
            stack_text: Cell::new(None),
            flags: AtomicU16::new(0),
            reported_kilobytes: AtomicU16::new(0),
            error_type,
        })
    }

    /// The innermost `skip` frames are not part of the stack trace, nor those up to a call of `below`.
    pub fn create(
        vm: &Vm,
        shape: Gc<Shape>,
        error_type: ErrorType,
        skip: usize,
        below: Option<Gc<JsObject>>,
    ) -> Gc<ErrorInstance> {
        let error = Self::allocate(vm, shape, error_type);
        if let Some(limit) = shape.global().and_then(|it| it.stack_trace_limit()) {
            error.capture(vm, skip, limit, below);
        }
        error
    }

    pub fn new(cx: &Cx, error_type: ErrorType, message: Option<StringRef>) -> Gc<ErrorInstance> {
        let shape = cx.global().shape_for_error(cx, error_type);
        let error = Self::create(cx, shape, error_type, 0, None);
        if let Some(message) = message {
            error.define_message(cx, JsString::new(cx, message));
        }
        error
    }

    /// With the text of the expression that the running code is at. `value` is what the message is about.
    pub fn with_source(
        cx: &Cx,
        error_type: ErrorType,
        message: StringRef,
        appender: SourceAppender,
        value: Value,
    ) -> Gc<ErrorInstance> {
        let error = Self::new(cx, error_type, None);
        error.define_message_with_source(cx, message, appender, value);
        error
    }

    /// One that was made elsewhere, as in another thread.
    pub fn with_info(
        cx: &Cx,
        error_type: ErrorType,
        message: Option<StringRef>,
        position: LineColumn,
        source_url: Option<StringRef>,
        stack: Option<StringRef>,
    ) -> Gc<ErrorInstance> {
        let shape = cx.global().shape_for_error(cx, error_type);
        let error = Self::allocate(cx, shape, error_type);
        error.set_info(cx, position, source_url, stack);
        if let Some(message) = message {
            error.define_message(cx, JsString::new(cx, message));
        }
        error
    }

    pub fn out_of_memory(cx: &Cx, message: StringRef) -> Gc<ErrorInstance> {
        let error = Self::new(cx, ErrorType::RangeError, Some(message));
        error.set(ErrorFlags::IS_OUT_OF_MEMORY | ErrorFlags::PASSES_WASM_HANDLERS);
        error
    }

    pub fn stack_overflow(cx: &Cx) -> Gc<ErrorInstance> {
        let message = "Maximum call stack size exceeded.".into_string();
        let error = Self::new(cx, ErrorType::RangeError, Some(message));
        error.set(ErrorFlags::IS_STACK_OVERFLOW | ErrorFlags::PASSES_WASM_HANDLERS);
        error
    }

    pub fn aggregate(
        cx: &Cx,
        errors: Gc<JsArray>,
        message: Option<StringRef>,
    ) -> Gc<ErrorInstance> {
        let error = Self::new(cx, ErrorType::AggregateError, message);
        error.define_errors(cx, errors);
        error
    }

    pub fn suppressed(cx: &Cx, error: Value, suppressed: Value) -> Gc<ErrorInstance> {
        let result = Self::new(cx, ErrorType::SuppressedError, None);
        result.define_error_and_suppressed(cx, error, suppressed);
        result
    }

    pub fn define_message(&self, vm: &Vm, message: Gc<JsString>) {
        self.put_direct(vm, names::message, message.into(), Attributes::DONT_ENUM);
    }

    /// See `with_source`.
    pub fn define_message_with_source(
        &self,
        vm: &Vm,
        message: StringRef,
        appender: SourceAppender,
        value: Value,
    ) {
        let appended = (self.has_any_frame() || appender.is_for_call())
            .then(|| appender.append(vm, message.text(), value))
            .flatten();
        self.define_message(vm, JsString::new(vm, appended.unwrap_or(message)));
    }

    pub fn define_cause(&self, vm: &Vm, cause: Value) {
        self.put_direct(vm, names::cause, cause, Attributes::DONT_ENUM);
    }

    pub fn define_errors(&self, vm: &Vm, errors: Gc<JsArray>) {
        self.put_direct(vm, names::errors, errors.into(), Attributes::DONT_ENUM);
    }

    pub fn define_error_and_suppressed(&self, vm: &Vm, error: Value, suppressed: Value) {
        self.put_direct(vm, names::error, error, Attributes::DONT_ENUM);
        self.put_direct(vm, names::suppressed, suppressed, Attributes::DONT_ENUM);
    }

    #[inline(always)]
    pub(super) fn has(&self, flags: ErrorFlags) -> bool {
        self.flags.load(Ordering::Relaxed) & flags.bits() != 0
    }

    #[inline(always)]
    pub(super) fn set(&self, flags: ErrorFlags) {
        let old = self.flags.load(Ordering::Relaxed);
        self.flags.store(old | flags.bits(), Ordering::Relaxed);
    }

    #[inline(always)]
    pub(super) fn set_to(&self, flags: ErrorFlags, value: bool) {
        let others = self.flags.load(Ordering::Relaxed) & !flags.bits();
        let bits = if value { flags.bits() } else { 0 };
        self.flags.store(others | bits, Ordering::Relaxed);
    }

    #[inline]
    pub fn error_type(&self) -> ErrorType {
        self.error_type
    }

    pub fn is_stack_overflow(&self) -> bool {
        self.has(ErrorFlags::IS_STACK_OVERFLOW)
    }

    pub fn is_out_of_memory(&self) -> bool {
        self.has(ErrorFlags::IS_OUT_OF_MEMORY)
    }

    pub fn is_native_getter_type_error(&self) -> bool {
        self.has(ErrorFlags::IS_NATIVE_GETTER_TYPE_ERROR)
    }

    pub fn set_native_getter_type_error(&self) {
        self.set(ErrorFlags::IS_NATIVE_GETTER_TYPE_ERROR);
    }

    pub fn is_parse_error(&self) -> bool {
        self.has(ErrorFlags::IS_PARSE_ERROR)
    }

    pub fn set_parse_error(&self) {
        self.set(ErrorFlags::IS_PARSE_ERROR);
    }

    pub fn is_catchable_from_wasm(&self) -> bool {
        !self.has(ErrorFlags::PASSES_WASM_HANDLERS)
    }

    pub fn set_not_catchable_from_wasm(&self) {
        self.set(ErrorFlags::PASSES_WASM_HANDLERS);
    }

    pub fn position(&self) -> LineColumn {
        self.position.get()
    }

    pub(super) fn set_position(&self, position: LineColumn) {
        self.position.set(position);
    }

    /// `None` once it has become a property.
    pub fn source_url(&self) -> Option<StringRef> {
        let url = self.source_url.take();
        self.source_url.set(url.clone());
        url
    }

    pub(super) fn set_source_url(&self, url: Option<StringRef>) {
        self.source_url.set(url);
    }

    pub(super) fn take_stack_text(&self) -> Option<StringRef> {
        let text = self.stack_text.take();
        self.update_reported_memory();
        text
    }
}

/// The frames
impl ErrorInstance {
    /// `read` does not touch the error or allocate in the heap.
    #[inline(always)]
    fn with_frames<R>(&self, read: impl FnOnce(&StackTrace) -> R) -> R {
        // SAFETY: no reference to the list outlives a call of this function or of `replace_frames`.
        read(unsafe { &*self.frames.0.get() })
    }

    fn replace_frames(&self, frames: Option<StackTrace>) {
        self.set_to(ErrorFlags::HAS_FRAMES, frames.is_some());
        // SAFETY: as above.
        unsafe { *self.frames.0.get() = frames.unwrap_or(StackTrace::EMPTY) };
        if self.has_any_frame() {
            self.write_barrier_for_cell();
        }
    }

    fn replace_captured_frames(&self, frames: Option<Box<StackTrace>>) -> Option<Box<StackTrace>> {
        self.set_to(ErrorFlags::HAS_CAPTURED_FRAMES, frames.is_some());
        // SAFETY: nothing else makes a reference to it.
        let old = unsafe { self.captured_frames.0.get().replace(frames) };
        self.write_barrier_for_cell();
        old
    }

    #[inline]
    fn capture(&self, vm: &Vm, skip: usize, limit: u32, below: Option<Gc<JsObject>>) {
        let request = StackTraceRequest {
            skip,
            limit: limit as usize,
            below,
            filter: None,
        };
        self.replace_frames(Some(StackTrace::capture(vm, request)));
        if self.with_frames(StackTrace::memory_size) >= 1024 {
            self.report_memory(vm);
        }
    }

    /// In place of the frames that it has.
    pub fn capture_stack_trace(&self, cx: &Cx, skip: usize) {
        let limit = cx.global().stack_trace_limit().unwrap_or(0);
        self.capture(cx, skip, limit, None);
    }

    #[inline]
    pub fn has_any_frame(&self) -> bool {
        self.with_frames(|frames| !frames.is_empty())
    }

    pub fn stack_frames(&self) -> RootVec<StackFrame> {
        if !self.has_any_frame() {
            return root_vec();
        }
        self.with_frames(StackTrace::to_root_vec)
    }

    /// For the embedder, which may change the list until the next allocation in the heap. A collection empties it if
    /// something that it refers to has died.
    pub fn stack_trace_ptr(&self) -> Option<NonNull<StackTrace>> {
        self.write_barrier_for_cell();
        NonNull::new(self.frames.0.get()).filter(|_| self.has(ErrorFlags::HAS_FRAMES))
    }

    pub fn set_stack_frames(&self, vm: &Vm, frames: &[StackFrame]) {
        // SAFETY: a copy of what the caller keeps alive.
        unsafe { self.set_stack_trace(vm, StackTrace::copy_of(frames)) }
    }

    /// # Safety
    /// What the frames refer to is alive.
    pub unsafe fn set_stack_trace(&self, vm: &Vm, frames: StackTrace) {
        self.replace_frames(Some(frames));
        self.stack_text.take();
        self.set_to(ErrorFlags::HAS_INFO | ErrorFlags::TEXT_LACKS_HEADER, false);
        self.report_memory(vm);
    }

    /// What to define the properties with, in place of the frames.
    pub fn set_info(
        &self,
        vm: &Vm,
        position: LineColumn,
        source_url: Option<StringRef>,
        stack: Option<StringRef>,
    ) {
        self.replace_frames(None);
        self.position.set(position);
        self.source_url.set(source_url);
        self.set_to(ErrorFlags::HAS_INFO, stack.is_some());
        self.set_to(ErrorFlags::TEXT_LACKS_HEADER, false);
        self.stack_text.set(stack);
        self.report_memory(vm);
    }

    pub(super) fn drop_frames(&self) {
        self.replace_frames(None);
        self.update_reported_memory();
    }

    pub(super) fn set_captured_frames(&self, vm: &Vm, frames: StackTrace) {
        self.replace_captured_frames(Some(Box::new(frames)));
        self.stack_text.take();
        self.report_memory(vm);
    }

    pub(super) fn take_captured_text(&self, vm: &Vm) -> Option<StringRef> {
        let frames = self.replace_captured_frames(None)?;
        let text = self.take_stack_text();
        Some(text.unwrap_or_else(|| stack_trace_text(vm, &frames)))
    }

    /// Allocates nothing in the heap.
    pub(super) fn turn_frames_into_info(&self, vm: &Vm) {
        if !self.has_any_frame() {
            return;
        }
        let needs_text = !self.has(ErrorFlags::STACK_IS_PROVIDED);
        let _defer = vm.heap.defer_collection();
        // SAFETY: nothing else makes a reference to the list meanwhile.
        let frames = unsafe { &mut *self.frames.0.get() }.take();
        match vm.embedder().errors.format_frames.get() {
            Some(format) if needs_text => {
                let mut location = self.location();
                self.stack_text
                    .set(Some(format(vm, &frames, &mut location)));
                self.set_location(location);
                self.set(ErrorFlags::TEXT_LACKS_HEADER);
            }
            Some(_) => {}
            None => {
                self.set_location(super::ErrorLocation::of(vm, &frames));
                if needs_text {
                    self.stack_text.set(Some(stack_trace_text(vm, &frames)));
                }
            }
        }
        self.set(ErrorFlags::HAS_INFO);
        self.set_to(ErrorFlags::HAS_FRAMES, false);
        self.update_reported_memory();
    }

    fn memory_size(&self) -> usize {
        // SAFETY: as in `replace_captured_frames`.
        let captured = unsafe { &*self.captured_frames.0.get() };
        let text = self.stack_text.take();
        let size = self.with_frames(StackTrace::memory_size)
            + captured.as_ref().map_or(0, |it| it.memory_size())
            + text.as_ref().map_or(0, |it| it.shared_cost());
        self.stack_text.set(text);
        size
    }

    /// Returns by how many kilobytes it has grown.
    fn update_reported_memory(&self) -> usize {
        let kilobytes = u16::try_from(self.memory_size() / 1024).unwrap_or(u16::MAX);
        let old = self.reported_kilobytes.load(Ordering::Relaxed);
        self.reported_kilobytes.store(kilobytes, Ordering::Relaxed);
        kilobytes.saturating_sub(old).into()
    }

    #[inline(never)]
    fn report_memory(&self, vm: &Vm) {
        let bytes = self.update_reported_memory() * 1024;
        vm.heap.report_extra_memory_allocated(self, bytes);
    }

    fn visit_children(&self, visitor: &mut Visitor) {
        let kilobytes = self.reported_kilobytes.load(Ordering::Relaxed);
        visitor.report_extra_memory(usize::from(kilobytes) * 1024);
        if self.has(ErrorFlags::HAS_FRAMES | ErrorFlags::HAS_CAPTURED_FRAMES) {
            visitor.reconcile_current_cell_later();
        }
    }

    fn reconcile_weak_references(&self, survivors: &Survivors) {
        let vm = survivors.vm();
        let is_whole = |frames: &StackTrace| frames.iter().all(|it| it.has_survived(survivors));
        // SAFETY: as in `replace_captured_frames`.
        if let Some(frames) = unsafe { &mut *self.captured_frames.0.get() }
            && !is_whole(frames)
        {
            self.stack_text.set(Some(stack_trace_text(vm, frames)));
            frames.take();
            self.update_reported_memory();
        }
        if self.with_frames(is_whole) {
            return;
        }
        if self.has(ErrorFlags::IS_MATERIALIZED) {
            // SAFETY: as in `with_frames`.
            unsafe { &mut *self.frames.0.get() }.clear();
        } else {
            self.turn_frames_into_info(vm);
        }
    }

    fn estimated_size(&self, _: &Vm) -> usize {
        self.cell_size() + self.memory_size()
    }
}

/// `Error.prototype.toString` without running a script
impl ErrorInstance {
    pub fn sanitized_message(&self, cx: &mut Cx) -> JsResult<Option<StringRef>> {
        match own_data_property(cx, self, names::message)? {
            Some(message) if message.is_primitive() => message.to_string_ref(cx).map(Some),
            _ => Ok(None),
        }
    }

    pub fn sanitized_name(&self, cx: &mut Cx) -> JsResult<StringRef> {
        let mut name = own_data_property(cx, self, names::name)?;
        if name.is_none()
            && let Some(prototype) = self.prototype_object_direct()
        {
            name = own_data_property(cx, &prototype, names::name)?;
        }
        match name {
            Some(name) if name.is_primitive() && !name.is_undefined() => name.to_string_ref(cx),
            _ => Ok(names::Error.to_identifier().into_string()),
        }
    }

    pub fn sanitized_to_string(&self, cx: &mut Cx) -> JsResult<StringRef> {
        self.header_followed_by(cx, Text::EMPTY)
    }

    /// As much of it as fits in a string.
    pub(super) fn header_followed_by(&self, cx: &mut Cx, rest: Text<'_>) -> JsResult<StringRef> {
        let name = self.sanitized_name(cx)?;
        let message = self.sanitized_message(cx)?.unwrap_or_default();
        let has_both = !name.is_empty() && !message.is_empty();
        let separator = Text::from_ascii(if has_both { ": " } else { "" });
        let parts = [name.text(), separator, message.text(), rest];
        let text = StringRef::try_concat(&parts).or_else(|_| StringRef::try_concat(&parts[..3]));
        Ok(text.unwrap_or(message))
    }
}

fn own_data_property(
    cx: &mut Cx,
    object: &JsObject,
    name: PropertyName<'_>,
) -> JsResult<Option<Value>> {
    let mut slot = PropertySlot::new(object.as_value(), InternalMethod::Inquiry);
    object.ordinary_get_own_property_slot(cx, name, &mut slot)?;
    Ok(slot.plain_value())
}
