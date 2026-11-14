mod access;
mod resolve;

use bun_sema::atom::Atom;
use bun_sema::bind::{PrivateMembers, SymbolId};
use bun_sema::check::aot::FunctionRef;
use bun_sema::hir::{ClassId, ExprId, MemberId};
use smallvec::{SmallVec, smallvec};

use super::known_call::PrivateStateAccess;
use super::{FileLowering, FunctionLowering, call, layouts};
use crate::builtins::id::BuiltinId;
use crate::ir::generated::RuntimeErrorKind;
use crate::ir::{BlockId, Edge, LayoutId, PrivateStatePart, TypeId, TypeTable, ValueId};
use crate::known_helpers::{FilePrivateStates, PrivateStateKind, StateOwner};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) enum PrivateHolder {
    Instance { layout: LayoutId, field: u32 },
    ClassObject,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) struct PrivateBinding {
    pub(in crate::lower) class: ClassId,
    pub(in crate::lower) members: PrivateMembers,
    pub(in crate::lower) holder: PrivateHolder,
    pub(in crate::lower) is_decorated: bool,
}

#[derive(Copy, Clone)]
pub(in crate::lower) struct StoredValue {
    class: ClassId,
    member: MemberId,
    holder: PrivateHolder,
    written: Option<Atom>,
}

#[derive(Copy, Clone)]
struct StateField {
    kind: PrivateStateKind,
    layout: LayoutId,
    field: u32,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn emit_private_get(&mut self, object: ValueId, access: ExprId) -> ValueId {
        self.report_at_member(access);
        match self.file.bound.private_name_of_reference(access) {
            Some(name) => self.emit_name_get(object, name),
            None => self.emit_error(RuntimeErrorKind::UnresolvableReference),
        }
    }

    pub(crate) fn emit_private_set(
        &mut self,
        object: ValueId,
        access: ExprId,
        value: ValueId,
        source: Option<ExprId>,
    ) {
        self.report_at_member(access);
        match self.file.bound.private_name_of_reference(access) {
            Some(name) => self.emit_name_set(object, name, value, source),
            None => {
                self.emit_error(RuntimeErrorKind::UnresolvableReference);
            }
        }
    }

    fn continue_if_type(&mut self, value: ValueId, tested: TypeId, otherwise: BlockId) -> ValueId {
        let split = self.split_on_type(value, tested);
        self.builder.switch_to(split.not_taken);
        self.jump(otherwise);
        self.builder.switch_to(split.taken);
        split.taken_value
    }

    fn continue_if_recorded(&mut self, access: PrivateStateAccess, otherwise: BlockId) {
        let collection = self.continue_if_type(access.collection, TypeTable::OBJECT, otherwise);
        let recorded = self.get_private_state_slot(access.state, PrivateStatePart::Collection);
        let is_recorded = self.builder.strict_eq(collection, recorded);
        self.emit_guard(is_recorded, otherwise);
    }

    pub(in crate::lower) fn emit_entry_of_collection(
        &mut self,
        access: PrivateStateAccess,
        value: Option<ValueId>,
    ) {
        let method = match value {
            Some(_) => BuiltinId::WeakMapPrototypeSet,
            None => BuiltinId::WeakSetPrototypeAdd,
        };
        let mut arguments: SmallVec<[ValueId; 4]> = smallvec![access.object];
        arguments.extend(value);
        let method = self.emit_locked_builtin(method);
        call::emit_call(self, method, Some(access.collection), &arguments);
    }

    pub(in crate::lower) fn record_state_creation(
        &mut self,
        creation: ExprId,
        constructor: ValueId,
        collection: ValueId,
    ) {
        let created = find_states(self.file).and_then(|states| states.created_by(creation));
        let Some(created) = created else {
            return;
        };
        let Some(state) = self.file.resolve_state(created.symbol) else {
            return;
        };
        let done = self.create_block();
        let builtin = match state.kind {
            PrivateStateKind::Field => BuiltinId::WeakMap,
            PrivateStateKind::Brand => BuiltinId::WeakSet,
        };
        let builtin = self.emit_builtin_itself(builtin);
        let is_builtin = self.builder.strict_eq(constructor, builtin);
        self.emit_guard(is_builtin, done);
        let part = PrivateStatePart::Collection;
        let recorded = self.get_private_state_slot(created.symbol, part);
        self.continue_if_type(recorded, TypeTable::UNDEFINED, done);
        let token = self.builder.new_class_token(state.layout);
        self.set_private_state_slot(created.symbol, PrivateStatePart::Token, token);
        self.set_private_state_slot(created.symbol, part, collection);
        self.jump(done);
        self.continue_in(done);
    }

    pub(in crate::lower) fn emit_state_test(&mut self, access: PrivateStateAccess) -> ValueId {
        let Some(state) = self.file.resolve_state(access.state) else {
            return self.builder.boolean(false);
        };
        self.file.inputs.fixed_builtins.note(match state.kind {
            PrivateStateKind::Field => BuiltinId::WeakMapPrototypeHas,
            PrivateStateKind::Brand => BuiltinId::WeakSetPrototypeHas,
        });
        let result = self.builder.create_variable(None);
        let done = self.create_block();
        let is_missing = self.builder.boolean(false);
        self.builder.write_variable(result, is_missing);
        self.continue_if_recorded(access, done);
        let object = self.continue_if_type(access.object, TypeTable::OBJECT, done);
        let token = self.get_private_state_slot(access.state, PrivateStatePart::Token);
        let has_entry = self
            .builder
            .private_has(object, token, state.layout, state.field);
        self.builder.write_variable(result, has_entry);
        self.jump(done);
        self.continue_in(done);
        self.builder.read_variable(result)
    }

    pub(in crate::lower) fn emit_state_get(&mut self, access: PrivateStateAccess) -> ValueId {
        let Some(state) = self.file.resolve_state(access.state) else {
            return self.builder.undefined();
        };
        let fixed = self.file.inputs.fixed_builtins;
        fixed.note(BuiltinId::WeakMapPrototypeGet);
        let token = self.get_private_state_slot(access.state, PrivateStatePart::Token);
        self.builder
            .private_get(access.object, token, state.layout, state.field)
    }

    pub(in crate::lower) fn emit_state_set(&mut self, access: PrivateStateAccess, value: ValueId) {
        let Some(state) = self.file.resolve_state(access.state) else {
            return;
        };
        let fixed = self.file.inputs.fixed_builtins;
        fixed.note(BuiltinId::WeakMapPrototypeSet);
        let token = self.get_private_state_slot(access.state, PrivateStatePart::Token);
        self.builder
            .private_set(access.object, token, state.layout, state.field, value);
    }

    /// Adds state to an object that has none, or lets the helper throw on the slow path.
    pub(in crate::lower) fn emit_state_addition(
        &mut self,
        access: PrivateStateAccess,
        value: Option<ValueId>,
        slow_path: BlockId,
    ) {
        let Some(state) = self.file.resolve_state(access.state) else {
            let never = self.builder.boolean(false);
            self.emit_guard(never, slow_path);
            return;
        };
        let fixed = self.file.inputs.fixed_builtins;
        let (has, add) = match state.kind {
            PrivateStateKind::Field => (
                BuiltinId::WeakMapPrototypeHas,
                BuiltinId::WeakMapPrototypeSet,
            ),
            PrivateStateKind::Brand => (
                BuiltinId::WeakSetPrototypeHas,
                BuiltinId::WeakSetPrototypeAdd,
            ),
        };
        fixed.note(has);
        fixed.note(add);
        self.continue_if_recorded(access, slow_path);
        let object = self.continue_if_type(access.object, TypeTable::OBJECT, slow_path);
        let token = self.get_private_state_slot(access.state, PrivateStatePart::Token);
        let has_entry = self
            .builder
            .private_has(object, token, state.layout, state.field);
        let repeated = self.create_block();
        let insert = self.create_block();
        self.builder
            .branch(has_entry, Edge::to(repeated), Edge::to(insert));

        // The helper finds the entry in the collection and throws.
        self.continue_in(repeated);
        self.emit_entry_of_collection(access, value);
        self.jump(slow_path);

        self.continue_in(insert);
        let stored = match value {
            Some(value) => value,
            None => self.builder.boolean(true),
        };
        self.builder
            .private_define(object, token, state.layout, state.field, stored);
    }

    pub(in crate::lower) fn emit_state_definition(
        &mut self,
        access: PrivateStateAccess,
        value: Option<ValueId>,
    ) {
        let Some(state) = self.file.resolve_state(access.state) else {
            self.emit_entry_of_collection(access, value);
            return;
        };
        let in_collection = self.create_block();
        let done = self.create_block();
        self.continue_if_recorded(access, in_collection);
        let token = self.get_private_state_slot(access.state, PrivateStatePart::Token);
        let stored = match value {
            Some(value) => value,
            None => self.builder.boolean(true),
        };
        self.builder
            .private_define(access.object, token, state.layout, state.field, stored);
        self.jump(done);

        self.continue_in(in_collection);
        self.emit_entry_of_collection(access, value);
        self.jump(done);

        self.continue_in(done);
    }
}

fn find_states<'a>(file: &FileLowering<'a, '_, '_, '_>) -> Option<&'a FilePrivateStates> {
    let inputs = file.inputs;
    let files = file.queries.files();
    inputs
        .known_helpers
        .private_states(files, inputs.modules, file.file)
}

impl FileLowering<'_, '_, '_, '_> {
    fn resolve_state(&mut self, state: SymbolId) -> Option<StateField> {
        let found = find_states(self)?.state(state)?;
        let layout = match found.owner {
            StateOwner::Class(class) => self.own_class_layout(class),
            StateOwner::Function(function) => {
                let file = self.file;
                self.constructor_function_layout(FunctionRef { file, function })?
            }
        };
        let name = self.bound.symbol(state).name;
        let key = layouts::private_key(self, layout, name);
        Some(StateField {
            kind: found.kind,
            layout,
            field: self.find_field(layout, key)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::compile::testing::lower_program;
    use crate::ir::Opcode;
    use crate::ir::generated::FieldFlags;
    use crate::load::host_platform;
    use crate::lower::{LoweredFile, LoweringOptions};

    const HELPERS: &str = r#"export function __classPrivateFieldGet(receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
export function __classPrivateFieldSet(receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
}
"#;

    const COUNTER: &str = r#"import { __classPrivateFieldGet, __classPrivateFieldSet } from "./helpers.mjs";
var _Counter_x, _Counter_instances, _Counter_step;
export class Counter {
    constructor() {
        _Counter_instances.add(this);
        _Counter_x.set(this, 1);
    }
    read() { return __classPrivateFieldGet(this, _Counter_x, "f"); }
    write(v) { __classPrivateFieldSet(this, _Counter_x, v, "f"); }
    step() { return __classPrivateFieldGet(this, _Counter_instances, "m", _Counter_step).call(this); }
}
_Counter_x = new WeakMap(), _Counter_instances = new WeakSet(), _Counter_step = function _Counter_step() { return 1; };
"#;

    fn lower(main: &str) -> Vec<LoweredFile> {
        let options = LoweringOptions {
            platform: host_platform(),
            embeds_function_source: false,
            reparses_function_sources: false,
            removable: Default::default(),
            minifies_identifiers: false,
            obfuscates: false,
            counts_executions: false,
            runs_tests: false,
            divides_small_files: false,
        };
        let lowered = lower_program(&[("main.mjs", main), ("helpers.mjs", HELPERS)], options);
        lowered.into_iter().map(|(_, lowered)| lowered).collect()
    }

    fn count(main: &str, opcode: Opcode) -> usize {
        let lowered = lower(main);
        let functions = lowered
            .iter()
            .flat_map(|lowered| lowered.fragment.functions.iter());
        let blocks = functions.flat_map(|(_, function)| function.body.blocks());
        let values = blocks.flat_map(|block| block.values());
        values.filter(|value| value.opcode == opcode).count()
    }

    fn count_hidden_fields(main: &str) -> usize {
        let hidden = FieldFlags::IS_PRIVATE | FieldFlags::IS_HIDDEN;
        let lowered = lower(main);
        let layouts = lowered
            .iter()
            .flat_map(|lowered| lowered.fragment.layouts.iter());
        let fields = layouts.flat_map(|(_, layout)| layout.fields.iter());
        fields.filter(|field| field.flags.contains(hidden)).count()
    }

    #[test]
    fn the_entries_of_private_state_are_private_fields() {
        assert_eq!(count_hidden_fields(COUNTER), 2);
        assert_eq!(count(COUNTER, Opcode::NewClassToken), 2);
        assert_eq!(count(COUNTER, Opcode::PrivateDefine), 2);
        assert_eq!(count(COUNTER, Opcode::PrivateHas), 5);
        assert_eq!(count(COUNTER, Opcode::PrivateGet), 1);
        assert_eq!(count(COUNTER, Opcode::PrivateSet), 2);
    }

    #[test]
    fn a_collection_that_something_else_can_reach_has_no_field() {
        let main = format!("{COUNTER}console.log(_Counter_x, _Counter_instances);");
        assert_eq!(count_hidden_fields(&main), 0);
        for opcode in [
            Opcode::NewClassToken,
            Opcode::PrivateDefine,
            Opcode::PrivateHas,
        ] {
            assert_eq!(count(&main, opcode), 0, "{opcode:?}");
        }
    }

    #[test]
    fn a_class_below_inherits_the_fields_and_declares_none() {
        let main = format!("{COUNTER}export class Below extends Counter {{}}");
        assert_eq!(count_hidden_fields(&main), 2);
    }
}
