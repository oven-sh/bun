//! `GPUComputePassEncoder`.

use std::rc::Rc;

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsCell, JsClass, JsResult};
use bun_webgpu::wgc::command::{ComputePassDescriptor, PassTimestampWrites};
use bun_webgpu::{instance, wgc};

use super::args::{self, Dict, Held};
use super::bind::parse_set_bind_group;
use super::device::DeviceRef;
use super::{GPUBuffer, GPUComputePipeline, GPUQuerySet};

#[bun_jsc::JsClass]
pub(crate) struct GPUComputePassEncoder {
    device: DeviceRef,
    raw: bun_webgpu::ComputePassEncoder,
    label: JsCell<bun_core::String>,
}

super::gpu_object!(GPUComputePassEncoder, label);

/// `GPUComputePassTimestampWrites` / `GPURenderPassTimestampWrites`.
pub(crate) fn parse_timestamp_writes(
    d: &Dict<'_>,
    name: &'static str,
    held: &mut Held,
) -> JsResult<Option<PassTimestampWrites>> {
    let Some(t) = d.dict("timestampWrites", name)? else {
        return Ok(None);
    };
    Ok(Some(PassTimestampWrites {
        query_set: t.require_id::<GPUQuerySet>(held, "querySet", "GPUQuerySet")?,
        beginning_of_pass_write_index: t.u32("beginningOfPassWriteIndex")?,
        end_of_pass_write_index: t.u32("endOfPassWriteIndex")?,
    }))
}

impl GPUComputePassEncoder {
    pub(crate) fn begin(
        global: &JSGlobalObject,
        device: &DeviceRef,
        encoder: wgc::id::CommandEncoderId,
        descriptor: JSValue,
    ) -> JsResult<JSValue> {
        let d = Dict::new(global, descriptor, "GPUComputePassDescriptor")?;
        let label = d.label()?;
        let mut held = Held::default();
        let desc = ComputePassDescriptor {
            label: super::wgpu_label(&label),
            timestamp_writes: parse_timestamp_writes(
                &d,
                "GPUComputePassTimestampWrites",
                &mut held,
            )?,
        };
        let (id, err) = instance().command_encoder_begin_compute_pass_with_id(encoder, &desc, None);
        drop(held);
        let raw = bun_webgpu::ComputePassEncoder::new(id);
        device.check(global, err)?;
        let pass = GPUComputePassEncoder {
            device: Rc::clone(device),
            raw,
            label: JsCell::new(label),
        }
        .to_js(global);
        Ok(device.adopt(
            global,
            pass,
            crate::generated_classes::js_GPUComputePassEncoder::device_set_cached,
        ))
    }

    pub(crate) fn set_pipeline(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut held = Held::default();
        let pipeline = held.id::<GPUComputePipeline>(
            global,
            callframe.argument(0),
            "setPipeline",
            "GPUComputePipeline",
        )?;
        let result = instance().compute_pass_set_pipeline_with_id(self.raw.id(), pipeline);
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn set_bind_group(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut held = Held::default();
        let (index, bind_group, offsets) = parse_set_bind_group(global, callframe, &mut held)?;
        let result = instance().compute_pass_set_bind_group_with_id(
            self.raw.id(),
            index,
            bind_group,
            &offsets,
        );
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn dispatch_workgroups(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let count = |i: usize, what: &str| -> JsResult<u32> {
            match callframe.argument(i) {
                v if i > 0 && v.is_undefined() => Ok(1),
                v => args::to_u32(global, v, what),
            }
        };
        let x = count(0, "dispatchWorkgroups: workgroupCountX")?;
        let y = count(1, "dispatchWorkgroups: workgroupCountY")?;
        let z = count(2, "dispatchWorkgroups: workgroupCountZ")?;
        let result = instance().compute_pass_dispatch_workgroups_with_id(self.raw.id(), x, y, z);
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn dispatch_workgroups_indirect(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut held = Held::default();
        let buffer = held.id::<GPUBuffer>(
            global,
            callframe.argument(0),
            "dispatchWorkgroupsIndirect",
            "GPUBuffer",
        )?;
        let offset = args::to_u64(
            global,
            callframe.argument(1),
            "dispatchWorkgroupsIndirect: indirectOffset",
        )?;
        let result = instance().compute_pass_dispatch_workgroups_indirect_with_id(
            self.raw.id(),
            buffer,
            offset,
        );
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn push_debug_group(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let label = args::to_string(global, callframe.argument(0))?;
        let result = instance().compute_pass_push_debug_group_with_id(self.raw.id(), &label, 0);
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn pop_debug_group(
        &self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let result = instance().compute_pass_pop_debug_group_with_id(self.raw.id());
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn insert_debug_marker(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let label = args::to_string(global, callframe.argument(0))?;
        let result = instance().compute_pass_insert_debug_marker_with_id(self.raw.id(), &label, 0);
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn end(&self, global: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
        let result = instance().compute_pass_end_with_id(self.raw.id());
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }
}
