use core::cell::Cell;
use core::mem::offset_of;

use bun_engine_bytecode::{Specialization, Visibility};
use bun_engine_macros::{cell, native_abi, object_ops};
use bun_engine_text::{StringBuilder, StringRef, names};

use super::bound_function_stubs as stubs;
use crate::{
    CallFrame, CellType, Cx, Field, Gc, ImmutableArray, Intrinsic, JsFunction, JsObject, JsResult,
    JsString, NativeExecutable, Shape, ShapeFlags, ShapeSpec, TypeFlags, Value, ValueVec, Vm,
    errors,
};

#[cell(name = "Function", ops, export = "engine_class_BoundFunction",
    cleared_flags = TypeFlags::IMPLEMENTS_DEFAULT_HAS_INSTANCE)]
pub struct JsBoundFunction {
    base: JsFunction,
    target_function: Gc<JsObject>,
    bound_this: Value,
    /// Up to three arguments, or in the first an `ImmutableArray` of all of them.
    arguments: [Option<Value>; JsBoundFunction::MAX_INLINE_ARGUMENTS],
    /// Without the prefix. Until it is needed: the original name of the target.
    pub(self) cached_name: Field<Option<Gc<JsString>>>,
    /// NaN until it is needed: follows from the original length of the target.
    length: Cell<f64>,
    argument_count: u32,
    can_construct: bool,
    /// For each `Specialization`, how many arguments the entry puts in before it hands the frame on to the target.
    /// If that is more than `MAX_FORWARDED_ARGUMENTS`, the native function runs.
    forwarded_arguments: [u8; 2],
}

#[object_ops]
impl JsBoundFunction {
    fn custom_has_instance(&self, cx: &mut Cx, value: Value) -> JsResult<bool> {
        self.target_function.has_instance(cx, value)
    }
}

impl JsBoundFunction {
    pub const MAX_INLINE_ARGUMENTS: usize = 3;
    /// So few fit in what is held back of the stack.
    pub(super) const MAX_FORWARDED_ARGUMENTS: usize = 32;
    /// Of the call, which the entry may have to move.
    pub(super) const MAX_MOVED_ARGUMENTS: usize = 256;
    pub const OFFSET_OF_TARGET: usize = offset_of!(JsBoundFunction, target_function);
    pub const OFFSET_OF_BOUND_THIS: usize = offset_of!(JsBoundFunction, bound_this);
    pub const OFFSET_OF_ARGUMENTS: usize = offset_of!(JsBoundFunction, arguments);
    pub const OFFSET_OF_NAME: usize = offset_of!(JsBoundFunction, cached_name);
    pub const OFFSET_OF_LENGTH: usize = offset_of!(JsBoundFunction, length);
    pub const OFFSET_OF_ARGUMENT_COUNT: usize = offset_of!(JsBoundFunction, argument_count);

    pub const fn offset_of_forwarded_arguments(specialization: Specialization) -> usize {
        offset_of!(JsBoundFunction, forwarded_arguments) + specialization as usize
    }

    pub(crate) fn create_executable(vm: &Vm) -> Gc<NativeExecutable> {
        let (intrinsic, visibility) = (Intrinsic::BoundFunctionCall, Visibility::Private);
        let name = StringRef::empty();
        let executable =
            NativeExecutable::create(vm, 0, name, call, construct, intrinsic, visibility);
        // SAFETY: only bound functions have this executable.
        unsafe {
            let (call, construct) = (stubs::call as *const (), stubs::construct as *const ());
            executable.install(Specialization::Call, call as usize, None);
            executable.install(Specialization::Construct, construct as usize, None);
        }
        executable
    }

    /// What is left out of `name` and `length` follows from the original ones of the target.
    pub fn create(
        cx: &mut Cx,
        target: Gc<JsObject>,
        bound_this: Value,
        arguments: &[Value],
        length: Option<f64>,
        name: Option<Gc<JsString>>,
    ) -> JsResult<Gc<JsBoundFunction>> {
        let bound = Self::create_unnamed(cx, target, bound_this, arguments)?;
        bound.length.set(length.unwrap_or(f64::NAN));
        bound.set_cached_name(name);
        Ok(bound)
    }

    /// `Function.prototype.bind`, of a target that can be called.
    #[inline]
    pub fn bind(
        cx: &mut Cx,
        target: Gc<JsObject>,
        bound_this: Value,
        arguments: &[Value],
    ) -> JsResult<Gc<JsBoundFunction>> {
        let bound = Self::create_unnamed(cx, target, bound_this, arguments)?;
        let function = target.downcast::<JsFunction>();
        if !function.is_some_and(|it| it.has_original_length_and_name()) {
            let (length, name) = length_and_name_of(cx, &target)?;
            bound.length.set(bound.length_for(length));
            bound.set_cached_name(Some(name));
        }
        Ok(bound)
    }

    /// BoundFunctionCreate
    #[inline(always)]
    fn create_unnamed(
        cx: &mut Cx,
        target: Gc<JsObject>,
        bound_this: Value,
        arguments: &[Value],
    ) -> JsResult<Gc<JsBoundFunction>> {
        let shape = Self::shape_for(cx, target)?;
        let inline = if arguments.len() > Self::MAX_INLINE_ARGUMENTS {
            let list = ImmutableArray::try_from_values(cx, arguments);
            [Some(cx.or_out_of_memory(list)?.into()), None, None]
        } else {
            [0, 1, 2].map(|index| arguments.get(index).copied())
        };
        let mut forwarded = u8::MAX;
        if CellType::FUNCTIONS.contains(target.cell_type())
            && arguments.len() <= Self::MAX_FORWARDED_ARGUMENTS
        {
            forwarded = arguments.len() as u8;
        }
        let can_construct = target.is_constructor();
        Ok(cx.allocate::<JsBoundFunction>(JsBoundFunctionInit {
            base: JsFunction::native_init(cx, shape, cx.bound_function_executable()),
            target_function: target,
            bound_this,
            arguments: inline,
            cached_name: None,
            length: Cell::new(f64::NAN),
            argument_count: arguments.len() as u32,
            can_construct,
            forwarded_arguments: [forwarded, if can_construct { forwarded } else { u8::MAX }],
        }))
    }

    #[inline(always)]
    fn shape_for(cx: &mut Cx, target: Gc<JsObject>) -> JsResult<Gc<Shape>> {
        let (global, prototype) = (cx.global(), target.get_prototype_of(cx)?);
        let base = global.bound_function_shape(cx);
        if prototype == base.prototype() {
            return Ok(base);
        }
        Ok(match prototype.as_object() {
            Some(prototype) => base.with_prototype(cx, global, prototype),
            None => {
                let spec = ShapeSpec::of::<JsBoundFunction>();
                Shape::create(cx, Some(global), Value::NULL, spec)
            }
        })
    }

    #[inline]
    pub fn target_function(&self) -> Gc<JsObject> {
        self.target_function
    }

    #[inline]
    pub fn bound_this(&self) -> Value {
        self.bound_this
    }

    #[inline]
    pub fn can_construct(&self) -> bool {
        self.can_construct
    }

    /// Whether the frame of the target takes the place of its own in a call with that many arguments and `this`.
    pub fn forwards(&self, specialization: Specialization, count: usize) -> bool {
        match self.forwarded_arguments[specialization as usize] {
            0 => true,
            u8::MAX => false,
            _ => count <= Self::MAX_MOVED_ARGUMENTS,
        }
    }

    #[inline]
    pub fn argument_count(&self) -> usize {
        self.argument_count as usize
    }

    pub fn for_each_argument(&self, visit: impl FnMut(Value)) {
        if self.argument_count() > Self::MAX_INLINE_ARGUMENTS {
            let list = self.arguments[0].and_then(Value::downcast::<ImmutableArray>);
            list.iter().flat_map(|list| list.iter()).for_each(visit);
        } else {
            self.arguments.iter().flatten().copied().for_each(visit);
        }
    }

    fn length_for(&self, target_length: f64) -> f64 {
        (target_length - f64::from(self.argument_count)).max(0.0)
    }

    pub fn bound_length(&self) -> f64 {
        let (mut function, mut bound_further_out) = (Gc::from(self), 0.0);
        let length = loop {
            if !function.length.get().is_nan() {
                break function.length.get();
            }
            let target = function.target_function;
            let Some(next) = target.downcast::<JsBoundFunction>() else {
                let target = target.downcast::<JsFunction>();
                break function.length_for(target.map_or(0.0, |it| it.original_length()));
            };
            bound_further_out += f64::from(function.argument_count);
            function = next;
        };
        self.length.set((length - bound_further_out).max(0.0));
        self.length.get()
    }

    /// The first on the way to the innermost target that knows its name or else the last, and how far in it is.
    fn find_name(&self) -> (Gc<JsBoundFunction>, usize) {
        let (mut function, mut depth) = (Gc::from(self), 0);
        while function.cached_name().is_none()
            && let Some(next) = function.target_function.downcast::<JsBoundFunction>()
        {
            function = next;
            depth += 1;
        }
        (function, depth)
    }

    /// Empty if it is too long.
    pub fn target_name(&self, cx: &Cx) -> Gc<JsString> {
        let (function, depth) = self.find_name();
        let mut name = function.cached_name().unwrap_or_else(|| {
            let target = function.target_function.downcast::<JsFunction>();
            match target.map(|it| it.original_name(cx)) {
                Some(Ok(name)) => name,
                Some(Err(thrown)) => {
                    cx.discard_unless_termination(thrown);
                    cx.small_strings.empty()
                }
                None => cx.small_strings.empty(),
            }
        });
        if depth != 0 {
            name = JsString::new(cx, prefixed(depth, name.to_string_without_collecting()));
        }
        self.set_cached_name(Some(name));
        name
    }

    pub(super) fn name_without_allocating(&self) -> StringRef {
        let (function, depth) = self.find_name();
        let name = match function.cached_name() {
            Some(name) => name.to_string_without_collecting(),
            None => (function.target_function.downcast::<JsFunction>())
                .map_or_default(|target| target.name()),
        };
        prefixed(depth, name)
    }

    fn all_arguments(&self, cx: &Cx, frame: &CallFrame) -> JsResult<ValueVec> {
        let mut all = ValueVec::new();
        cx.or_out_of_memory(all.try_reserve(self.argument_count() + frame.argument_count()))?;
        self.for_each_argument(|argument| all.push(argument));
        cx.or_out_of_memory(all.try_extend_from_slice(frame.arguments()))?;
        Ok(all)
    }
}

fn prefixed(times: usize, name: StringRef) -> StringRef {
    if times == 0 {
        return name;
    }
    let mut builder = StringBuilder::new();
    (0..times).for_each(|_| builder.push_text(names::boundPrefix.text()));
    builder.push_text(name.text());
    builder.finish().unwrap_or_default()
}

/// As a function that wraps `target` reads them. The length is an integer or infinite.
pub(super) fn length_and_name_of(cx: &mut Cx, target: &JsObject) -> JsResult<(f64, Gc<JsString>)> {
    if target.is::<JsFunction>()
        && !(target.shape()).has(ShapeFlags::HAS_ANY_ACCESSOR | ShapeFlags::HAS_FOREIGN_METHODS)
        && let Some(length) = target.get_direct(names::length).and_then(Value::as_int32)
        && let Some(name) = target.get_direct(names::name).and_then(Value::as_string)
    {
        return Ok((length.into(), name));
    }
    let mut length = 0.0;
    if target.has_own_property(cx, names::length)? {
        let value = target.get(cx, names::length)?;
        if value.is_number() {
            length = value.to_integer_or_infinity(cx)?;
        }
    }
    let name = target.get(cx, names::name)?.as_string();
    Ok((length, name.unwrap_or_else(|| cx.small_strings.empty())))
}

#[native_abi]
fn call(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let bound = frame.callee().cast::<JsBoundFunction>();
    let target = bound.target_function.into();
    if bound.argument_count == 0 {
        return cx.call(target, bound.bound_this, frame.arguments());
    }
    let arguments = bound.all_arguments(cx, frame)?;
    cx.call(target, bound.bound_this, &arguments)
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let bound = frame.callee().cast::<JsBoundFunction>();
    let target = bound.target_function.into();
    if !bound.can_construct {
        return Err(errors::throw_entered_as_constructor(cx, bound.upcast()));
    }
    let new_target = if frame.new_target() == bound.into() {
        target
    } else {
        frame.new_target()
    };
    let arguments = bound.all_arguments(cx, frame)?;
    cx.construct(target, &arguments, new_target).map(Into::into)
}
