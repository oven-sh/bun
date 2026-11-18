//! The two slots of an import have the environment of the module that declares the binding and the index of its slot.
//! Otherwise the second is no number.

use bun_engine_bytecode::{SlotKind, Unresolved};
use bun_engine_macros::cell;
use bun_engine_text::{Identifier, PropertyName, names, private_names};

use crate::{
    AbstractModuleRecord, Cx, Environment, Gc, JsCell, JsFunction, JsResult, ModuleEnvironment,
    ModuleNamespace, ScopeTemplate, SourceTextModuleRecord, TypeFlags, Value, Vm,
};

#[cell(flags = TypeFlags::SHAPE_IS_IMMORTAL)]
struct LiveImport {
    base: JsCell,
    module: Gc<AbstractModuleRecord>,
    name: Identifier,
    is_reexported: bool,
}

impl ModuleEnvironment {
    pub(crate) const EXTRA_SLOTS: u32 = 2;

    /// # Safety
    /// As for `Environment::create`, of the scope of a module.
    pub(super) unsafe fn create(
        cx: &Cx,
        parent: Gc<JsCell>,
        template: Gc<ScopeTemplate>,
        module: &AbstractModuleRecord,
    ) -> Gc<ModuleEnvironment> {
        // SAFETY: the caller's.
        let environment = unsafe { Environment::create(cx, &cx.global(), parent, template) };
        let environment = environment.cast::<ModuleEnvironment>();
        // SAFETY: what the slot is for.
        unsafe { environment.set(environment.namespace_slot() - 1, Some(module.into())) };
        if let Some(namespace) = module.created_namespace() {
            environment.set_namespace(namespace);
        }
        module.set_created_environment(Some(environment));
        environment
    }

    pub fn module(&self) -> Gc<AbstractModuleRecord> {
        let module = self.get(self.namespace_slot() - 1);
        module.expect("set when it is made").cast()
    }

    fn namespace_slot(&self) -> u32 {
        self.template().slot_count() - 1
    }

    pub(super) fn set_namespace(&self, namespace: Gc<ModuleNamespace>) {
        // SAFETY: what the slot is for.
        unsafe { self.set(self.namespace_slot(), Some(namespace.into())) };
    }

    /// For the name of a `ResolvedBinding`.
    pub fn slot_of_binding(&self, name: PropertyName<'_>) -> Option<u32> {
        use SlotKind::{Const, LazyFunction, Let, Variable};
        if name == private_names::starNamespace {
            return Some(self.namespace_slot());
        }
        let is_default = name == private_names::starDefault;
        let name = if is_default {
            names::starDefaultText
        } else {
            name
        };
        let template = self.template();
        let slot = template.scope().find(name)?;
        matches!(slot.kind, Variable | Let | Const | LazyFunction).then_some(slot.index)
    }

    /// `None` before it is initialized.
    pub fn read_variable(&self, vm: &Vm, index: u32) -> Option<Value> {
        self.get(index).or_else(|| self.create_function(vm, index))
    }

    /// InstantiateFunctionObject, for a declaration that nothing has referred to so far.
    fn create_function(&self, vm: &Vm, index: u32) -> Option<Value> {
        let template = self.template();
        let slot =
            (template.scope().slot_at(index)).filter(|it| it.kind == SlotKind::LazyFunction)?;
        let module = self.module().cast::<SourceTextModuleRecord>();
        let executable = module.executable()?.lazy_function(vm, slot.function());
        let shape = JsFunction::shape_for(vm, &*self.shape().global()?, &executable);
        // SAFETY: declared in this scope, and what the slot is for.
        unsafe {
            let function =
                JsFunction::create_with_shape(vm, executable, self.as_cell().into(), shape);
            self.set(index, Some(function.into()));
            Some(function.into())
        }
    }

    /// Fills an empty slot, if it is one of those that get their value when they are first read.
    pub(crate) fn create_on_demand(&self, cx: &mut Cx, index: u32) -> JsResult<Option<Value>> {
        let template = self.template();
        match template.scope().slot_at(index) {
            Some(slot) if slot.kind == SlotKind::ImportMeta => {
                let module = self.module().cast::<SourceTextModuleRecord>();
                Ok(module.import_meta(cx)?.map(Value::from))
            }
            _ => Ok(self.create_function(cx, index)),
        }
    }

    /// CreateImportBinding
    pub(super) fn bind_import(&self, slot: u32, target: Gc<ModuleEnvironment>, index: u32) {
        // SAFETY: what the slots are for.
        unsafe {
            self.set(slot, Some(target.into()));
            self.set(slot + 1, Some(Value::int32(index as i32)));
        }
    }

    pub(super) fn bind_live_import(
        &self,
        vm: &Vm,
        slot: u32,
        binding: crate::ResolvedBinding,
        is_reexported: bool,
    ) {
        let import = vm.allocate::<LiveImport>(LiveImportInit {
            base: vm.shape_for::<LiveImport>(),
            module: binding.module,
            name: binding.name,
            is_reexported,
        });
        // SAFETY: as above.
        unsafe {
            self.set(slot, Some(import.into()));
            self.set(slot + 1, None);
        }
    }

    /// Where the value of an import is, if it is in a slot.
    #[inline]
    pub fn import_target(&self, slot: u32) -> Option<(Gc<ModuleEnvironment>, u32)> {
        let index = self.get(slot + 1)?.as_index_int32()?;
        Some((self.get(slot)?.cast(), index))
    }

    /// Whether the code that runs in this environment runs in no other instance of the scope.
    pub fn is_only_instance(&self) -> bool {
        let module = self.module().cast::<SourceTextModuleRecord>();
        module.executable().is_some_and(|it| !it.is_shareable())
    }

    /// The instruction `get_import`.
    pub fn get_import(&self, cx: &mut Cx, slot: u32) -> JsResult<Value> {
        if let Some((target, index)) = self.import_target(slot) {
            if let Some(value) = target.read_variable(cx, index) {
                return Ok(value);
            }
        } else if let Some(import) = self.get(slot).and_then(Value::downcast::<LiveImport>) {
            let (module, name) = (import.module, import.name.clone());
            if import.is_reexported {
                return module.get_reexported_live_export(cx, name.name());
            }
            return module.get_live_export(cx, name.name());
        }
        let template = self.template();
        let name = (template.scope()).name_of(template.scope().slot_at(slot).expect("an import"));
        if self.get(slot).is_some() {
            return Err(crate::errors::throw_uninitialized_variable(cx, name.name()));
        }
        // It named a type, which hides no value.
        let holder = cx.resolve_dynamic(self.parent(), name.name())?;
        cx.get_dynamic(holder, name.name(), Unresolved::Throw, true)
    }
}
