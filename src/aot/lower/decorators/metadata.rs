use bun_sema::atom::Atom;
use bun_sema::bind::decorator_metadata::{
    DesignKey, DesignValue, Metadata, MetadataCollector, MetadataGlobal, MetadataReference,
    SerializedMetadata, entity_names, find_metadata_binding,
};
use bun_sema::bind::{Binding, SymbolId};
use bun_sema::hir::{ClassId, FnId, MemberId, NameId, Span, TypeNodeId};
use smallvec::SmallVec;

use crate::builtins::id::BuiltinId;
use crate::ir::{BlockId, TypeTable, ValueId};
use crate::lower::member::{self, PropertyName};
use crate::lower::scope::{self, BindingForm};
use crate::lower::{FunctionLowering, call, commonjs, condition, expression};

#[derive(Copy, Clone)]
struct MetadataRoot {
    binding: Binding,
    name: Atom,
    global: Option<MetadataGlobal>,
}

fn design_label(key: DesignKey) -> &'static [u8] {
    match key {
        DesignKey::Type => b"design:type",
        DesignKey::ParameterTypes => b"design:paramtypes",
        DesignKey::ReturnType => b"design:returntype",
    }
}

fn global_builtin(global: MetadataGlobal) -> BuiltinId {
    match global {
        MetadataGlobal::Object => BuiltinId::Object,
        MetadataGlobal::String => BuiltinId::String,
        MetadataGlobal::Number => BuiltinId::Number,
        MetadataGlobal::Function => BuiltinId::Function,
        MetadataGlobal::Boolean => BuiltinId::Boolean,
        MetadataGlobal::Array => BuiltinId::Array,
        MetadataGlobal::BigInt => BuiltinId::BigInt,
        MetadataGlobal::Symbol => BuiltinId::Symbol,
        MetadataGlobal::Promise => BuiltinId::Promise,
    }
}

pub(super) fn emit_member_metadata(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    member: MemberId,
    decorators: &mut SmallVec<[ValueId; 8]>,
) {
    let entries = MetadataCollector::new(lowering.file.hir).collect_member(member);
    for (key, value) in entries {
        let value = match value {
            DesignValue::Type(metadata) => serialize_metadata(lowering, class, metadata),
            DesignValue::Types(types) => serialize_metadata_array(lowering, class, &types),
        };
        decorators.push(emit_define_metadata(lowering, key, value));
    }
}

pub(super) fn emit_constructor_metadata(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    constructor: FnId,
) -> ValueId {
    let mut collector = MetadataCollector::new(lowering.file.hir);
    let parameters = collector.collect_constructor(class, constructor);
    let parameters = serialize_metadata_array(lowering, class, &parameters);
    emit_define_metadata(lowering, DesignKey::ParameterTypes, parameters)
}

fn serialize_metadata(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    metadata: Metadata,
) -> ValueId {
    match metadata.serialized() {
        SerializedMetadata::Undefined => lowering.builder.undefined(),
        SerializedMetadata::Global(global) => emit_metadata_global(lowering, class, global),
        SerializedMetadata::GuardedGlobal(global) => {
            let root = find_global_root(lowering, class, global);
            serialize_guarded_root(lowering, class, root)
        }
        SerializedMetadata::GuardedName(node) => match find_type_name_root(lowering, node) {
            Some(root) => serialize_guarded_root(lowering, class, root),
            None => emit_metadata_global(lowering, class, MetadataGlobal::Object),
        },
        SerializedMetadata::GuardedQualifiedName(node) => {
            serialize_qualified_name(lowering, class, node)
        }
    }
}

fn serialize_metadata_array(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    entries: &[Metadata],
) -> ValueId {
    let mut values = SmallVec::<[ValueId; 4]>::with_capacity(entries.len());
    for &entry in entries {
        values.push(serialize_metadata(lowering, class, entry));
    }
    lowering
        .builder
        .new_array(TypeTable::ANYTHING, &[], &values)
}

fn emit_metadata_global(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    global: MetadataGlobal,
) -> ValueId {
    let root = find_global_root(lowering, class, global);
    read_metadata_root(lowering, root, false)
}

fn serialize_guarded_root(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    root: MetadataRoot,
) -> ValueId {
    let use_object = lowering.create_block();
    let tested = read_metadata_root(lowering, root, true);
    condition::branch_if_undefined(lowering, tested, use_object);
    let value = read_metadata_root(lowering, root, false);
    join_metadata_value(lowering, class, value, use_object)
}

fn serialize_qualified_name(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    node: TypeNodeId,
) -> ValueId {
    let names = entity_names(lowering.file.hir, node);
    let Some(root) = find_type_name_root(lowering, node) else {
        return emit_metadata_global(lowering, class, MetadataGlobal::Object);
    };
    let use_object = lowering.create_block();
    for count in 1..=names.len() {
        let tested = read_metadata_chain(lowering, root, names, count);
        condition::branch_if_undefined(lowering, tested, use_object);
    }
    let value = read_metadata_chain(lowering, root, names, names.len());
    join_metadata_value(lowering, class, value, use_object)
}

fn join_metadata_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    value: ValueId,
    use_object: BlockId,
) -> ValueId {
    let join = lowering.create_block();
    let result = lowering.builder.add_parameter(join, None);
    lowering.jump_with(join, &[value]);
    lowering.continue_in(use_object);
    let object = emit_metadata_global(lowering, class, MetadataGlobal::Object);
    lowering.jump_with(join, &[object]);
    lowering.continue_in(join);
    result
}

fn read_metadata_chain(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    root: MetadataRoot,
    names: Span<NameId>,
    count: usize,
) -> ValueId {
    let hir = lowering.file.hir;
    let mut value = read_metadata_root(lowering, root, count == 1);
    for index in 1..count {
        let key = member::name_key(lowering.file, hir[names.at(index)].text);
        value = member::emit_get(lowering, value, PropertyName::Constant(key));
    }
    value
}

fn read_metadata_root(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    root: MetadataRoot,
    is_for_typeof: bool,
) -> ValueId {
    match root.binding {
        Binding::Free => {
            let value = expression::emit_free_name_get(lowering, root.name, is_for_typeof);
            match root.global {
                Some(global) => lowering.expect_builtin(value, global_builtin(global)),
                None => value,
            }
        }
        Binding::CommonJs(variable) if is_for_typeof => {
            commonjs::get_commonjs_variable_for_typeof(lowering, variable)
        }
        Binding::CommonJs(variable) => commonjs::get_commonjs_variable(lowering, variable),
        Binding::Symbol(symbol) if is_for_typeof && is_unresolvable(lowering, symbol) => {
            lowering.builder.undefined()
        }
        Binding::Symbol(_) | Binding::Arguments(_) => {
            scope::get_binding(lowering, root.binding, root.name)
        }
    }
}

fn is_unresolvable(lowering: &FunctionLowering<'_, '_, '_, '_, '_>, symbol: SymbolId) -> bool {
    match lowering.file.scopes.form(symbol) {
        BindingForm::NotAValue => true,
        BindingForm::Import
        | BindingForm::Callee { .. }
        | BindingForm::MappedArgument { .. }
        | BindingForm::ContainerMember { .. }
        | BindingForm::Stored => false,
    }
}

fn find_type_name_root(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
    node: TypeNodeId,
) -> Option<MetadataRoot> {
    let hir = lowering.file.hir;
    let references = lowering.file.bound.runtime.implicit_references();
    let binding = find_metadata_binding(references, MetadataReference::TypeName(node));
    debug_assert!(
        binding.is_some(),
        "the binder records the binding of every visited name"
    );
    Some(MetadataRoot {
        binding: binding?,
        name: hir[entity_names(hir, node).at(0)].text,
        global: None,
    })
}

fn find_global_root(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    global: MetadataGlobal,
) -> MetadataRoot {
    let references = lowering.file.bound.runtime.implicit_references();
    let reference = MetadataReference::Global(class, global);
    MetadataRoot {
        binding: find_metadata_binding(references, reference).unwrap_or(Binding::Free),
        name: global.name(),
        global: Some(global),
    }
}

fn emit_define_metadata(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    key: DesignKey,
    value: ValueId,
) -> ValueId {
    let label = lowering.file.intern_bytes(design_label(key));
    let label = lowering.builder.string(label);
    let helper = BuiltinId::CompilerHelpersDefineMetadata;
    call::emit_builtin_call(lowering, helper, &[label, value])
}
