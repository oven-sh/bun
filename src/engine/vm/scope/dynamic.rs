//! Names that only a search at run time finds. What holds a binding is an environment, the object that has the
//! variables of `eval` code, or the global object.

use bun_engine_bytecode::{Slot, SlotKind, Unresolved};
use bun_engine_text::{PropertyName, symbols};

use crate::caches::{get_megamorphic, has_megamorphic, put_megamorphic};
use crate::code::metadata::ResolveDynamic;
use crate::{
    Attributes, CellType, Cx, Environment, Gc, GlobalLexicals, InternalMethod, JsCell, JsObject,
    JsResult, ModuleEnvironment, PropertySlot, Value, errors,
};

enum Holder {
    Slots(Gc<Environment>),
    With(Gc<JsObject>),
    EvalVariables(Gc<JsObject>),
    Global,
}

impl Holder {
    fn of(cell: Gc<JsCell>) -> Holder {
        if let Some(environment) = cell.downcast::<Environment>() {
            return (environment.with_object()).map_or(Holder::Slots(environment), Holder::With);
        }
        match cell.cell_type() {
            CellType::GlobalObject => Holder::Global,
            _ => Holder::EvalVariables(cell.cast()),
        }
    }
}

/// HasBinding of an Object Environment Record whose `[[IsWithEnvironment]]` is true.
fn with_has_binding(cx: &mut Cx, object: Gc<JsObject>, name: PropertyName<'_>) -> JsResult<bool> {
    if !has_megamorphic(cx, object, name)? {
        return Ok(false);
    }
    match get_megamorphic(cx, object.into(), symbols::unscopables)?.as_object() {
        Some(unscopables) => Ok(!get_megamorphic(cx, unscopables.into(), name)?.to_boolean(cx)),
        None => Ok(true),
    }
}

impl Environment {
    /// What a read of the slot that finds it empty comes to.
    #[cold]
    #[inline(never)]
    pub fn read_empty_slot(&self, cx: &mut Cx, index: u32) -> JsResult<Value> {
        if let Some(module) = self.downcast::<ModuleEnvironment>()
            && let Some(value) = module.create_on_demand(cx, index)?
        {
            return Ok(value);
        }
        let template = self.template();
        let name = (template.scope().slot_at(index)).map(|slot| template.scope().name_of(slot));
        let name = name.as_ref().map_or(PropertyName::EMPTY, |it| it.name());
        Err(errors::throw_uninitialized_variable(cx, name))
    }

    /// The instruction `get_scoped_checked`.
    #[inline(always)]
    pub fn get_checked(&self, cx: &mut Cx, index: u32) -> JsResult<Value> {
        match self.get(index) {
            Some(value) => Ok(value),
            None => self.read_empty_slot(cx, index),
        }
    }

    /// Of one of the slots of its scope. `None` before it is initialized.
    pub fn read_binding(&self, cx: &mut Cx, slot: &Slot) -> JsResult<Option<Value>> {
        let Some(module) = self.downcast::<ModuleEnvironment>() else {
            return Ok(self.get(slot.index));
        };
        if slot.kind != SlotKind::Import {
            return Ok(module.read_variable(cx, slot.index));
        }
        match module.import_target(slot.index) {
            Some((target, index)) => Ok(target.read_variable(cx, index)),
            None if self.get(slot.index).is_none() => Ok(None),
            None => module.get_import(cx, slot.index).map(Some),
        }
    }

    fn get_named(&self, cx: &mut Cx, name: PropertyName<'_>) -> JsResult<Value> {
        let slot = *(self.template().scope().find(name)).expect("where it was resolved");
        if slot.kind == SlotKind::Import {
            let module = Gc::from(self).cast::<ModuleEnvironment>();
            return module.get_import(cx, slot.index);
        }
        self.get_checked(cx, slot.index)
    }

    fn put_named(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
        is_strict: bool,
    ) -> JsResult<()> {
        let slot = *(self.template().scope().find(name)).expect("where it was resolved");
        if matches!(
            slot.kind,
            SlotKind::Let | SlotKind::Const | SlotKind::Variable
        ) {
            self.get_checked(cx, slot.index)?;
        }
        match slot.kind {
            SlotKind::Variable | SlotKind::Let | SlotKind::LazyFunction => {
                // SAFETY: the code that declares it knows that it is assigned to.
                unsafe { self.set(slot.index, Some(value)) };
                Ok(())
            }
            SlotKind::Callee if !is_strict => Ok(()),
            _ => Err(cx.throw_type_error(errors::READ_ONLY_PROPERTY_WRITE)),
        }
    }
}

impl Cx {
    /// `declares` is given an environment and how many are before it.
    #[inline(always)]
    fn find_holder(
        &mut self,
        scope: Gc<JsCell>,
        name: PropertyName<'_>,
        declares: impl Fn(&Environment, u32) -> bool,
    ) -> JsResult<Gc<JsCell>> {
        let (mut scope, mut depth) = (scope, 0);
        while let Some(environment) = scope.downcast::<Environment>() {
            if let Some(object) = environment.with_object() {
                if with_has_binding(self, object, name)? {
                    return Ok(scope);
                }
            } else if declares(&environment, depth) {
                return Ok(scope);
            } else if let Some(variables) = environment.eval_variables()
                && variables.get_direct(name).is_some()
            {
                return Ok(variables.cell());
            }
            (scope, depth) = (environment.parent(), depth + 1);
        }
        Ok(self.scope_extension_for(name)?.map_or(scope, Gc::cell))
    }

    pub fn resolve_dynamic(
        &mut self,
        scope: Gc<JsCell>,
        name: PropertyName<'_>,
    ) -> JsResult<Gc<JsCell>> {
        self.find_holder(scope, name, |it, _| {
            it.template().scope().find(name).is_some()
        })
    }

    /// The instruction `resolve_dynamic`. The write barrier of the code block follows.
    pub fn resolve_dynamic_with_cache(
        &mut self,
        scope: Gc<JsCell>,
        name: PropertyName<'_>,
        cache: &ResolveDynamic,
    ) -> JsResult<Gc<JsCell>> {
        if cache.variables_slot.get() == ResolveDynamic::PASSES_WITH {
            let declared_at = cache.depth.get();
            return self.find_holder(scope, name, |_, depth| depth == declared_at);
        }
        let holder = self.resolve_dynamic(scope, name)?;
        if let Some(scope) = scope.downcast::<Environment>() {
            cache.remember(self, &scope, name, holder);
        }
        Ok(holder)
    }

    /// The instruction `get_dynamic`.
    pub fn get_dynamic(
        &mut self,
        holder: Gc<JsCell>,
        name: PropertyName<'_>,
        unresolved: Unresolved,
        is_strict: bool,
    ) -> JsResult<Value> {
        let value = match Holder::of(holder) {
            Holder::Slots(environment) => return environment.get_named(self, name),
            Holder::Global => return self.get_global(name, unresolved, GlobalLexicals::Visible),
            // One lookup for the two of GetBindingValue, which only a proxy can tell apart.
            Holder::With(object) if !is_strict => {
                return get_megamorphic(self, object.into(), name);
            }
            Holder::With(object) => {
                let mut slot = PropertySlot::new(object.into(), InternalMethod::Get);
                if object.get_property_slot(self, name, &mut slot)? {
                    return slot.value(self, name);
                }
                None
            }
            Holder::EvalVariables(variables) => variables.get_direct(name),
        };
        match value {
            None if is_strict => Err(errors::throw_undefined_variable(self, name)),
            _ => Ok(value.unwrap_or_default()),
        }
    }

    /// The instruction `put_dynamic`.
    pub fn put_dynamic(
        &mut self,
        holder: Gc<JsCell>,
        name: PropertyName<'_>,
        value: Value,
        is_strict: bool,
    ) -> JsResult<()> {
        match Holder::of(holder) {
            Holder::Slots(environment) => environment.put_named(self, name, value, is_strict),
            Holder::Global => self.put_global(name, value, is_strict, GlobalLexicals::Visible),
            Holder::With(object) => self.put_to_binding_object(object, name, value, is_strict),
            Holder::EvalVariables(variables) => {
                if is_strict && variables.get_direct(name).is_none() {
                    return Err(errors::throw_undefined_variable(self, name));
                }
                variables.put_direct(self, name, value, Attributes::NONE);
                Ok(())
            }
        }
    }

    /// SetMutableBinding of an Object Environment Record.
    pub(crate) fn put_to_binding_object(
        &mut self,
        object: Gc<JsObject>,
        name: PropertyName<'_>,
        value: Value,
        is_strict: bool,
    ) -> JsResult<()> {
        if !has_megamorphic(self, object, name)? && is_strict {
            return Err(errors::throw_undefined_variable(self, name));
        }
        put_megamorphic(self, object, name, value, is_strict)
    }

    /// The instruction `delete_dynamic`.
    pub fn delete_dynamic(&mut self, holder: Gc<JsCell>, name: PropertyName<'_>) -> JsResult<bool> {
        match Holder::of(holder) {
            Holder::Slots(_) => Ok(false),
            Holder::Global => self.delete_global(name),
            Holder::With(object) | Holder::EvalVariables(object) => object.delete(self, name),
        }
    }
}

/// The instruction `get_dynamic_this`.
pub fn dynamic_this(holder: Gc<JsCell>) -> Value {
    match Holder::of(holder) {
        Holder::With(object) => object.into(),
        _ => Value::UNDEFINED,
    }
}
