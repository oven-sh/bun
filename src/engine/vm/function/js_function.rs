use core::mem::offset_of;

use bun_engine_bytecode::{FunctionKind, Specialization, Visibility};
use bun_engine_macros::{cell, native_abi, object_ops};
use bun_engine_text::{PropertyName, StringRef, Text, names};

use crate::call::native_not_a_constructor;
use crate::code::native_source_text;
use crate::{
    Attributes, CallData, CellType, CustomGetterSetter, Cx, DeletePropertySlot, DontEnumMode,
    Executable, Field, FunctionExecutable, FunctionRareData, Gc, GlobalObject, InternalFunction,
    Intrinsic, JsBoundFunction, JsCell, JsObject, JsObjectInit, JsRemoteFunction, JsResult,
    JsString, JsSymbol, NativeExecutable, NativeFunction, PropertyDescriptor, PropertyNameList,
    PropertySlot, PutPropertySlot, ScriptExecutable, Shape, ShapeFlags, TypeFlags, Value, Vm,
    scope::{is_instance_of, realm_of_scope},
};

/// `length`, `name` and `prototype` are defined when something asks for them.
#[cell(name = "Function", cell_type = Function, ops, export = "engine_class_Function",
    flags = TypeFlags::IMPLEMENTS_HAS_INSTANCE.union(TypeFlags::IMPLEMENTS_DEFAULT_HAS_INSTANCE))]
pub struct JsFunction {
    base: JsObject,
    /// Of a native function, the global object.
    scope: Gc<JsCell>,
    pub(super) target: Field<Gc<Executable>>,
}

/// What the frame of a script, a module or `eval` code has for a callee.
#[cell(name = "Callee", cell_type = Callee)]
pub struct JsCallee {
    base: JsObject,
    scope: Gc<JsCell>,
    target: Gc<Executable>,
}

const _: () = {
    assert!(offset_of!(JsCallee, scope) == JsFunction::OFFSET_OF_SCOPE);
    assert!(offset_of!(JsCallee, target) == JsFunction::OFFSET_OF_EXECUTABLE);
};

impl JsCallee {
    pub(crate) fn create(
        cx: &Cx,
        executable: Gc<ScriptExecutable>,
        scope: Gc<JsCell>,
    ) -> Gc<JsCallee> {
        cx.allocate::<JsCallee>(JsCalleeInit {
            base: JsObjectInit::new(cx, cx.global().callee_shape()),
            scope,
            target: executable.upcast(),
        })
    }

    /// For the frames of closures that optimized code runs without having made them.
    pub fn create_absent(cx: &Cx) -> Gc<JsCallee> {
        cx.allocate::<JsCallee>(JsCalleeInit {
            base: JsObjectInit::new(cx, cx.global().callee_shape()),
            scope: cx.global().cell(),
            target: cx.array_prototype_values().executable(),
        })
    }
}

const NAME_AND_LENGTH: Attributes = Attributes::DONT_ENUM.union(Attributes::READ_ONLY);
const PROTOTYPE: Attributes = Attributes::DONT_ENUM.union(Attributes::DONT_DELETE);

#[object_ops(export = "engine_Function")]
impl JsFunction {
    fn call_data(&self) -> CallData {
        CallData::of_function(self.into(), Specialization::Call)
    }

    fn construct_data(&self) -> CallData {
        CallData::of_function(self.into(), Specialization::Construct)
    }

    fn get_own_property_slot(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        self.reify_lazy_property(cx, name)?;
        self.ordinary_get_own_property_slot(cx, name, slot)
    }

    fn own_special_property_names(
        &self,
        cx: &mut Cx,
        list: &mut PropertyNameList,
        mode: DontEnumMode,
    ) -> JsResult<()> {
        for name in [names::length, names::name] {
            self.reify_lazy_property(cx, name)?;
            let found = self.shape().get(name);
            if found.is_some_and(|(_, attributes)| mode.includes(attributes)) {
                list.add(name);
            }
        }
        if mode == DontEnumMode::Include && self.has_prototype_by_kind() {
            list.add(names::prototype);
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
        if name == names::prototype {
            slot.disable_caching();
            if slot.is_receiver(self) {
                self.will_change_prototype_property(cx);
                if self.has_lazy_prototype() {
                    self.put_direct(cx, name, value, PROTOTYPE);
                    return Ok(true);
                }
            }
        }
        if self.reify_lazy_property(cx, name)? {
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
        if self.reify_lazy_property(cx, name)? {
            slot.disable_caching();
        }
        if name == names::prototype {
            self.will_change_prototype_property(cx);
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
        if name == names::prototype {
            self.will_change_prototype_property(cx);
        }
        self.reify_lazy_property(cx, name)?;
        self.ordinary_define_own_property(cx, name, descriptor, should_throw)
    }

    fn prevent_extensions(&self, cx: &mut Cx) -> JsResult<bool> {
        for name in [names::length, names::name, names::prototype] {
            self.reify_lazy_property(cx, name)?;
        }
        self.ordinary_prevent_extensions(cx);
        Ok(true)
    }
}

impl JsFunction {
    pub const OFFSET_OF_SCOPE: usize = offset_of!(JsFunction, scope);
    pub const OFFSET_OF_EXECUTABLE: usize = offset_of!(JsFunction, target);

    /// For a type that extends this one.
    pub fn native_init(
        cx: &Cx,
        shape: Gc<Shape>,
        executable: Gc<NativeExecutable>,
    ) -> JsFunctionInit {
        JsFunctionInit {
            base: JsObjectInit::new(cx, shape),
            scope: cx.global().cell(),
            target: executable.upcast(),
        }
    }

    /// For a constructor of the library that is written in JavaScript and extends this type.
    /// `finish_builtin_constructor` follows.
    pub fn builtin_init(
        cx: &Cx,
        shape: Gc<Shape>,
        executable: Gc<FunctionExecutable>,
    ) -> JsFunctionInit {
        assert!(executable.info().has_no_outer_scope());
        JsFunctionInit {
            base: JsObjectInit::new(cx, shape),
            scope: cx.global().cell(),
            target: executable.upcast(),
        }
    }

    pub fn finish_builtin_constructor(&self, vm: &Vm, prototype: &JsObject) {
        self.executable()
            .cast::<FunctionExecutable>()
            .did_create(vm, self.into());
        self.link_with_prototype(vm, prototype);
    }

    #[inline(always)]
    pub fn shape_for(vm: &Vm, global: &GlobalObject, executable: &FunctionExecutable) -> Gc<Shape> {
        // SAFETY: a slot that has a shape.
        unsafe { global.slot(vm, executable.shape_slot()).cast_unchecked() }
    }

    /// # Safety
    /// `scope` is an instance of the scope that the code was written in.
    #[inline]
    pub unsafe fn create(
        cx: &Cx,
        executable: Gc<FunctionExecutable>,
        scope: Gc<JsCell>,
    ) -> Gc<JsFunction> {
        let shape = Self::shape_for(cx, &cx.global(), &executable);
        // SAFETY: the caller's.
        unsafe { Self::create_with_shape(cx, executable, scope, shape) }
    }

    /// # Safety
    /// As for `create`.
    #[inline(always)]
    pub unsafe fn create_with_shape(
        vm: &Vm,
        executable: Gc<FunctionExecutable>,
        scope: Gc<JsCell>,
        shape: Gc<Shape>,
    ) -> Gc<JsFunction> {
        debug_assert!(is_instance_of(scope, executable.info().outer_scope()));
        let function = vm.allocate::<JsFunction>(JsFunctionInit {
            base: JsObjectInit::new(vm, shape),
            scope,
            target: executable.upcast(),
        });
        executable.did_create(vm, function);
        function
    }

    /// A function of the library that is written in JavaScript.
    pub fn builtin(cx: &Cx, executable: Gc<FunctionExecutable>) -> Gc<JsFunction> {
        assert!(executable.info().has_no_outer_scope());
        // SAFETY: it refers to nothing but globals.
        unsafe { Self::create(cx, executable, cx.global().cell()) }
    }

    pub fn native(
        cx: &Cx,
        length: u32,
        name: &StringRef,
        function: NativeFunction,
    ) -> Gc<JsFunction> {
        Self::native_with_intrinsic(cx, length, name, function, Intrinsic::None)
    }

    pub fn native_with_intrinsic(
        cx: &Cx,
        length: u32,
        name: &StringRef,
        function: NativeFunction,
        intrinsic: Intrinsic,
    ) -> Gc<JsFunction> {
        let (constructor, visibility) = (native_not_a_constructor, Visibility::Public);
        Self::native_with(
            cx,
            length,
            name,
            function,
            constructor,
            intrinsic,
            visibility,
        )
    }

    pub fn native_with(
        cx: &Cx,
        length: u32,
        name: &StringRef,
        function: NativeFunction,
        constructor: NativeFunction,
        intrinsic: Intrinsic,
        visibility: Visibility,
    ) -> Gc<JsFunction> {
        let name = name.clone();
        let executable = NativeExecutable::shared(
            cx,
            length,
            name,
            function,
            constructor,
            intrinsic,
            visibility,
        );
        let shape = cx.global().native_function_shape();
        cx.allocate::<JsFunction>(Self::native_init(cx, shape, executable))
    }

    /// # Safety
    /// A `JsFunction`, an `InternalFunction` or a `JsCallee`.
    #[inline(always)]
    pub unsafe fn executable_or_rare_data(callee: Gc<JsCell>) -> Gc<Executable> {
        // SAFETY: all have it at the same offset.
        unsafe { callee.cast_unchecked::<JsFunction>() }.target()
    }

    /// # Safety
    /// As above.
    #[inline(always)]
    pub unsafe fn executable_of(callee: Gc<JsCell>) -> Gc<Executable> {
        // SAFETY: as above.
        unsafe { callee.cast_unchecked::<JsFunction>() }.executable()
    }

    /// # Safety
    /// As above.
    #[inline(always)]
    pub unsafe fn scope_of(callee: Gc<JsCell>) -> Gc<JsCell> {
        // SAFETY: as above.
        unsafe { callee.cast_unchecked::<JsFunction>() }.scope
    }

    #[inline(always)]
    pub fn scope(&self) -> Gc<JsCell> {
        self.scope
    }

    /// `[[Realm]]`
    #[inline]
    pub fn function_realm(&self) -> Gc<GlobalObject> {
        realm_of_scope(self.scope)
    }

    #[inline(always)]
    pub fn rare_data(&self) -> Option<Gc<FunctionRareData>> {
        self.target().downcast()
    }

    pub fn ensure_rare_data(&self, vm: &Vm) -> Gc<FunctionRareData> {
        self.rare_data().unwrap_or_else(|| {
            let rare_data = FunctionRareData::create(vm, self.target());
            self.set_target(rare_data.upcast());
            rare_data
        })
    }

    #[inline(always)]
    pub fn executable(&self) -> Gc<Executable> {
        match self.rare_data() {
            Some(rare_data) => rare_data.executable(),
            None => self.target(),
        }
    }

    #[inline(always)]
    pub fn script_executable(&self) -> Option<Gc<FunctionExecutable>> {
        self.executable().downcast()
    }

    #[inline(always)]
    pub fn native_executable(&self) -> Option<Gc<NativeExecutable>> {
        self.executable().downcast()
    }

    pub fn is_native(&self) -> bool {
        self.executable().is_native()
    }

    pub fn is_native_or_builtin(&self) -> bool {
        self.script_executable().is_none_or(|it| it.is_builtin())
    }

    pub fn is_class_constructor(&self) -> bool {
        self.script_executable()
            .is_some_and(|it| it.info().kind().is_class_constructor())
    }

    pub fn intrinsic(&self) -> Intrinsic {
        self.executable().intrinsic()
    }

    fn has_prototype_by_kind(&self) -> bool {
        self.script_executable()
            .is_some_and(|it| !it.is_builtin() && it.has_prototype_property())
    }

    fn has_lazy_prototype(&self) -> bool {
        self.has_prototype_by_kind() && self.shape().get(names::prototype).is_none()
    }

    fn will_change_prototype_property(&self, vm: &Vm) {
        if let Some(rare_data) = self.rare_data() {
            rare_data.clear(vm);
        }
    }

    pub fn has_reified_length(&self) -> bool {
        self.shape().has(ShapeFlags::HAS_REIFIED_LENGTH)
    }

    pub fn has_reified_name(&self) -> bool {
        self.shape().has(ShapeFlags::HAS_REIFIED_NAME)
    }

    /// Whether reading `length` and `name` would give `original_length` and `original_name`.
    #[inline]
    pub fn has_original_length_and_name(&self) -> bool {
        !(self.shape()).has(ShapeFlags::HAS_REIFIED_LENGTH | ShapeFlags::HAS_REIFIED_NAME)
    }

    /// For a function whose shape is shared with some that have no `prototype`.
    pub(crate) fn reify_prototype(&self, vm: &Vm) {
        if self.has_lazy_prototype() {
            let prototype = self.create_prototype(vm).into();
            self.put_direct(vm, names::prototype, prototype, PROTOTYPE);
        }
    }

    /// Whether it has just been defined.
    #[inline(always)]
    fn reify_lazy_property(&self, cx: &Cx, name: PropertyName<'_>) -> JsResult<bool> {
        if name == names::prototype || name == names::length || name == names::name {
            return self.reify_lazy_property_slow(cx, name);
        }
        Ok(false)
    }

    #[inline(never)]
    fn reify_lazy_property_slow(&self, cx: &Cx, name: PropertyName<'_>) -> JsResult<bool> {
        if name == names::prototype && self.has_lazy_prototype() {
            self.reify_prototype(cx);
        } else if name == names::length && !self.has_reified_length() {
            self.put_direct(cx, name, self.original_length().into(), NAME_AND_LENGTH);
        } else if name == names::name && !self.has_reified_name() {
            self.reify_name(cx)?;
        } else {
            return Ok(false);
        }
        Ok(true)
    }

    fn reify_name(&self, cx: &Cx) -> JsResult<()> {
        if (self.native_executable()).is_some_and(|it| it.is_named_as_bound().get()) {
            // What looks for a name that the program has given to the function finds none.
            let custom = CustomGetterSetter::create(cx, Some(get_original_name), None, None);
            self.put_direct_custom(cx, names::name, custom, NAME_AND_LENGTH);
        } else {
            let name = self.original_name(cx)?.into();
            self.put_direct(cx, names::name, name, NAME_AND_LENGTH);
        }
        Ok(())
    }

    /// What instances inherit from if `prototype` is no object.
    pub fn default_prototype_for_instances(&self, vm: &Vm) -> Gc<JsObject> {
        let global = self.function_realm();
        match self.script_executable() {
            Some(it) if it.info().is_generator() && it.info().is_async() => {
                global.async_generator_prototype(vm)
            }
            Some(it) if it.info().is_generator() => global.generator_prototype(vm),
            _ => global.object_prototype(),
        }
    }

    fn create_prototype(&self, vm: &Vm) -> Gc<JsObject> {
        let global = self.function_realm();
        let parent = self.default_prototype_for_instances(vm);
        let prototype = global.new_object_with_prototype(vm, parent);
        if parent == global.object_prototype() {
            let this = self.as_value();
            prototype.put_direct(vm, names::constructor, this, Attributes::DONT_ENUM);
        }
        prototype
    }

    pub fn original_length(&self) -> f64 {
        if let Some(executable) = self.script_executable() {
            return executable.info().length().into();
        }
        if let Some(bound) = self.downcast::<JsBoundFunction>() {
            return bound.bound_length();
        }
        if let Some(remote) = self.downcast::<JsRemoteFunction>() {
            return remote.target_length();
        }
        f64::from(self.executable().cast::<NativeExecutable>().length())
    }

    pub fn original_name(&self, cx: &Cx) -> JsResult<Gc<JsString>> {
        if let Some(executable) = self.script_executable() {
            let executable = executable.anchor();
            return match executable.info().kind() {
                FunctionKind::Getter | FunctionKind::Setter => {
                    self.prefixed_name(cx, &[executable.name().text()])
                }
                _ => Ok(JsString::from_impl_cached(cx, executable.name())),
            };
        }
        let prefix = || JsString::from_name(cx, names::boundPrefix);
        if let Some(bound) = self.downcast::<JsBoundFunction>() {
            return JsString::concat(cx, prefix(), bound.target_name(cx));
        }
        if let Some(remote) = self.downcast::<JsRemoteFunction>() {
            return Ok(remote.target_name());
        }
        let executable = self.executable().cast::<NativeExecutable>();
        let name = JsString::from_impl_cached(cx, executable.anchor().name());
        if executable.is_named_as_bound().get() {
            return JsString::concat(cx, prefix(), name);
        }
        Ok(name)
    }

    /// Up to three parts.
    fn prefixed_name(&self, cx: &Cx, parts: &[Text<'_>]) -> JsResult<Gc<JsString>> {
        let (prefix, failure) = match self.script_executable().map(|it| it.info().kind()) {
            Some(FunctionKind::Getter) => ("get ", "Out of memory: Getter name is too long"),
            Some(FunctionKind::Setter) => ("set ", "Out of memory: Setter name is too long"),
            _ => ("", "Out of memory: Function name is too long"),
        };
        let mut all = [Text::EMPTY; 4];
        all[0] = Text::from_ascii(prefix);
        all[1..=parts.len()].copy_from_slice(parts);
        match StringRef::try_concat(&all) {
            Ok(name) => Ok(JsString::new(cx, name)),
            Err(_) => Err(cx.throw_out_of_memory_with(failure)),
        }
    }

    /// SetFunctionName, unless it has a `name` already. `name` is a string, a symbol or a number.
    pub fn set_function_name(&self, cx: &Cx, name: Value) -> JsResult<()> {
        if self.has_reified_name() {
            return Ok(());
        }
        let string = if let Some(symbol) = name.downcast::<JsSymbol>() {
            let (open, close) = (Text::from_ascii("["), Text::from_ascii("]"));
            match symbol.anchor().symbol().description() {
                Some(text) if symbol.name().is_private() => self.prefixed_name(cx, &[text])?,
                Some(text) => self.prefixed_name(cx, &[open, text, close])?,
                None => self.prefixed_name(cx, &[])?,
            }
        } else {
            let name = name.primitive_to_string(cx)?;
            match self.script_executable().map(|it| it.info().kind()) {
                Some(FunctionKind::Getter | FunctionKind::Setter) => {
                    self.prefixed_name(cx, &[name.view(cx)?.text()])?
                }
                _ => name,
            }
        };
        self.put_direct(cx, names::name, string.into(), NAME_AND_LENGTH);
        Ok(())
    }

    /// The name that it was declared with, or that of the target. Allocates nothing in the heap.
    pub fn name(&self) -> StringRef {
        if let Some(executable) = self.script_executable() {
            return executable.declared_name();
        }
        if let Some(bound) = self.downcast::<JsBoundFunction>() {
            return bound.name_without_allocating();
        }
        self.executable().cast::<NativeExecutable>().name().clone()
    }

    /// `Function.prototype.toString`
    pub fn source_text(&self, cx: &Cx) -> JsResult<Gc<JsString>> {
        if let Some(executable) = self.script_executable() {
            return executable.source_text(cx);
        }
        let name = if let Some(bound) = self.downcast::<JsBoundFunction>() {
            bound.target_name(cx)
        } else if let Some(remote) = self.downcast::<JsRemoteFunction>() {
            remote.target_name()
        } else {
            return self.executable().cast::<NativeExecutable>().source_text(cx);
        };
        native_source_text(cx, name.view(cx)?.text())
    }

    /// Whether `prototype` cannot change without `will_change_prototype_property`, and reading it runs no code.
    pub fn can_use_allocation_profile(&self) -> bool {
        let Some(executable) = self.script_executable() else {
            return false;
        };
        executable.has_prototype_property()
            && (!executable.is_builtin()
                || self
                    .shape()
                    .get(names::prototype)
                    .is_some_and(|found| !found.1.intersects(Attributes::ANY_ACCESSOR)))
    }

    /// `can_use_allocation_profile` holds.
    pub(crate) fn prototype_for_construction(&self, vm: &Vm) -> Gc<JsObject> {
        self.reify_prototype(vm);
        self.get_direct(names::prototype)
            .and_then(Value::as_object)
            .unwrap_or_else(|| self.default_prototype_for_instances(vm))
    }
}

#[native_abi]
fn get_original_name(cx: &mut Cx, this: Value, _: PropertyName<'_>) -> JsResult<Value> {
    this.cast::<JsFunction>().original_name(cx).map(Into::into)
}

impl FunctionExecutable {
    pub fn can_suspend(&self) -> bool {
        self.info().is_generator() || self.info().awaits()
    }

    /// Empty if the function only has a name from where it stands.
    pub fn declared_name(&self) -> StringRef {
        if self.info().has_own_name() || self.info().kind() == FunctionKind::Method {
            self.name().clone()
        } else {
            StringRef::empty()
        }
    }

    /// Of an instance to which nothing has been added.
    pub(crate) fn display_name(&self) -> StringRef {
        if self.is_builtin() {
            self.declared_name()
        } else {
            self.name().clone()
        }
    }
}

/// What a stack trace calls a function. Allocates nothing in the heap and runs no code.
pub fn display_name(object: &JsObject) -> StringRef {
    if !CellType::FUNCTIONS.contains(object.cell_type()) {
        return StringRef::empty();
    }
    explicit_name(object).unwrap_or_else(|| implicit_name(object))
}

/// What messages call the instances of a constructor. `None` if it is anonymous or no function.
pub(crate) fn name_for_instances(constructor: &JsObject) -> Option<StringRef> {
    if !CellType::FUNCTIONS.contains(constructor.cell_type()) {
        return None;
    }
    let explicit = explicit_name(constructor).filter(|it| !it.is_empty());
    let name = explicit.unwrap_or_else(|| implicit_name(constructor));
    let function = constructor.downcast::<JsFunction>();
    (!name.is_empty() || function.is_none_or(|it| it.is_native())).then_some(name)
}

fn explicit_name(function: &JsObject) -> Option<StringRef> {
    let name = function.get_direct(names::displayName)?.as_string()?;
    Some(name.to_string_without_collecting())
}

fn implicit_name(function: &JsObject) -> StringRef {
    if let Some(function) = function.downcast::<InternalFunction>() {
        return function.name();
    }
    let function = function.as_object().cast::<JsFunction>();
    (function.script_executable()).map_or_else(|| function.name(), |it| it.display_name())
}

impl JsObject {
    /// Defines `prototype` on a constructor of the library, and `constructor` on the prototype unless that is in its
    /// static table: a script may have got there first.
    pub fn link_with_prototype(&self, vm: &Vm, prototype: &JsObject) {
        self.put_direct(vm, names::prototype, prototype.into(), Attributes::CONSTANT);
        let shape = prototype.shape();
        let table = shape.class().static_table();
        if table.is_none_or(|table| table.find(names::constructor).is_none()) {
            let this = self.as_value();
            prototype.put_direct(vm, names::constructor, this, Attributes::DONT_ENUM);
        }
    }

    /// Defines a method.
    pub fn put_direct_native_function(
        &self,
        cx: &Cx,
        name: PropertyName<'_>,
        length: u32,
        function: NativeFunction,
        intrinsic: Intrinsic,
        attributes: Attributes,
    ) -> Gc<JsFunction> {
        let text = crate::object::function_name("", name);
        let function = JsFunction::native_with_intrinsic(cx, length, &text, function, intrinsic);
        self.put_direct(cx, name, function.into(), attributes);
        function
    }
}
