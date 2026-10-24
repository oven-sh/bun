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
use crate::lower::FunctionLowering;
use crate::lower::member::PropertyName;
use crate::lower::scope::BindingForm;

#[derive(Copy, Clone)]
struct MetadataRoot {
    binding: Binding,
    name: Atom,
    global: Option<MetadataGlobal>,
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

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn emit_member_metadata(
        &mut self,
        class: ClassId,
        member: MemberId,
        decorators: &mut SmallVec<[ValueId; 8]>,
    ) {
        let entries = MetadataCollector::new(self.file.hir).collect_member(member);
        for (key, value) in entries {
            let value = match value {
                DesignValue::Type(metadata) => self.serialize_metadata(class, metadata),
                DesignValue::Types(types) => self.serialize_metadata_array(class, &types),
            };
            decorators.push(self.emit_define_metadata(key, value));
        }
    }

    pub(super) fn emit_constructor_metadata(
        &mut self,
        class: ClassId,
        constructor: FnId,
    ) -> ValueId {
        let mut collector = MetadataCollector::new(self.file.hir);
        let parameters = collector.collect_constructor(class, constructor);
        let parameters = self.serialize_metadata_array(class, &parameters);
        self.emit_define_metadata(DesignKey::ParameterTypes, parameters)
    }

    fn serialize_metadata(&mut self, class: ClassId, metadata: Metadata) -> ValueId {
        match metadata.serialized() {
            SerializedMetadata::Undefined => self.builder.undefined(),
            SerializedMetadata::Global(global) => self.emit_metadata_global(class, global),
            SerializedMetadata::GuardedGlobal(global) => {
                let root = self.find_global_root(class, global);
                self.serialize_guarded_root(class, root)
            }
            SerializedMetadata::GuardedName(node) => match self.find_type_name_root(node) {
                Some(root) => self.serialize_guarded_root(class, root),
                None => self.emit_metadata_global(class, MetadataGlobal::Object),
            },
            SerializedMetadata::GuardedQualifiedName(node) => {
                self.serialize_qualified_name(class, node)
            }
        }
    }

    fn serialize_metadata_array(&mut self, class: ClassId, entries: &[Metadata]) -> ValueId {
        let mut values = SmallVec::<[ValueId; 4]>::with_capacity(entries.len());
        for &entry in entries {
            values.push(self.serialize_metadata(class, entry));
        }
        self.builder.new_array(TypeTable::ANYTHING, &[], &values)
    }

    fn emit_metadata_global(&mut self, class: ClassId, global: MetadataGlobal) -> ValueId {
        let root = self.find_global_root(class, global);
        self.read_metadata_root(root, false)
    }

    fn serialize_guarded_root(&mut self, class: ClassId, root: MetadataRoot) -> ValueId {
        let use_object = self.create_block();
        let tested = self.read_metadata_root(root, true);
        self.branch_if_undefined(tested, use_object);
        let value = self.read_metadata_root(root, false);
        self.join_metadata_value(class, value, use_object)
    }

    fn serialize_qualified_name(&mut self, class: ClassId, node: TypeNodeId) -> ValueId {
        let names = entity_names(self.file.hir, node);
        let Some(root) = self.find_type_name_root(node) else {
            return self.emit_metadata_global(class, MetadataGlobal::Object);
        };
        let use_object = self.create_block();
        for count in 1..=names.len() {
            let tested = self.read_metadata_chain(root, names, count);
            self.branch_if_undefined(tested, use_object);
        }
        let value = self.read_metadata_chain(root, names, names.len());
        self.join_metadata_value(class, value, use_object)
    }

    fn join_metadata_value(
        &mut self,
        class: ClassId,
        value: ValueId,
        use_object: BlockId,
    ) -> ValueId {
        let join = self.create_block();
        let result = self.builder.add_parameter(join, None);
        self.jump_with(join, &[value]);
        self.continue_in(use_object);
        let object = self.emit_metadata_global(class, MetadataGlobal::Object);
        self.jump_with(join, &[object]);
        self.continue_in(join);
        result
    }

    fn read_metadata_chain(
        &mut self,
        root: MetadataRoot,
        names: Span<NameId>,
        count: usize,
    ) -> ValueId {
        let hir = self.file.hir;
        let mut value = self.read_metadata_root(root, count == 1);
        for index in 1..count {
            let key = self.file.name_key(hir[names.at(index)].text);
            value = self.emit_get(value, PropertyName::Constant(key));
        }
        value
    }

    fn read_metadata_root(&mut self, root: MetadataRoot, is_for_typeof: bool) -> ValueId {
        match root.binding {
            Binding::Free => {
                let value = self.emit_free_name_get(root.name, is_for_typeof);
                match root.global {
                    Some(global) => self.expect_builtin(value, global_builtin(global)),
                    None => value,
                }
            }
            Binding::CommonJs(variable) if is_for_typeof => {
                self.get_commonjs_variable_for_typeof(variable)
            }
            Binding::CommonJs(variable) => self.get_commonjs_variable(variable),
            Binding::Symbol(symbol) if is_for_typeof && self.is_unresolvable(symbol) => {
                self.builder.undefined()
            }
            Binding::Symbol(_) | Binding::Arguments(_) => self.get_binding(root.binding, root.name),
        }
    }

    fn is_unresolvable(&self, symbol: SymbolId) -> bool {
        matches!(self.file.scopes.form(symbol), BindingForm::NotAValue)
    }

    fn find_type_name_root(&self, node: TypeNodeId) -> Option<MetadataRoot> {
        let hir = self.file.hir;
        let references = self.file.bound.runtime.implicit_references();
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

    fn find_global_root(&self, class: ClassId, global: MetadataGlobal) -> MetadataRoot {
        let references = self.file.bound.runtime.implicit_references();
        let reference = MetadataReference::Global(class, global);
        MetadataRoot {
            binding: find_metadata_binding(references, reference).unwrap_or(Binding::Free),
            name: global.name(),
            global: Some(global),
        }
    }

    fn emit_define_metadata(&mut self, key: DesignKey, value: ValueId) -> ValueId {
        let label: &[u8] = match key {
            DesignKey::Type => b"design:type",
            DesignKey::ParameterTypes => b"design:paramtypes",
            DesignKey::ReturnType => b"design:returntype",
        };
        let label = self.file.intern_bytes(label);
        let label = self.builder.string(label);
        self.emit_builtin_call(BuiltinId::CompilerHelpersDefineMetadata, &[label, value])
    }
}
