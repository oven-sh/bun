//! The variables and functions that `eval` code declares in the scope around it.

use bun_engine_bytecode::{ScopeKind, SlotFlags};
use bun_engine_text::PropertyName;

use super::realm_of_scope;
use crate::{Attributes, Cx, Environment, Gc, GlobalLexicals, JsCell, JsObject, JsResult, Value};

/// Where a `var` of code that runs in `innermost` and is not strict ends up.
pub(crate) struct VariableScope {
    innermost: Gc<JsCell>,
    /// `None` for the global scope.
    environment: Option<Gc<Environment>>,
}

impl VariableScope {
    pub(crate) fn around(innermost: Gc<JsCell>) -> VariableScope {
        let is_extensible =
            |it: &Gc<Environment>| it.template().scope().eval_variables_slot().is_some();
        let first = innermost.downcast::<Environment>();
        VariableScope {
            innermost,
            environment: first.and_then(|first| first.chain().find(is_extensible)),
        }
    }

    pub(crate) fn environment(&self) -> Option<Gc<Environment>> {
        self.environment
    }

    /// Whether a lexical binding is in the way.
    pub(crate) fn is_hidden(&self, name: PropertyName<'_>) -> bool {
        let first = self.innermost.downcast::<Environment>();
        for environment in first.iter().flat_map(|first| first.chain()) {
            let template = environment.template();
            let scope = template.scope();
            if scope.kind() != ScopeKind::SimpleCatch
                && (scope.find(name)).is_some_and(|slot| slot.flags.contains(SlotFlags::LEXICAL))
            {
                return true;
            }
            if Some(environment) == self.environment {
                return false;
            }
        }
        let global = realm_of_scope(self.innermost);
        global.lexicals().find(name).is_some()
    }
}

impl Environment {
    /// The object whose properties are the variables that `eval` code has added.
    pub fn eval_variables(&self) -> Option<Gc<JsObject>> {
        let slot = self.template().scope().eval_variables_slot()?;
        self.get(slot)?.as_object()
    }

    fn ensure_eval_variables(&self, cx: &Cx) -> Gc<JsObject> {
        self.eval_variables().unwrap_or_else(|| {
            let slot = self.template().scope().eval_variables_slot();
            let variables = cx.new_object_with_null_prototype();
            // SAFETY: what the slot is for.
            unsafe { self.set(slot.expect("extensible"), Some(variables.into())) };
            variables
        })
    }

    fn put_eval_variable(&self, cx: &Cx, name: PropertyName<'_>, value: Value) {
        cx.will_declare_eval_variable(name);
        (self.ensure_eval_variables(cx)).put_direct(cx, name, value, Attributes::NONE);
    }

    pub(crate) fn declare_eval_variable(&self, cx: &Cx, name: PropertyName<'_>) {
        if self.template().scope().find(name).is_none()
            && (self.eval_variables()).is_none_or(|it| it.get_direct(name).is_none())
        {
            self.put_eval_variable(cx, name, Value::UNDEFINED);
        }
    }
}

impl Cx {
    /// The instruction `put_hoisted`.
    pub fn put_hoisted(
        &mut self,
        scope: Gc<JsCell>,
        name: PropertyName<'_>,
        value: Value,
    ) -> JsResult<()> {
        let target = VariableScope::around(scope);
        if target.is_hidden(name) {
            return Ok(());
        }
        let Some(environment) = target.environment else {
            return self.put_global(name, value, false, GlobalLexicals::Visible);
        };
        match environment.template().scope().find(name) {
            // SAFETY: a variable in reach of `eval`.
            Some(slot) => unsafe { environment.set(slot.index, Some(value)) },
            None => environment.put_eval_variable(self, name, value),
        }
        Ok(())
    }
}
