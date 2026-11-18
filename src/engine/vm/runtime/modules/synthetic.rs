//! The Synthetic Module Record of ECMA-262.

use bun_engine_macros::cell;
use bun_engine_text::{Identifier, PropertyName, names};

use crate::{
    AbstractModuleRecord, Cx, ExportSource, Field, Gc, JsObject, JsResult, ModuleLoader,
    ModuleType, RootVec, Value, root_vec,
};

#[cell(name = "ModuleRecord", export = "engine_class_SyntheticModuleRecord")]
pub struct SyntheticModuleRecord {
    base: AbstractModuleRecord,
    pub(self) lazy_exports: Field<Option<Gc<JsObject>>>,
}

/// What the embedder says that a module exports.
pub struct SyntheticExports {
    pub names: Vec<Identifier>,
    /// One for each name. What is left out is read from `source` when it is first needed.
    pub values: RootVec<Option<Value>>,
    pub source: Option<Gc<JsObject>>,
}

impl Default for SyntheticExports {
    fn default() -> SyntheticExports {
        SyntheticExports {
            names: Vec::new(),
            values: root_vec(),
            source: None,
        }
    }
}

impl SyntheticModuleRecord {
    pub fn create(
        cx: &Cx,
        loader: Gc<ModuleLoader>,
        key: Identifier,
        module_type: ModuleType,
        exports: &SyntheticExports,
    ) -> Gc<SyntheticModuleRecord> {
        let shape = cx.synthetic_module_record_shape();
        let module = cx.allocate::<SyntheticModuleRecord>(SyntheticModuleRecordInit {
            base: AbstractModuleRecord::init(cx, shape, loader, key, module_type),
            lazy_exports: (exports.source).filter(|_| exports.values.contains(&None)),
        });
        module.edit_entries(|entries| {
            entries.reserve(0, 0, exports.names.len());
            for name in &exports.names {
                entries.add_export(name.clone(), ExportSource::Local(name.clone()));
            }
        });
        let environment = module.create_environment_for_exports(cx);
        let are_distinct = module.entries().exports().len() == exports.names.len();
        for ((index, name), &value) in (0..).zip(&exports.names).zip(&exports.values) {
            let index = match are_distinct {
                true => index,
                false => environment.slot_of_binding(name.name()).expect("declared"),
            };
            if value.is_some() {
                // SAFETY: nothing has read it.
                unsafe { environment.set(index, value) };
            }
        }
        module
    }

    /// Panics if there is no source.
    pub(super) fn create_live(
        cx: &Cx,
        loader: Gc<ModuleLoader>,
        key: Identifier,
        exports: &SyntheticExports,
    ) -> Gc<SyntheticModuleRecord> {
        let module = Self::create(cx, loader, key, ModuleType::JavaScript, exports);
        module.set_lazy_exports(None);
        module.make_exports_live();
        module.set_live_exports_source(exports.source.expect("a source"));
        module
    }

    /// CreateDefaultExportSyntheticModule
    pub(super) fn with_default_export(
        cx: &Cx,
        loader: Gc<ModuleLoader>,
        key: Identifier,
        module_type: ModuleType,
        value: Value,
    ) -> Gc<SyntheticModuleRecord> {
        let mut exports = SyntheticExports::default();
        exports.names.push(names::default.to_identifier());
        exports.values.push(Some(value));
        Self::create(cx, loader, key, module_type, &exports)
    }

    /// The slot is empty.
    pub(super) fn read_lazy_export(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        index: u32,
    ) -> JsResult<()> {
        let (Some(source), Some(environment)) = (self.lazy_exports(), self.environment()) else {
            return Ok(());
        };
        let value = source.get(cx, name)?;
        if environment.get(index).is_none() {
            // SAFETY: its initialization.
            unsafe { environment.set(index, Some(value)) };
        }
        Ok(())
    }
}
