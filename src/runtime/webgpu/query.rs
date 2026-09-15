//! `GPUQuerySet`.

use std::cell::Cell;

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsCell, JsClass, JsResult, StringJsc as _};
use bun_webgpu::names::{self, QueryKind};
use bun_webgpu::{instance, wgc, wgt};

use super::args::Dict;
use super::device::DeviceRef;

#[bun_jsc::JsClass]
pub struct GPUQuerySet {
    raw: bun_webgpu::QuerySet,
    label: JsCell<bun_core::String>,
    kind: QueryKind,
    count: u32,
    destroyed: Cell<bool>,
}

super::gpu_object!(GPUQuerySet, label);

impl GPUQuerySet {
    #[inline]
    pub(crate) fn id(&self) -> wgc::id::QuerySetId {
        self.raw.id()
    }

    pub(crate) fn create(
        global: &JSGlobalObject,
        device: &DeviceRef,
        descriptor: JSValue,
    ) -> JsResult<JSValue> {
        let d = Dict::required(global, descriptor, "GPUQuerySetDescriptor")?;
        let label = d.label()?;
        let kind = d.require_enum("type", "GPUQueryType", names::parse_query_type_name)?;
        let count = d.require_u32("count")?;
        let desc = wgt::QuerySetDescriptor {
            label: super::wgpu_label(&label),
            ty: kind.to_wgt(),
            count,
        };
        let (id, err) = instance().device_create_query_set(device.id(), &desc, None);
        let raw = bun_webgpu::QuerySet::new(id);
        device.check(global, err)?;
        Ok(GPUQuerySet {
            raw,
            label: JsCell::new(label),
            kind,
            count,
            destroyed: Cell::new(false),
        }
        .to_js(global))
    }

    pub(crate) fn destroy(
        &self,
        _global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if !self.destroyed.replace(true) {
            instance().query_set_destroy(self.raw.id());
        }
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn get_type(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_core::String::static_(names::query_type_name(self.kind)).to_js(global)
    }

    pub(crate) fn get_count(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number_from_uint64(u64::from(self.count))
    }
}
