mod access;
mod resolve;

use bun_sema::bind::{PrivateMembers, PrivateNameId, SymbolId};
use bun_sema::hir::{ClassId, ExprId, MemberId};
use smallvec::{SmallVec, smallvec};

use super::call::{self, Arguments, CallSite};
use super::known_call::PrivateStateAccess;
use super::{FileLowering, FunctionLowering, class, condition, expression};
use crate::builtins::id::BuiltinId;
use crate::ir::{BlockId, Edge, LayoutId, PrivateStatePart, TypeId, TypeTable, ValueId};
use crate::known_helpers::{FilePrivateStates, PrivateStateKind};

pub(in crate::lower) use self::access::{
    emit_brand_definition, emit_field_definition, emit_name_get, emit_name_set, emit_name_test,
    emit_storage_definition, emit_storage_get, emit_storage_set,
};
pub(in crate::lower) use self::resolve::{resolve_accessor_storage, resolve_private_name};

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

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) struct AccessorStorage {
    pub(in crate::lower) class: ClassId,
    pub(in crate::lower) member: MemberId,
    pub(in crate::lower) holder: PrivateHolder,
}

#[derive(Copy, Clone)]
struct StateField {
    kind: PrivateStateKind,
    layout: LayoutId,
    field: u32,
}

pub(crate) fn emit_private_get(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: ValueId,
    access: ExprId,
) -> ValueId {
    lowering.set_position(lowering.file.hir[access].pos);
    match find_referenced_name(lowering, access) {
        Some(name) => access::emit_name_get(lowering, object, name),
        None => access::emit_undeclared_name_error(lowering),
    }
}

pub(crate) fn emit_private_set(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: ValueId,
    access: ExprId,
    value: ValueId,
    source: Option<ExprId>,
) {
    match find_referenced_name(lowering, access) {
        Some(name) => access::emit_name_set(lowering, object, name, value, source),
        None => {
            access::emit_undeclared_name_error(lowering);
        }
    }
}

pub(crate) fn lower_private_in(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> ValueId {
    access::lower_private_in(lowering, expression)
}

fn find_referenced_name(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
    reference: ExprId,
) -> Option<PrivateNameId> {
    lowering.file.bound.private_name_of_reference(reference)
}

fn find_states<'a>(file: &FileLowering<'a, '_, '_, '_>) -> Option<&'a FilePrivateStates> {
    let inputs = file.inputs;
    let files = file.queries.files();
    inputs.known_helpers.private_states(files, inputs.modules, file.file)
}

fn resolve_state(
    file: &mut FileLowering<'_, '_, '_, '_>,
    state: SymbolId,
) -> Option<StateField> {
    let found = find_states(file)?.state(state)?;
    let (layout, field) = class::find_private_state_field(file, found.owner, state)?;
    Some(StateField {
        kind: found.kind,
        layout,
        field,
    })
}

fn continue_if(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    condition: ValueId,
    otherwise: BlockId,
) {
    let passed = lowering.create_block();
    lowering
        .builder
        .branch(condition, Edge::to(passed), Edge::to(otherwise));
    lowering.continue_in(passed);
}

fn continue_if_type(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
    tested: TypeId,
    otherwise: BlockId,
) -> ValueId {
    let split = condition::split_on_type(lowering, value, tested);
    lowering.builder.switch_to(split.not_taken);
    lowering.jump(otherwise);
    lowering.builder.switch_to(split.taken);
    split.taken_value
}

fn get_state_token(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    state: SymbolId,
) -> ValueId {
    class::get_private_state_slot(lowering, state, PrivateStatePart::Token)
}

// A new collection is a new private name, and the fields have room for the entries of one.
fn continue_if_recorded(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: PrivateStateAccess,
    otherwise: BlockId,
) {
    let collection = continue_if_type(lowering, access.collection, TypeTable::OBJECT, otherwise);
    let part = PrivateStatePart::Collection;
    let recorded = class::get_private_state_slot(lowering, access.state, part);
    let is_recorded = lowering.builder.strict_eq(collection, recorded);
    continue_if(lowering, is_recorded, otherwise);
}

fn emit_entry_of_collection(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: PrivateStateAccess,
    value: Option<ValueId>,
) {
    let method = match value {
        Some(_) => BuiltinId::WeakMapPrototypeSet,
        None => BuiltinId::WeakSetPrototypeAdd,
    };
    let mut arguments: SmallVec<[ValueId; 4]> = smallvec![access.object];
    arguments.extend(value);
    let method = expression::emit_locked_builtin(lowering, method);
    let arguments = Arguments::Values(arguments);
    call::emit_call(lowering, method, Some(access.collection), arguments, CallSite::default());
}

// `new WeakMap()` that is stored in a variable of private state.
pub(in crate::lower) fn record_state_creation(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    creation: ExprId,
    constructor: ValueId,
    collection: ValueId,
) {
    let created = find_states(lowering.file).and_then(|states| states.created_by(creation));
    let Some(created) = created else {
        return;
    };
    let Some(state) = resolve_state(lowering.file, created.symbol) else {
        return;
    };
    let done = lowering.create_block();
    let builtin = match state.kind {
        PrivateStateKind::Field => BuiltinId::WeakMap,
        PrivateStateKind::Brand => BuiltinId::WeakSet,
    };
    let builtin = expression::emit_locked_builtin(lowering, builtin);
    let is_builtin = lowering.builder.strict_eq(constructor, builtin);
    continue_if(lowering, is_builtin, done);
    let part = PrivateStatePart::Collection;
    let recorded = class::get_private_state_slot(lowering, created.symbol, part);
    continue_if_type(lowering, recorded, TypeTable::UNDEFINED, done);
    let token = lowering.builder.new_class_token(state.layout);
    class::set_private_state_slot(lowering, created.symbol, PrivateStatePart::Token, token);
    class::set_private_state_slot(lowering, created.symbol, part, collection);
    lowering.jump(done);
    lowering.continue_in(done);
}

pub(in crate::lower) fn emit_state_test(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: PrivateStateAccess,
) -> ValueId {
    let Some(state) = resolve_state(lowering.file, access.state) else {
        return lowering.builder.boolean(false);
    };
    let result = lowering.builder.create_variable(None);
    let done = lowering.create_block();
    let is_missing = lowering.builder.boolean(false);
    lowering.builder.write_variable(result, is_missing);
    continue_if_recorded(lowering, access, done);
    let object = continue_if_type(lowering, access.object, TypeTable::OBJECT, done);
    let token = get_state_token(lowering, access.state);
    let has_entry = lowering
        .builder
        .private_has(object, token, state.layout, state.field);
    lowering.builder.write_variable(result, has_entry);
    lowering.jump(done);
    lowering.continue_in(done);
    lowering.builder.read_variable(result)
}

pub(in crate::lower) fn emit_state_get(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: PrivateStateAccess,
) -> ValueId {
    let Some(state) = resolve_state(lowering.file, access.state) else {
        return lowering.builder.undefined();
    };
    let token = get_state_token(lowering, access.state);
    lowering
        .builder
        .private_get(access.object, token, state.layout, state.field)
}

pub(in crate::lower) fn emit_state_set(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: PrivateStateAccess,
    value: ValueId,
) {
    let Some(state) = resolve_state(lowering.file, access.state) else {
        return;
    };
    let token = get_state_token(lowering, access.state);
    lowering
        .builder
        .private_set(access.object, token, state.layout, state.field, value);
}

pub(in crate::lower) fn emit_state_definition(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: PrivateStateAccess,
    value: Option<ValueId>,
) {
    let Some(state) = resolve_state(lowering.file, access.state) else {
        emit_entry_of_collection(lowering, access, value);
        return;
    };
    let in_collection = lowering.create_unlikely_block();
    let done = lowering.create_block();
    continue_if_recorded(lowering, access, in_collection);
    let token = get_state_token(lowering, access.state);
    let stored = match value {
        Some(value) => value,
        None => lowering.builder.boolean(true),
    };
    lowering
        .builder
        .private_define(access.object, token, state.layout, state.field, stored);
    lowering.jump(done);

    lowering.continue_in(in_collection);
    emit_entry_of_collection(lowering, access, value);
    lowering.jump(done);

    lowering.continue_in(done);
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
            embeds_function_text: false,
            reports_type_mismatches: false,
            removable: Default::default(),
        };
        let lowered = lower_program(&[("main.mjs", main), ("helpers.mjs", HELPERS)], options);
        lowered.into_iter().map(|(_, lowered)| lowered).collect()
    }

    fn count(main: &str, opcode: Opcode) -> usize {
        let lowered = lower(main);
        let functions = lowered.iter().flat_map(|lowered| lowered.fragment.functions.iter());
        let blocks = functions.flat_map(|(_, function)| function.body.blocks());
        let values = blocks.flat_map(|block| block.values());
        values.filter(|value| value.opcode == opcode).count()
    }

    fn count_hidden_fields(main: &str) -> usize {
        let hidden = FieldFlags::IS_PRIVATE | FieldFlags::IS_HIDDEN;
        let lowered = lower(main);
        let layouts = lowered.iter().flat_map(|lowered| lowered.fragment.layouts.iter());
        let fields = layouts.flat_map(|(_, layout)| layout.fields.iter());
        fields.filter(|field| field.flags.contains(hidden)).count()
    }

    #[test]
    fn the_entries_of_private_state_are_private_fields() {
        assert_eq!(count_hidden_fields(COUNTER), 2);
        assert_eq!(count(COUNTER, Opcode::NewClassToken), 2);
        assert_eq!(count(COUNTER, Opcode::PrivateDefine), 2);
        assert_eq!(count(COUNTER, Opcode::PrivateHas), 5);
    }

    // Five more would be `has` and `get` in `read`, `has` and `set` in `write`, `has` in `step`.
    #[test]
    fn an_entry_in_a_field_is_reached_without_asking_the_collection_for_its_methods() {
        assert_eq!(count(COUNTER, Opcode::PropGet), 16);
    }

    #[test]
    fn a_collection_that_something_else_can_reach_has_no_field() {
        let main = format!("{COUNTER}console.log(_Counter_x, _Counter_instances);");
        assert_eq!(count_hidden_fields(&main), 0);
        for opcode in [Opcode::NewClassToken, Opcode::PrivateDefine, Opcode::PrivateHas] {
            assert_eq!(count(&main, opcode), 0, "{opcode:?}");
        }
    }

    #[test]
    fn a_class_below_inherits_the_fields_and_declares_none() {
        let main = format!("{COUNTER}export class Below extends Counter {{}}");
        assert_eq!(count_hidden_fields(&main), 2);
    }
}
