//! The scopes that exist at run time. A chain of them ends in a global object.

mod cache;
mod dynamic;
mod variables;

use core::mem::offset_of;
use core::ops::Deref;
use std::rc::Rc;

use bun_engine_bytecode::{ScopeKind, SlotFlags, SlotKind, StaticScope};
use bun_engine_macros::cell;
use bun_engine_text::PropertyName;

pub(crate) use cache::EvalVariableNames;
pub use dynamic::dynamic_this;
pub(crate) use variables::VariableScope;

use crate::heap::{HeapAnalyzer, Never, Owned, visit_children_of};
use crate::{
    CellKind, CellType, CellTypeRange, Class, ClassOps, Cx, Extends, Field, Gc, GcFree,
    GlobalObject, InlineWatchpointSet, JsCell, JsObject, ScriptExecutable, Shape, ShapeSpec, Trace,
    TypeFlags, Value, Visitor, Vm, WatchpointState, WeakField, ascii_literal,
};

/// What the instances of a scope that one code block makes have in common.
#[cell(name = "SymbolTable", cell_type = ScopeTemplate, flags = TypeFlags::SHAPE_IS_IMMORTAL,
    export = "engine_class_ScopeTemplate")]
pub struct ScopeTemplate {
    base: JsCell,
    slot_count: u32,
    undefined_slots: u32,
    /// Valid while there has been at most one instance.
    singleton_watchpoints: InlineWatchpointSet,
    pub(self) first_instance: WeakField<Option<Gc<Environment>>>,
    /// Valid while nothing but the code of the scope has written to an instance. `SlotFlags` tell what that code does.
    foreign_write_watchpoints: InlineWatchpointSet,
    /// The code that the scope is in, if that has debug hooks.
    pub owner: Field<Option<Gc<ScriptExecutable>>>,
    scope: Rc<StaticScope>,
}

impl ScopeTemplate {
    pub const OFFSET_OF_SLOT_COUNT: usize = offset_of!(ScopeTemplate, slot_count);
    pub const OFFSET_OF_SINGLETON_WATCHPOINTS: usize =
        offset_of!(ScopeTemplate, singleton_watchpoints);

    pub fn create(vm: &Vm, scope: Rc<StaticScope>) -> Gc<ScopeTemplate> {
        vm.allocate::<ScopeTemplate>(ScopeTemplateInit {
            base: vm.shapes.scope_template(),
            slot_count: match scope.kind() {
                ScopeKind::With => 1,
                ScopeKind::Module => scope.slot_count() + ModuleEnvironment::EXTRA_SLOTS,
                _ => scope.slot_count(),
            },
            undefined_slots: scope.undefined_slots(),
            singleton_watchpoints: InlineWatchpointSet::new(WatchpointState::Clear),
            first_instance: None,
            foreign_write_watchpoints: InlineWatchpointSet::new(WatchpointState::Watched),
            owner: None,
            scope,
        })
    }

    #[inline(always)]
    pub fn scope(&self) -> &Rc<StaticScope> {
        &self.scope
    }

    #[inline(always)]
    pub fn slot_count(&self) -> u32 {
        self.slot_count
    }

    #[inline(always)]
    pub fn undefined_slots(&self) -> u32 {
        self.undefined_slots
    }

    pub fn singleton(&self) -> Option<Gc<Environment>> {
        self.first_instance()
    }

    #[inline(always)]
    pub fn singleton_watchpoints(&self) -> &InlineWatchpointSet {
        &self.singleton_watchpoints
    }

    pub fn foreign_write_watchpoints(&self) -> &InlineWatchpointSet {
        &self.foreign_write_watchpoints
    }

    #[inline(never)]
    fn did_create(&self, vm: &Vm, instance: Gc<Environment>) {
        let is_first = self.singleton_watchpoints.state() == WatchpointState::Clear;
        self.set_first_instance(is_first.then_some(instance));
        self.singleton_watchpoints.touch(vm);
    }
}

/// The slots follow.
#[repr(C)]
pub struct Environment {
    base: JsCell,
    parent: Gc<JsCell>,
    template: Gc<ScopeTemplate>,
}

#[unsafe(export_name = "engine_class_Environment")]
static ENVIRONMENT_CLASS: Class = Class::new::<Environment>(
    ascii_literal!("JSLexicalEnvironment"),
    None,
    CellTypeRange::new(CellType::Environment, CellType::WithScope),
);

impl !GcFree for Environment {}

impl Deref for Environment {
    type Target = JsCell;

    #[inline(always)]
    fn deref(&self) -> &JsCell {
        &self.base
    }
}

// SAFETY: starts with a `JsCell`.
unsafe impl Extends<JsCell> for Environment {}

unsafe extern "C" fn analyze_heap(cell: &JsCell, analyzer: &mut HeapAnalyzer) {
    let environment = Gc::from(cell).cast::<Environment>();
    let scope = environment.template.scope();
    for (index, field) in (0..).zip(environment.fields()) {
        let Some(value) = field.get().and_then(Value::as_cell) else {
            continue;
        };
        match scope
            .slot_at(index)
            .filter(|it| it.kind != SlotKind::Import)
        {
            Some(slot) => analyzer.variable_edge(cell.into(), value, scope.name_of(slot).name()),
            None => analyzer.edge(cell.into(), value),
        }
    }
}

// SAFETY: visits the slots too.
unsafe impl CellKind for Environment {
    type Base = JsCell;
    type Init = Never;

    const CLASS: &'static Class = &ENVIRONMENT_CLASS;
    const CELL_TYPE: CellType = CellType::Environment;
    const FLAGS: TypeFlags = TypeFlags::empty();
    const HOLDS_CLASS: bool = false;
    const OPS: ClassOps = {
        let mut ops = JsCell::OPS;
        ops.visit_children = visit_children_of::<Environment>;
        ops.analyze_heap = analyze_heap;
        ops
    };

    #[inline(always)]
    fn is(cell: &JsCell) -> bool {
        Self::CLASS.types().contains(cell.cell_type())
    }

    fn shape_of(init: &Never) -> Gc<Shape> {
        match *init {}
    }

    unsafe fn initialize(_: *mut Environment, init: Never) {
        match init {}
    }

    #[inline]
    fn trace_fields(&self, visitor: &mut Visitor) {
        self.base.trace_fields(visitor);
        self.parent.trace(visitor);
        self.template.trace(visitor);
        for field in self.fields() {
            // SAFETY: the environment keeps it alive.
            unsafe { visitor.append_hidden_word(field.word_concurrently()) };
        }
    }
}

impl Environment {
    pub const OFFSET_OF_PARENT: usize = offset_of!(Environment, parent);
    pub const OFFSET_OF_TEMPLATE: usize = offset_of!(Environment, template);
    pub const OFFSET_OF_SLOTS: usize = size_of::<Environment>();

    #[inline(always)]
    pub const fn allocation_size(slot_count: u32) -> usize {
        Self::OFFSET_OF_SLOTS + slot_count as usize * size_of::<u64>()
    }

    pub fn create_shapes(cx: &Cx) {
        let global = cx.global();
        let shape = |spec| Shape::create(cx, Some(global), Value::NULL, spec);
        let spec = ShapeSpec::of::<Environment>();
        global.init_environment_shape(shape(spec));
        global.init_with_scope_shape(shape(spec.with_type(CellType::WithScope)));
        global.init_module_environment_shape(shape(ShapeSpec::of::<ModuleEnvironment>()));
    }

    /// The slots are not initialized.
    #[inline(always)]
    unsafe fn allocate(
        vm: &Vm,
        shape: Gc<Shape>,
        parent: Gc<JsCell>,
        template: Gc<ScopeTemplate>,
    ) -> (Gc<Environment>, *mut u64) {
        debug_assert!(is_instance_of(parent, template.scope.parent()));
        let address = vm.allocate_cell_memory(Self::allocation_size(template.slot_count));
        let cell = core::ptr::with_exposed_provenance_mut::<Environment>(address);
        // SAFETY: a new cell of that size.
        unsafe {
            JsCell::initialize(cell.cast(), shape);
            (&raw mut (*cell).parent).write(parent);
            (&raw mut (*cell).template).write(template);
            (Gc::from_address(address), cell.add(1).cast())
        }
    }

    #[inline(always)]
    fn did_initialize(&self, vm: &Vm) {
        if self.template.singleton_watchpoints.is_still_valid() {
            self.template.did_create(vm, self.into());
        }
    }

    /// # Safety
    /// `shape` is one of an environment, and `parent` is an instance of the parent of the scope.
    #[inline(always)]
    pub unsafe fn create_with_shape(
        vm: &Vm,
        shape: Gc<Shape>,
        parent: Gc<JsCell>,
        template: Gc<ScopeTemplate>,
    ) -> Gc<Environment> {
        // SAFETY: all slots are written.
        unsafe {
            let (environment, slots) = Self::allocate(vm, shape, parent, template);
            for index in 0..template.slot_count {
                let is_undefined = index < template.undefined_slots;
                let word = Value::bits_of(is_undefined.then_some(Value::UNDEFINED));
                slots.add(index as usize).write(word);
            }
            environment.did_initialize(vm);
            environment
        }
    }

    /// # Safety
    /// `parent` is an instance of the parent of the scope.
    #[inline]
    pub unsafe fn create(
        vm: &Vm,
        global: &GlobalObject,
        parent: Gc<JsCell>,
        template: Gc<ScopeTemplate>,
    ) -> Gc<Environment> {
        let shape = match template.scope.kind() {
            ScopeKind::Module => global.module_environment_shape(),
            ScopeKind::With => global.with_scope_shape(),
            _ => global.environment_shape(),
        };
        // SAFETY: the caller's.
        unsafe { Self::create_with_shape(vm, shape, parent, template) }
    }

    /// The instruction `create_with_scope`, after ToObject.
    ///
    /// # Safety
    /// As for `create`, of a `with` scope.
    pub unsafe fn create_with(
        vm: &Vm,
        parent: Gc<JsCell>,
        template: Gc<ScopeTemplate>,
        object: Gc<JsObject>,
    ) -> Gc<Environment> {
        debug_assert!(template.scope.kind() == ScopeKind::With);
        let shape = realm_of_scope(parent).with_scope_shape();
        // SAFETY: the one slot is written.
        unsafe {
            let (environment, slots) = Self::allocate(vm, shape, parent, template);
            slots.write(object.as_value().to_bits());
            environment.did_initialize(vm);
            environment
        }
    }

    /// A `with` scope that is not in the source of anything.
    pub fn create_for_object(vm: &Vm, parent: Gc<JsCell>, object: Gc<JsObject>) -> Gc<Environment> {
        let template = ScopeTemplate::create(vm, StaticScope::with(static_scope_of(parent)));
        // SAFETY: made for this parent.
        unsafe { Self::create_with(vm, parent, template, object) }
    }

    /// For code that is to have that `this`.
    pub(crate) fn create_for_this(
        vm: &Vm,
        parent: Gc<JsCell>,
        this: Option<Value>,
    ) -> Gc<Environment> {
        let template = ScopeTemplate::create(vm, StaticScope::for_this(static_scope_of(parent)));
        // SAFETY: made for this parent, and what the slot is for.
        unsafe {
            let environment = Self::create(vm, &realm_of_scope(parent), parent, template);
            environment.set(0, this);
            environment
        }
    }

    pub fn copy(&self, vm: &Vm) -> Gc<Environment> {
        // SAFETY: all slots are written.
        unsafe {
            let (copy, slots) = Self::allocate(vm, self.shape(), self.parent, self.template);
            let fields = self.fields();
            core::ptr::copy_nonoverlapping(fields.as_ptr().cast(), slots, fields.len());
            copy.did_initialize(vm);
            copy
        }
    }

    /// Another environment, or the global object.
    #[inline(always)]
    pub fn parent(&self) -> Gc<JsCell> {
        self.parent
    }

    #[inline(always)]
    pub fn template(&self) -> Gc<ScopeTemplate> {
        self.template
    }

    #[inline(always)]
    fn fields(&self) -> &[Field<Option<Value>>] {
        let first = core::ptr::with_exposed_provenance(self.address() + Self::OFFSET_OF_SLOTS);
        // SAFETY: allocated with that many.
        unsafe { core::slice::from_raw_parts(first, self.template.slot_count as usize) }
    }

    /// # Safety
    /// There is such a slot.
    #[inline(always)]
    pub unsafe fn slot_unchecked(&self, index: u32) -> &Field<Option<Value>> {
        debug_assert!(self.is::<Environment>() && index < self.template.slot_count);
        let address = self.address() + Self::allocation_size(index);
        // SAFETY: the caller's.
        unsafe { &*core::ptr::with_exposed_provenance(address) }
    }

    /// Panics if there is no such slot.
    #[inline(always)]
    pub fn get(&self, index: u32) -> Option<Value> {
        self.fields()[index as usize].get()
    }

    /// # Safety
    /// The code that uses the slot expects such a value, and does not count on its staying as it is.
    #[inline(always)]
    pub unsafe fn set(&self, index: u32, value: Option<Value>) {
        // SAFETY: the environment traces its slots.
        unsafe { Owned::new(self, self.fields()) }.set(index as usize, value);
    }

    /// What the slot has from now on, while `foreign_write_watchpoints` of the template are valid.
    pub fn settled_value(&self, index: u32) -> Option<Value> {
        let flags = self.template.scope.slot_at(index)?.flags;
        let is_settled = flags.intersects(SlotFlags::IMMUTABLE | SlotFlags::WRITTEN_ONCE);
        (self.get(index)).filter(|value| is_settled && !value.is_undefined())
    }

    /// For the embedder and the debugger, to which nothing is constant. False unless there is such a variable.
    pub fn overwrite(&self, vm: &Vm, name: PropertyName<'_>, value: Value) -> bool {
        use SlotKind::{Callee, Const, LazyFunction, Let, Variable};
        let slot = self.template.scope.find(name);
        let Some(slot) =
            slot.filter(|it| matches!(it.kind, Variable | Let | Const | Callee | LazyFunction))
        else {
            return false;
        };
        // SAFETY: code takes it for any value, and is told of the change.
        unsafe { self.set(slot.index, Some(value)) };
        self.template.foreign_write_watchpoints.invalidate(vm);
        true
    }

    /// Of a `with` scope.
    pub fn with_object(&self) -> Option<Gc<JsObject>> {
        if self.cell_type() != CellType::WithScope {
            return None;
        }
        self.get(0)?.as_object()
    }

    /// This one and the environments around it.
    pub fn chain(&self) -> impl Iterator<Item = Gc<Environment>> + use<> {
        core::iter::successors(Some(Gc::from(self)), |it| it.parent.downcast())
    }
}

/// After the slots of the scope come the record and the namespace object.
#[cell(name = "JSModuleEnvironment", cell_type = ModuleEnvironment, export = "engine_class_ModuleEnvironment")]
pub struct ModuleEnvironment {
    base: Environment,
}

#[inline(always)]
pub fn realm_of_scope(scope: Gc<JsCell>) -> Gc<GlobalObject> {
    scope.shape().global().expect("a scope belongs to a realm")
}

/// Whether code that was compiled against `expected` can run in `scope`.
pub fn is_instance_of(scope: Gc<JsCell>, expected: Option<&Rc<StaticScope>>) -> bool {
    let environment = scope.downcast::<Environment>();
    environment.map(|it| Rc::as_ptr(&it.template.scope)) == expected.map(Rc::as_ptr)
}

/// The same, of each scope from there to the global one.
pub(crate) fn is_chain_of(mut scope: Gc<JsCell>, mut expected: Option<&Rc<StaticScope>>) -> bool {
    while let Some(next) = expected.filter(|_| is_instance_of(scope, expected)) {
        (scope, expected) = (scope.cast::<Environment>().parent, next.parent());
    }
    expected.is_none() && scope.is::<GlobalObject>()
}

/// What code that is compiled to run in `scope` is compiled against.
pub fn static_scope_of(scope: Gc<JsCell>) -> Option<Rc<StaticScope>> {
    let environment = scope.downcast::<Environment>()?;
    Some(Rc::clone(environment.template.scope()))
}
