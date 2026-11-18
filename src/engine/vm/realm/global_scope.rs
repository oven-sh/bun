//! The Global Environment Record of ECMA-262.

use bun_engine_bytecode::{CodeFlags, Declarations, Unresolved};
use bun_engine_text::PropertyName;

use crate::caches::get_megamorphic_if_present;
use crate::{
    Attributes, CodeBlock, Cx, Environment, ErrorType, Gc, GlobalBinding, GlobalObject,
    InternalMethod, JsResult, PropertyOffset, PropertySlot, PutPropertySlot, Shape, ShapeFlags,
    TypeFlags, Value, errors,
};

/// What `eval` code declares can be deleted.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Declarer {
    Script,
    Eval,
}

/// What scripts declare with `let`, `const` and `class` hides nothing from built-in code.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum GlobalLexicals {
    Visible,
    Hidden,
}

/// Where the value of a global name is, as far as code can remember it.
#[derive(Clone, Copy)]
pub enum GlobalPlace<'a> {
    /// For good.
    Lexical(&'a GlobalBinding),
    /// For good. It can become read-only: see `RealmWatchpoint::GlobalVariablesAreWritable`.
    Variable(&'a GlobalBinding),
    /// An own data property, while the global object has the shape.
    Property(Gc<Shape>, PropertyOffset),
    Unknown,
}

impl GlobalObject {
    fn find_lexical(
        &self,
        name: PropertyName<'_>,
        lexicals: GlobalLexicals,
    ) -> Option<&GlobalBinding> {
        (lexicals == GlobalLexicals::Visible).then(|| self.lexicals().find(name))?
    }

    pub fn place_for_load(
        &self,
        name: PropertyName<'_>,
        lexicals: GlobalLexicals,
    ) -> GlobalPlace<'_> {
        if let Some(binding) = self.find_lexical(name, lexicals) {
            return GlobalPlace::Lexical(binding);
        }
        let shape = self.shape();
        if (shape.type_flags()).contains(TypeFlags::PROHIBITS_PROPERTY_CACHING) {
            return GlobalPlace::Unknown;
        }
        if let Some((offset, attributes)) = shape.get(name) {
            if attributes.intersects(Attributes::ANY_ACCESSOR)
                || !shape.property_accesses_are_cacheable()
            {
                return GlobalPlace::Unknown;
            }
            return GlobalPlace::Property(shape, offset);
        }
        (self.variables().find(name)).map_or(GlobalPlace::Unknown, GlobalPlace::Variable)
    }

    /// For an assignment. A store to a property goes with `Shape::did_cache_property_replacement`.
    pub fn place_for_store(
        &self,
        name: PropertyName<'_>,
        lexicals: GlobalLexicals,
    ) -> GlobalPlace<'_> {
        let place = self.place_for_load(name, lexicals);
        let is_writable = match place {
            GlobalPlace::Lexical(binding) => binding.attributes().is_writable(),
            _ if !self.shape().reports_stores() => false,
            GlobalPlace::Variable(binding) => binding.attributes().is_writable(),
            GlobalPlace::Property(shape, _) => {
                !shape.has(ShapeFlags::HAS_READ_ONLY_OR_ACCESSOR_EXCLUDING_PROTO)
                    || shape.get(name).is_some_and(|found| found.1.is_writable())
            }
            GlobalPlace::Unknown => false,
        };
        if is_writable {
            place
        } else {
            GlobalPlace::Unknown
        }
    }

    pub(crate) fn may_inherit_from_proxy(&self) -> bool {
        self.chain_direct().any(|it| it.overrides_get_prototype())
    }

    fn own_attributes(&self, cx: &mut Cx, name: PropertyName<'_>) -> JsResult<Option<Attributes>> {
        let mut slot = PropertySlot::new(self.as_value(), InternalMethod::GetOwnProperty);
        let is_found = self.get_declared_property_slot(cx, name, &mut slot)?;
        Ok(is_found.then(|| slot.attributes()))
    }

    /// CanDeclareGlobalVar
    pub(crate) fn can_declare_variable(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
    ) -> JsResult<bool> {
        Ok(self.shape().is_extensible() || self.own_attributes(cx, name)?.is_some())
    }

    /// CanDeclareGlobalFunction
    fn can_declare_function(&self, cx: &mut Cx, name: PropertyName<'_>) -> JsResult<bool> {
        Ok(match self.own_attributes(cx, name)? {
            None => self.shape().is_extensible(),
            Some(attributes) => {
                attributes.is_configurable()
                    || !attributes
                        .intersects(Attributes::REJECTS_PLAIN_STORE | Attributes::DONT_ENUM)
            }
        })
    }

    pub(crate) fn check_can_declare(
        &self,
        cx: &mut Cx,
        declarations: &Declarations,
    ) -> JsResult<()> {
        for name in &declarations.functions {
            if !self.can_declare_function(cx, name.name())? {
                return Err(errors::throw_naming(
                    cx,
                    ErrorType::TypeError,
                    "Can't declare global function '",
                    name.name(),
                    "': property must be either configurable or both writable and enumerable",
                    "Can't declare global function: property must be either configurable or both writable and enumerable",
                ));
            }
        }
        for name in &declarations.variables {
            if !self.can_declare_variable(cx, name.name())? {
                return Err(errors::throw_naming(
                    cx,
                    ErrorType::TypeError,
                    "Can't declare global variable '",
                    name.name(),
                    "': global object must be extensible",
                    "Can't declare global variable: global object must be extensible",
                ));
            }
        }
        Ok(())
    }

    fn declare_new(&self, cx: &Cx, name: PropertyName<'_>, declarer: Declarer) {
        match declarer {
            Declarer::Script => {
                self.add_variable(cx, name, Attributes::NONE);
            }
            Declarer::Eval => self.put_direct(cx, name, Value::UNDEFINED, Attributes::NONE),
        }
    }

    /// CreateGlobalVarBinding
    pub(crate) fn declare_variable(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        declarer: Declarer,
    ) -> JsResult<()> {
        if self.own_attributes(cx, name)?.is_none() {
            self.declare_new(cx, name, declarer);
        }
        Ok(())
    }

    /// CreateGlobalFunctionBinding, but for the value.
    fn declare_function(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        declarer: Declarer,
    ) -> JsResult<()> {
        match self.own_attributes(cx, name)? {
            None => self.declare_new(cx, name, declarer),
            Some(attributes) if attributes.is_configurable() => {
                let mut attributes = Attributes::NONE;
                attributes.set(Attributes::DONT_DELETE, declarer == Declarer::Script);
                self.put_direct(cx, name, Value::UNDEFINED, attributes);
            }
            Some(_) => {}
        }
        Ok(())
    }

    pub(crate) fn declare_functions_and_variables(
        &self,
        cx: &mut Cx,
        declarations: &Declarations,
        declarer: Declarer,
    ) -> JsResult<()> {
        for name in &declarations.functions {
            self.declare_function(cx, name.name(), declarer)?;
        }
        for name in &declarations.variables {
            self.declare_variable(cx, name.name(), declarer)?;
        }
        Ok(())
    }
}

impl CodeBlock {
    pub fn global_lexicals(&self) -> GlobalLexicals {
        match self.body().flags().contains(CodeFlags::BUILTIN) {
            true => GlobalLexicals::Hidden,
            false => GlobalLexicals::Visible,
        }
    }
}

impl Cx {
    /// The extension of the global scope, if it has the name and the global scope does not.
    pub(crate) fn scope_extension_for(
        &mut self,
        name: PropertyName<'_>,
    ) -> JsResult<Option<Gc<Environment>>> {
        let global = self.global();
        let Some(extension) = global.scope_extension() else {
            return Ok(None);
        };
        if global.lexicals().find(name).is_some() || global.has_property(self, name)? {
            return Ok(None);
        }
        let object = extension.with_object().expect("a `with` scope");
        Ok(object.has_property(self, name)?.then_some(extension))
    }

    /// The instruction `get_global`.
    pub fn get_global(
        &mut self,
        name: PropertyName<'_>,
        unresolved: Unresolved,
        lexicals: GlobalLexicals,
    ) -> JsResult<Value> {
        let global = self.global();
        if let Some(binding) = global.find_lexical(name, lexicals) {
            return (binding.get()).ok_or_else(|| errors::throw_uninitialized_variable(self, name));
        }
        // To `[[Get]]` a proxy has every property.
        if !global.may_inherit_from_proxy() || global.has_property(self, name)? {
            let mut slot = PropertySlot::new(global.global_this().into(), InternalMethod::Get);
            if global.get_property_slot(self, name, &mut slot)? {
                return slot.value(self, name);
            }
        }
        self.get_unresolved(name, unresolved)
    }

    fn get_unresolved(
        &mut self,
        name: PropertyName<'_>,
        unresolved: Unresolved,
    ) -> JsResult<Value> {
        if let Some(object) = (self.global().scope_extension()).and_then(|it| it.with_object())
            && let Some(value) = object.get_if_has_property(self, name)?
        {
            return Ok(value);
        }
        match unresolved {
            Unresolved::Throw => Err(errors::throw_undefined_variable(self, name)),
            Unresolved::Undefined => Ok(Value::UNDEFINED),
        }
    }

    /// The same, where the name is no binding and the global object does not inherit from a proxy.
    #[inline(always)]
    pub(crate) fn get_global_property(
        &mut self,
        name: PropertyName<'_>,
        unresolved: Unresolved,
        may_be_static: bool,
    ) -> JsResult<Value> {
        let (global, shape) = (self.global(), self.global().shape());
        let this = global.global_this().into();
        if may_be_static || shape.get(name).is_some() {
            let mut slot = PropertySlot::new(this, InternalMethod::Get);
            if global.get_own_non_index_property_slot(self, name, &mut slot)? {
                return slot.value(self, name);
            }
        }
        if let Some(prototype) = shape.prototype_object()
            && let Some(value) = get_megamorphic_if_present(self, prototype, name, this)?
        {
            return Ok(value);
        }
        self.get_unresolved(name, unresolved)
    }

    /// The instruction `put_global`.
    pub fn put_global(
        &mut self,
        name: PropertyName<'_>,
        value: Value,
        is_strict: bool,
        lexicals: GlobalLexicals,
    ) -> JsResult<()> {
        let global = self.global();
        if let Some(binding) = global.find_lexical(name, lexicals) {
            if binding.get().is_none() {
                return Err(errors::throw_uninitialized_variable(self, name));
            }
            if !binding.attributes().is_writable() {
                return Err(self.throw_type_error(errors::READ_ONLY_PROPERTY_WRITE));
            }
            // SAFETY: one of its own.
            unsafe { binding.set(self, &global, value) };
            return Ok(());
        }
        if let Some(object) = (self.scope_extension_for(name)?).and_then(|it| it.with_object()) {
            return self.put_to_binding_object(object, name, value, is_strict);
        }
        if !global.has_property(self, name)? && is_strict {
            return Err(errors::throw_undefined_variable(self, name));
        }
        let mut slot = PutPropertySlot::new(global.global_this().into(), is_strict);
        global.put(self, name, value, &mut slot).map(|_| ())
    }

    /// The instruction `initialize_global`.
    pub fn initialize_global(&self, name: PropertyName<'_>, value: Value) {
        let global = self.global();
        // Stored code may name what it has not declared.
        if let Some(binding) = global.lexicals().find(name) {
            // SAFETY: one of its own.
            unsafe { binding.set(self, &global, value) };
        }
    }

    /// The instruction `delete_global`.
    pub fn delete_global(&mut self, name: PropertyName<'_>) -> JsResult<bool> {
        let global = self.global();
        if global.lexicals().find(name).is_some() {
            return Ok(false);
        }
        match (self.scope_extension_for(name)?).and_then(|it| it.with_object()) {
            Some(object) => object.delete(self, name),
            None => global.delete(self, name),
        }
    }
}
