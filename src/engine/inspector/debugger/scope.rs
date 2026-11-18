//! Scopes as objects.

use bun_engine_bytecode::{ScopeKind, Slot, SlotFlags, SlotKind};
use bun_engine_macros::{cell, object_ops};
use bun_engine_text::{PropertyName, StringRef};
use bun_engine_vm::{
    Attributes, Cx, DebuggerFrame, DeletePropertySlot, DontEnumMode, Environment, EvalExecutable,
    ForIn, FunctionExecutable, Gc, GlobalLexicals, GlobalObject, JsCell, JsObject, JsObjectInit,
    JsResult, ModuleExecutable, PropertyDescriptor, PropertyNameList, PropertySlot,
    PutPropertySlot, RootVec, ScriptExecutable, Shape, ShapeSpec, TypeFlags, Value, errors,
    root_vec,
};

use super::Location;
use crate::remote::as_value_of_language;

/// Bindings that the language keeps in different scopes can be in one `Environment`.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Part {
    All,
    Lexicals,
    Variables,
    Parameters,
    VariablesAndParameters,
    Callee,
}

impl Part {
    fn has(self, kind: ScopeKind, slot: &Slot) -> bool {
        use SlotKind::{Callee, Const, Import, LazyFunction, Let, Variable};
        let part = match slot.kind {
            Callee => Part::Callee,
            _ if slot.flags.contains(SlotFlags::PARAMETER) => Part::Parameters,
            Variable if kind == ScopeKind::Parameters => Part::Parameters,
            Variable => Part::Variables,
            Let | Const | Import | LazyFunction => Part::Lexicals,
            _ => return false,
        };
        match self {
            Part::All => true,
            Part::VariablesAndParameters => matches!(part, Part::Variables | Part::Parameters),
            _ => self == part,
        }
    }

    fn has_variables_of_eval(self) -> bool {
        matches!(self, Part::Variables | Part::VariablesAndParameters)
    }
}

/// Of an environment, of the lexical bindings of a global object, or of any object with all that it inherits.
#[cell(ops, flags = TypeFlags::PROHIBITS_PROPERTY_CACHING.union(TypeFlags::INTERCEPTS_INDEXED_ACCESS))]
pub(super) struct DebuggerScope {
    base: JsObject,
    holder: Gc<JsCell>,
    part: Part,
}

enum Binding {
    Slot(Gc<Environment>, Slot),
    GlobalLexical(Gc<GlobalObject>),
    Property(Gc<JsObject>),
    None,
}

impl DebuggerScope {
    fn global_with_lexicals(&self) -> Option<Gc<GlobalObject>> {
        (self.holder.downcast()).filter(|_| self.part == Part::Lexicals)
    }

    fn find(&self, name: PropertyName<'_>) -> Binding {
        if let Some(global) = self.global_with_lexicals() {
            return match global.lexicals().find(name) {
                Some(_) => Binding::GlobalLexical(global),
                None => Binding::None,
            };
        }
        let Some(environment) = self.holder.downcast::<Environment>() else {
            return Binding::Property(self.holder.cast());
        };
        let template = environment.template();
        let slot = template.scope().find(name);
        if let Some(&slot) = slot.filter(|it| self.part.has(template.scope().kind(), it)) {
            return Binding::Slot(environment, slot);
        }
        let variables = environment.eval_variables();
        let variables = variables.filter(|_| self.part.has_variables_of_eval());
        variables.map_or(Binding::None, Binding::Property)
    }

    fn fill_slot(&self, slot: &mut PropertySlot, value: Option<Value>, is_writable: bool) {
        let mut attributes = Attributes::DONT_DELETE;
        attributes.set(Attributes::READ_ONLY, !is_writable);
        match value.map(as_value_of_language) {
            Some(value) => slot.set_value(self, attributes, value),
            None => slot.set_value(self, Attributes::DONT_ENUM, Value::UNDEFINED),
        }
    }
}

fn is_writable(slot: &Slot) -> bool {
    use SlotKind::{LazyFunction, Let, Variable};
    matches!(slot.kind, Variable | Let | LazyFunction)
}

#[object_ops]
impl DebuggerScope {
    fn get_own_property_slot(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        match self.find(name) {
            Binding::None => return Ok(false),
            Binding::Property(object) => {
                slot.set_this_value(object.into());
                return object.get_property_slot(cx, name, slot);
            }
            Binding::Slot(..) if slot.is_inquiry() => return Ok(false),
            Binding::Slot(environment, found) => {
                let value = environment.read_binding(cx, &found)?;
                self.fill_slot(slot, value, is_writable(&found));
            }
            Binding::GlobalLexical(global) => {
                let binding = global.lexicals().find(name).expect("just found");
                self.fill_slot(slot, binding.get(), binding.attributes().is_writable());
            }
        }
        Ok(true)
    }

    fn get_own_property_slot_by_index(
        &self,
        cx: &mut Cx,
        index: u32,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        let name = bun_engine_text::Identifier::from_index(index);
        self.get_own_property_slot(cx, name.name(), slot)
    }

    fn put(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
        slot: &mut PutPropertySlot,
    ) -> JsResult<bool> {
        match self.find(name) {
            Binding::None => Ok(false),
            Binding::Property(object) => object.set(cx, name, value, slot.is_strict()),
            Binding::Slot(environment, found) if is_writable(&found) => {
                Ok(environment.overwrite(cx, name, value))
            }
            Binding::Slot(_, found) => {
                let throws = slot.is_strict() || found.kind != SlotKind::Callee;
                cx.reject(throws, errors::READ_ONLY_PROPERTY_WRITE)
            }
            Binding::GlobalLexical(global) => {
                let cx = cx.in_realm(global);
                (cx.put_global(name, value, true, GlobalLexicals::Visible)).map(|()| true)
            }
        }
    }

    fn delete_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        _: &mut DeletePropertySlot,
    ) -> JsResult<bool> {
        match self.find(name) {
            Binding::None => Ok(true),
            Binding::Property(object) => object.delete(cx, name),
            Binding::Slot(..) | Binding::GlobalLexical(_) => Ok(false),
        }
    }

    fn define_own_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        descriptor: &PropertyDescriptor,
        should_throw: bool,
    ) -> JsResult<bool> {
        match self.find(name) {
            Binding::Property(object) => {
                object.define_own_property(cx, name, descriptor, should_throw)
            }
            _ => cx.reject(should_throw, errors::NON_EXTENSIBLE_DEFINE),
        }
    }

    fn own_property_names(
        &self,
        cx: &mut Cx,
        list: &mut PropertyNameList,
        mode: DontEnumMode,
    ) -> JsResult<()> {
        if let Some(global) = self.global_with_lexicals() {
            (global.lexicals().names().iter()).for_each(|name| list.add(name.name()));
            return Ok(());
        }
        let Some(environment) = self.holder.downcast::<Environment>() else {
            return (self.holder.cast::<JsObject>()).property_names(cx, list, mode);
        };
        let template = environment.template();
        let scope = template.scope();
        for slot in scope.slots() {
            let name = scope.name_of(slot);
            if self.part.has(scope.kind(), slot) && scope.find(name.name()).is_some() {
                list.add(name.name());
            }
        }
        match environment.eval_variables() {
            Some(variables) if self.part.has_variables_of_eval() => {
                variables.own_property_names(cx, list, mode)
            }
            _ => Ok(()),
        }
    }
}

/// `Debugger.Scope`
pub(super) struct Scope {
    pub(super) object: Gc<JsObject>,
    pub(super) kind: &'static str,
    pub(super) name: StringRef,
    pub(super) location: Option<Location>,
}

impl Scope {
    pub(super) fn is_empty(&self, cx: &mut Cx) -> JsResult<bool> {
        let object = self.object.into();
        match ForIn::open(cx, object)? {
            Some(mut names) => Ok(names.next(cx, object)?.is_none()),
            None => Ok(true),
        }
    }
}

/// The name of the code that has a scope, and where it starts.
fn describe_owner(owner: Gc<ScriptExecutable>) -> (StringRef, u32) {
    if let Some(function) = owner.downcast::<FunctionExecutable>() {
        return (function.name().clone(), function.info().parameters_start());
    }
    let name = if owner.is::<EvalExecutable>() {
        "<eval>"
    } else if owner.is::<ModuleExecutable>() {
        if let Some(url) = owner.provider().url().filter(|it| !it.is_empty()) {
            return (url.clone(), 0);
        }
        "<module>"
    } else {
        "<global>"
    };
    (StringRef::from_literal(name), 0)
}

struct Chain<'a> {
    cx: &'a Cx,
    shape: Gc<Shape>,
    scopes: RootVec<Scope>,
}

impl Chain<'_> {
    fn add(&mut self, holder: Gc<JsCell>, part: Part, kind: &'static str) -> &mut Scope {
        let object = self.cx.allocate::<DebuggerScope>(DebuggerScopeInit {
            base: JsObjectInit::new(self.cx, self.shape),
            holder,
            part,
        });
        self.scopes.push_mut(Scope {
            object: object.upcast(),
            kind,
            name: StringRef::empty(),
            location: None,
        })
    }

    fn add_environment(&mut self, environment: Gc<Environment>) {
        if let Some(object) = environment.with_object() {
            self.add(object.cell(), Part::All, "with");
            return;
        }
        let template = environment.template();
        let (scope, owner) = (template.anchor().scope(), template.owner());
        let function = owner.and_then(Gc::downcast::<FunctionExecutable>);
        let variables = match scope.body_start() {
            Some(_) => Part::Variables,
            None => Part::VariablesAndParameters,
        };
        let parts: &[_] = match scope.kind() {
            ScopeKind::Function | ScopeKind::Parameters | ScopeKind::FunctionName => &[
                (Part::Lexicals, "closure"),
                (variables, "closure"),
                (Part::Parameters, "closure"),
                (Part::Callee, "functionName"),
            ],
            ScopeKind::SimpleCatch | ScopeKind::Catch => &[(Part::All, "catch")],
            ScopeKind::Program | ScopeKind::Module => &[(Part::All, "closure")],
            _ => &[(Part::All, "nestedLexical")],
        };
        for &(part, kind) in parts {
            let is_always_there = scope.kind() == ScopeKind::Module
                || (part == variables && scope.eval_variables_slot().is_some());
            let is_repeated = part == Part::Parameters && variables != Part::Variables;
            let mut slots = scope.slots().iter();
            if is_repeated || !(is_always_there || slots.any(|it| part.has(scope.kind(), it))) {
                continue;
            }
            let added = self.add(environment.cell(), part, kind);
            let is_of_strict_eval = function.is_none() && part == variables;
            let is_described = !is_of_strict_eval && scope.kind() != ScopeKind::Module;
            if let Some(owner) = owner.filter(|_| is_described) {
                let (name, start) = describe_owner(owner);
                let is_in_body = !matches!(part, Part::Parameters | Part::Callee);
                let of_owner = |it: &Gc<Environment>| it.template().owner() == Some(owner);
                let body_start = (environment.chain().take_while(of_owner))
                    .find_map(|it| it.template().scope().body_start());
                let start = body_start.filter(|_| is_in_body).unwrap_or(start);
                added.name = name;
                added.location = Some(Location::of(owner.provider(), start));
            }
        }
    }
}

/// From the innermost.
pub(super) fn scope_chain(cx: &Cx, frame: &DebuggerFrame) -> RootVec<Scope> {
    let spec = ShapeSpec::of::<DebuggerScope>();
    let mut chain = Chain {
        cx,
        shape: Shape::create(cx, Some(cx.global()), Value::NULL, spec),
        scopes: root_vec(),
    };
    let mut scope = frame.scope();
    while let Some(environment) = scope.downcast::<Environment>() {
        chain.add_environment(environment);
        scope = environment.parent();
    }
    if frame.sees_global_lexicals() {
        chain.add(scope, Part::Lexicals, "globalLexicalEnvironment");
    }
    chain.add(scope, Part::All, "global");
    chain.scopes
}

/// What a `catch` that the frame is right inside of has bound.
pub(super) fn caught_value(frame: &DebuggerFrame) -> Option<Value> {
    let environment = frame.scope().downcast::<Environment>()?;
    let template = environment.template();
    match (template.scope().kind(), template.scope().slots()) {
        (ScopeKind::SimpleCatch | ScopeKind::Catch, [only]) => environment.get(only.index),
        _ => None,
    }
}
