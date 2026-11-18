//! `line`, `column`, `sourceURL` and `stack`.

use core::cell::Cell;

use bun_engine_macros::native_abi;
use bun_engine_text::{PropertyName, StringRef, names};

use super::error_instance::ErrorFlags;
use crate::{
    Attributes, CellType, CustomGetterSetter, Cx, ErrorInstance, Gc, JsObject, JsResult, JsString,
    LineColumn, PropertyDescriptor, SourceProvider, StackFrame, StackTrace, StackTraceRequest,
    TransitionKind, Value, Vm, capture_stack_trace, stack_trace_text,
};

#[derive(Default)]
#[repr(C)]
pub struct ErrorLocation {
    pub position: LineColumn,
    pub source_url: Option<StringRef>,
}

impl ErrorLocation {
    /// That of the first frame which has one.
    pub fn of(vm: &Vm, frames: &[StackFrame]) -> ErrorLocation {
        let found = frames.iter().find_map(|frame| {
            Some(ErrorLocation {
                position: frame.line_column()?,
                source_url: Some(frame.source_url_for_report(vm)),
            })
        });
        found.unwrap_or_default()
    }
}

/// For an embedder with a format of its own. The location comes in as a parser left it, or empty.
#[derive(Default)]
pub struct ErrorHooks {
    /// The value of `stack`, which is defined even if an exception is left pending. The error still has its frames.
    pub compute_stack: Cell<Option<fn(&mut Cx, Gc<ErrorInstance>, &mut ErrorLocation) -> Value>>,
    /// What follows the name and the message. It is called at the end of a collection, so it allocates nothing in the
    /// heap and looks at nothing but the frames.
    pub format_frames: Cell<Option<fn(&Vm, &StackTrace, &mut ErrorLocation) -> StringRef>>,
    /// From the text that runs to the one that was written. The URL is set if it is another.
    pub map_position:
        Cell<Option<fn(&Vm, &SourceProvider, &mut LineColumn, &mut Option<StringRef>)>>,
}

impl ErrorInstance {
    #[inline(always)]
    pub fn is_lazy_property(name: PropertyName<'_>) -> bool {
        name == names::stack
            || name == names::line
            || name == names::column
            || name == names::sourceURL
    }

    pub fn is_materialized(&self) -> bool {
        self.has(ErrorFlags::IS_MATERIALIZED)
    }

    /// Leaves `stack` to the caller.
    pub fn set_stack_is_provided(&self) {
        if !self.is_materialized() {
            self.set(ErrorFlags::STACK_IS_PROVIDED);
        }
    }

    pub(super) fn location(&self) -> ErrorLocation {
        ErrorLocation {
            position: self.position(),
            source_url: self.source_url(),
        }
    }

    pub(super) fn set_location(&self, location: ErrorLocation) {
        self.set_position(location.position);
        self.set_source_url(location.source_url);
    }

    pub(super) fn materializing_may_run_script(&self, vm: &Vm) -> bool {
        !self.has(ErrorFlags::IS_MATERIALIZED | ErrorFlags::STACK_IS_PROVIDED)
            && self.has_any_frame()
            && vm.embedder().errors.compute_stack.get().is_some()
    }

    /// False if the properties are as they were, and will not be defined later.
    #[inline(always)]
    pub fn materialize_for(&self, cx: &mut Cx, name: PropertyName<'_>) -> JsResult<bool> {
        if Self::is_lazy_property(name) {
            return self.materialize(cx);
        }
        Ok(false)
    }

    /// An error that has nothing to tell yet can still be given frames.
    pub fn materialize(&self, cx: &mut Cx) -> JsResult<bool> {
        let captured = self.has(ErrorFlags::HAS_CAPTURED_FRAMES);
        if captured && let Some(text) = self.take_captured_text(cx) {
            self.define_stack(cx, JsString::new(cx, text).into());
        }
        if self.is_materialized() {
            return Ok(captured);
        }
        let cx = cx.in_realm_of(self);
        let needs_stack = !self.has(ErrorFlags::STACK_IS_PROVIDED);
        if let Some(compute_stack) = cx.embedder().errors.compute_stack.get()
            && self.has_any_frame()
        {
            self.set(ErrorFlags::IS_MATERIALIZED);
            let stack = needs_stack.then(|| {
                let _keeps_alive = self.stack_frames();
                // What a script finds out about it meanwhile is not true of the others of its shape.
                self.non_property_transition(cx, TransitionKind::EndLaziness);
                let mut location = self.location();
                let stack = compute_stack(cx, self.into(), &mut location);
                self.set_location(location);
                stack
            });
            self.drop_frames();
            self.take_stack_text();
            self.define_location(cx);
            if let Some(stack) = stack {
                self.define_stack(cx, stack);
            }
            return cx.check_exception().map(|()| true);
        }
        self.turn_frames_into_info(cx);
        if !self.has(ErrorFlags::HAS_INFO) {
            return Ok(true);
        }
        self.set(ErrorFlags::IS_MATERIALIZED);
        self.define_location(cx);
        if needs_stack {
            let mut text = Ok(self.take_stack_text().unwrap_or_default());
            if self.has(ErrorFlags::TEXT_LACKS_HEADER) {
                text = text.and_then(|frames| self.header_followed_by(cx, frames.text()));
            }
            match text {
                Ok(text) => self.define_stack(cx, JsString::new(cx, text).into()),
                Err(thrown) => {
                    self.define_stack(cx, Value::UNDEFINED);
                    return Err(thrown);
                }
            }
        }
        Ok(true)
    }

    fn define_location(&self, vm: &Vm) {
        let LineColumn { line, column } = self.position();
        self.put_direct(vm, names::line, line.into(), Attributes::DONT_ENUM);
        self.put_direct(vm, names::column, column.into(), Attributes::DONT_ENUM);
        if let Some(url) = self.source_url().filter(|it| !it.is_empty()) {
            self.set_source_url(None);
            let url = JsString::new(vm, url).into();
            self.put_direct(vm, names::sourceURL, url, Attributes::DONT_ENUM);
        }
    }

    fn define_stack(&self, vm: &Vm, stack: Value) {
        self.put_direct(vm, names::stack, stack, Attributes::DONT_ENUM);
    }

    /// For an error in a text that does not run. What an embedder with a format of its own makes of the place stands.
    pub fn locate_in_source(&self, cx: &mut Cx, line: u32, url: Option<&StringRef>) {
        let hooks = &cx.embedder().errors;
        let embedder_decides = !self.is_materialized()
            && self.has_any_frame()
            && (hooks.compute_stack.get().is_some() || hooks.format_frames.get().is_some());
        self.set_position(LineColumn { line, column: 0 });
        if let Some(url) = url.filter(|it| !it.is_empty()) {
            self.set_source_url(Some(url.clone()));
        }
        if let Err(thrown) = self.materialize(cx) {
            cx.discard_unless_termination(thrown);
        }
        if embedder_decides {
            return;
        }
        self.put_direct(cx, names::line, line.into(), Attributes::DONT_ENUM);
        if let Some(url) = url {
            let url = JsString::new(cx, url.clone()).into();
            self.put_direct(cx, names::sourceURL, url, Attributes::DONT_ENUM);
        }
    }
}

#[native_abi]
fn get_captured_stack(cx: &mut Cx, this: Value, name: PropertyName<'_>) -> JsResult<Value> {
    let error = this.cast::<ErrorInstance>();
    error.materialize(cx)?;
    Ok(error.get_direct(name).unwrap_or_default())
}

/// `Error.captureStackTrace`, from the native function of that name. A proxy is left alone.
pub fn define_captured_stack(
    cx: &mut Cx,
    object: Gc<JsObject>,
    below: Option<Gc<JsObject>>,
) -> JsResult<()> {
    if matches!(object.cell_type(), CellType::Proxy | CellType::GlobalProxy) {
        return Ok(());
    }
    let limit = cx.global().stack_trace_limit().unwrap_or(0) as usize;
    if let Some(error) = object.downcast::<ErrorInstance>() {
        error.set_stack_is_provided();
        let has_placeholder = error.has(ErrorFlags::HAS_CAPTURED_FRAMES);
        let shape = error.shape();
        if has_placeholder || (shape.is_extensible() && shape.get(names::stack).is_none()) {
            if !has_placeholder {
                let placeholder =
                    CustomGetterSetter::create(cx, Some(get_captured_stack), None, None);
                error.put_direct_custom(cx, names::stack, placeholder, Attributes::DONT_ENUM);
            }
            let request = StackTraceRequest {
                skip: 1,
                limit,
                below,
                filter: None,
            };
            error.set_captured_frames(cx, StackTrace::capture(cx, request));
            return Ok(());
        }
    }
    let stack = stack_trace_text(cx, &capture_stack_trace(cx, 1, limit, below));
    let stack = PropertyDescriptor::data(JsString::new(cx, stack).into(), Attributes::DONT_ENUM);
    object.define_property_or_throw(cx, names::stack, &stack)
}

/// Gives an object that is no `ErrorInstance` the properties of one.
pub fn add_error_info(vm: &Vm, object: &JsObject) {
    let Some(limit) = object.realm().and_then(|it| it.stack_trace_limit()) else {
        return;
    };
    let frames = capture_stack_trace(vm, 0, limit as usize, None);
    if !frames.is_empty() {
        let location = ErrorLocation::of(vm, &frames);
        let LineColumn { line, column } = location.position;
        object.put_direct(vm, names::line, line.into(), Attributes::NONE);
        object.put_direct(vm, names::column, column.into(), Attributes::NONE);
        if let Some(url) = location.source_url.filter(|it| !it.is_empty()) {
            let url = JsString::new(vm, url).into();
            object.put_direct(vm, names::sourceURL, url, Attributes::NONE);
        }
    }
    let stack = JsString::new(vm, stack_trace_text(vm, &frames)).into();
    object.put_direct(vm, names::stack, stack, Attributes::DONT_ENUM);
}
