use std::sync::{Arc, Mutex};

use bun_jsc::{
    CallFrame, JSGlobalObject, JSPromiseStrong, JSValue, JsCell, JsClass as _, JsResult,
};

use super::GPUBindGroup::GPUBindGroup;
use super::GPUBindGroupLayout::GPUBindGroupLayout;
use super::GPUBuffer::GPUBuffer;
use super::GPUCommandEncoder::GPUCommandEncoder;
use super::GPUComputePipeline::GPUComputePipeline;
use super::GPUPipelineLayout::GPUPipelineLayout;
use super::GPUQueue::GPUQueue;
use super::GPUShaderModule::GPUShaderModule;
use super::inner::GpuDeviceInner;

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct GPUDevice {
    pub inner: Arc<GpuDeviceInner>,
    pub label: JsCell<String>,
}

impl GPUDevice {
    pub fn get_label(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, this.label.get().as_bytes())
    }

    pub fn set_label(this: &Self, global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
        if value.is_string() {
            if let Ok(s) = value.to_bun_string(global) {
                let owned = String::from_utf8_lossy(s.to_utf8().slice()).into_owned();
                this.label.set(owned);
            }
        }
        Ok(true)
    }

    pub fn get_features(_this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::create_empty_object(global, 0))
    }

    pub fn get_limits(_this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::create_empty_object(global, 0))
    }

    pub fn get_adapter_info(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let info = &this.inner.adapter_info;
        let obj = JSValue::create_empty_object(global, 4);
        obj.put(
            global,
            b"vendor",
            bun_jsc::bun_string_jsc::create_utf8_for_js(
                global,
                info.vendor.to_string().as_bytes(),
            )?,
        );
        obj.put(
            global,
            b"architecture",
            bun_jsc::bun_string_jsc::create_utf8_for_js(global, info.name.as_bytes())?,
        );
        obj.put(
            global,
            b"device",
            bun_jsc::bun_string_jsc::create_utf8_for_js(
                global,
                info.device.to_string().as_bytes(),
            )?,
        );
        obj.put(
            global,
            b"description",
            bun_jsc::bun_string_jsc::create_utf8_for_js(global, info.driver.as_bytes())?,
        );
        Ok(obj)
    }

    pub fn get_queue(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let queue_obj = GPUQueue {
            inner: Arc::clone(&this.inner),
            label: JsCell::new(String::new()),
        }
        .to_js(global);
        Ok(queue_obj)
    }

    pub fn get_lost(_this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        // Return a never-resolving promise
        let mut promise = JSPromiseStrong::init(global);
        Ok(promise.value())
    }

    #[bun_jsc::host_fn(method)]
    pub fn create_buffer(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let descriptor = callframe.argument(0);
        if !descriptor.is_object() {
            return Err(global.throw(format_args!("GPUDevice.createBuffer requires a descriptor")));
        }

        let size = match descriptor.get(global, b"size")? {
            Some(v) if v.is_number() => v.as_number() as u64,
            _ => return Err(global.throw(format_args!("GPUDevice.createBuffer: size is required"))),
        };

        let usage_bits = match descriptor.get(global, b"usage")? {
            Some(v) if v.is_number() => v.as_number() as u32,
            _ => {
                return Err(global.throw(format_args!("GPUDevice.createBuffer: usage is required")));
            }
        };
        let usage = wgpu::BufferUsages::from_bits_truncate(usage_bits);

        let mapped_at_creation = match descriptor.get(global, b"mappedAtCreation")? {
            Some(v) => v.to_boolean(),
            None => false,
        };

        let label_str = get_label_str(global, descriptor)?;

        let wgpu_buffer = this.inner.device.create_buffer(&wgpu::BufferDescriptor {
            label: label_str.as_deref(),
            size,
            usage,
            mapped_at_creation,
        });

        let state = if mapped_at_creation {
            super::GPUBuffer::MapStateKind::MappedWrite
        } else {
            super::GPUBuffer::MapStateKind::Unmapped
        };

        let js_buf = GPUBuffer {
            buffer_state: Arc::new(Mutex::new(super::GPUBuffer::GpuBufferState {
                buffer: Some(wgpu_buffer),
                inner: Arc::clone(&this.inner),
                size,
                usage: usage_bits,
                map_state: state,
                mapped_data: None,
            })),
            label: JsCell::new(label_str.unwrap_or_default()),
        }
        .to_js(global);

        Ok(js_buf)
    }

    #[bun_jsc::host_fn(method)]
    pub fn create_shader_module(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let descriptor = callframe.argument(0);
        if !descriptor.is_object() {
            return Err(global.throw(format_args!(
                "GPUDevice.createShaderModule requires a descriptor"
            )));
        }

        let code = match descriptor.get(global, b"code")? {
            Some(v) if v.is_string() => {
                let s = v.to_bun_string(global)?;
                String::from_utf8_lossy(s.to_utf8().slice()).into_owned()
            }
            _ => {
                return Err(global.throw(format_args!(
                    "GPUDevice.createShaderModule: code is required"
                )));
            }
        };

        let label_str = get_label_str(global, descriptor)?;

        let module = this
            .inner
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: label_str.as_deref(),
                source: wgpu::ShaderSource::Wgsl(std::borrow::Cow::Owned(code)),
            });

        Ok(GPUShaderModule {
            module,
            label: JsCell::new(label_str.unwrap_or_default()),
        }
        .to_js(global))
    }

    #[bun_jsc::host_fn(method)]
    pub fn create_bind_group_layout(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let descriptor = callframe.argument(0);
        if !descriptor.is_object() {
            return Err(global.throw(format_args!(
                "GPUDevice.createBindGroupLayout requires a descriptor"
            )));
        }

        let label_str = get_label_str(global, descriptor)?;

        let entries_val = descriptor
            .get(global, b"entries")?
            .unwrap_or(JSValue::UNDEFINED);
        let entries = parse_bind_group_layout_entries(global, entries_val)?;

        let layout = this
            .inner
            .device
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: label_str.as_deref(),
                entries: &entries,
            });

        Ok(GPUBindGroupLayout {
            layout: Arc::new(layout),
            label: JsCell::new(label_str.unwrap_or_default()),
        }
        .to_js(global))
    }

    #[bun_jsc::host_fn(method)]
    pub fn create_pipeline_layout(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let descriptor = callframe.argument(0);
        if !descriptor.is_object() {
            return Err(global.throw(format_args!(
                "GPUDevice.createPipelineLayout requires a descriptor"
            )));
        }

        let label_str = get_label_str(global, descriptor)?;

        let layouts_val = descriptor
            .get(global, b"bindGroupLayouts")?
            .unwrap_or(JSValue::UNDEFINED);
        let bind_group_layouts = collect_bind_group_layouts(global, layouts_val)?;
        let layout_refs: Vec<Option<&wgpu::BindGroupLayout>> = bind_group_layouts
            .iter()
            .map(|arc| Some(arc.as_ref()))
            .collect();

        let pipeline_layout =
            this.inner
                .device
                .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: label_str.as_deref(),
                    bind_group_layouts: &layout_refs,
                    immediate_size: 0,
                });

        Ok(GPUPipelineLayout {
            layout: pipeline_layout,
            bind_group_layouts,
            label: JsCell::new(label_str.unwrap_or_default()),
        }
        .to_js(global))
    }

    #[bun_jsc::host_fn(method)]
    pub fn create_compute_pipeline(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let descriptor = callframe.argument(0);
        if !descriptor.is_object() {
            return Err(global.throw(format_args!(
                "GPUDevice.createComputePipeline requires a descriptor"
            )));
        }

        let label_str = get_label_str(global, descriptor)?;

        // Parse layout: "auto" (string) → None; GPUPipelineLayout → Some(&layout)
        let layout_val = descriptor
            .get(global, b"layout")?
            .unwrap_or(JSValue::UNDEFINED);

        // Parse compute stage
        let compute_val = descriptor.get(global, b"compute")?.ok_or_else(|| {
            global.throw(format_args!(
                "GPUDevice.createComputePipeline: compute stage is required"
            ))
        })?;

        let module_val = compute_val.get(global, b"module")?.ok_or_else(|| {
            global.throw(format_args!(
                "GPUDevice.createComputePipeline: compute.module is required"
            ))
        })?;

        let entry_point = match compute_val.get(global, b"entryPoint")? {
            Some(v) if v.is_string() => {
                let s = v.to_bun_string(global)?;
                String::from_utf8_lossy(s.to_utf8().slice()).into_owned()
            }
            _ => String::from("main"),
        };

        let module_ptr = GPUShaderModule::from_js(module_val).ok_or_else(|| {
            global.throw(format_args!(
                "GPUDevice.createComputePipeline: compute.module must be a GPUShaderModule"
            ))
        })?;
        let module_ref = unsafe { &*module_ptr };

        // We need to hold the PipelineLayout reference alive for the duration of the call.
        // Use a raw pointer approach: the JS value keeps the object alive.
        let pipeline = if !layout_val.is_string() && !layout_val.is_undefined_or_null() {
            let layout_ptr = GPUPipelineLayout::from_js(layout_val)
                .ok_or_else(|| global.throw(format_args!("GPUDevice.createComputePipeline: layout must be a GPUPipelineLayout or \"auto\"")))?;
            let layout_ref = unsafe { &*layout_ptr };
            this.inner
                .device
                .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                    label: label_str.as_deref(),
                    layout: Some(&layout_ref.layout),
                    module: &module_ref.module,
                    entry_point: Some(&entry_point),
                    compilation_options: Default::default(),
                    cache: None,
                })
        } else {
            this.inner
                .device
                .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                    label: label_str.as_deref(),
                    layout: None,
                    module: &module_ref.module,
                    entry_point: Some(&entry_point),
                    compilation_options: Default::default(),
                    cache: None,
                })
        };

        Ok(GPUComputePipeline {
            pipeline: Arc::new(pipeline),
            label: JsCell::new(label_str.unwrap_or_default()),
        }
        .to_js(global))
    }

    #[bun_jsc::host_fn(method)]
    pub fn create_compute_pipeline_async(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // Synchronous under the hood for now - wrap in a resolved promise
        let result = Self::create_compute_pipeline(this, global, callframe)?;
        let mut promise = JSPromiseStrong::init(global);
        let value = promise.value();
        let mut p = promise.swap();
        p.resolve(global, result)?;
        Ok(value)
    }

    #[bun_jsc::host_fn(method)]
    pub fn create_bind_group(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let descriptor = callframe.argument(0);
        if !descriptor.is_object() {
            return Err(global.throw(format_args!(
                "GPUDevice.createBindGroup requires a descriptor"
            )));
        }

        let label_str = get_label_str(global, descriptor)?;

        let layout_val = descriptor.get(global, b"layout")?.ok_or_else(|| {
            global.throw(format_args!(
                "GPUDevice.createBindGroup: layout is required"
            ))
        })?;

        let layout_ptr = GPUBindGroupLayout::from_js(layout_val).ok_or_else(|| {
            global.throw(format_args!(
                "GPUDevice.createBindGroup: layout must be a GPUBindGroupLayout"
            ))
        })?;
        let layout_ref = unsafe { &*layout_ptr };

        let entries_val = descriptor
            .get(global, b"entries")?
            .unwrap_or(JSValue::UNDEFINED);
        let entries = parse_bind_group_entries(global, entries_val)?;

        let bind_group = this
            .inner
            .device
            .create_bind_group(&wgpu::BindGroupDescriptor {
                label: label_str.as_deref(),
                layout: &layout_ref.layout,
                entries: &entries,
            });

        Ok(GPUBindGroup {
            group: Arc::new(bind_group),
            label: JsCell::new(label_str.unwrap_or_default()),
        }
        .to_js(global))
    }

    #[bun_jsc::host_fn(method)]
    pub fn create_command_encoder(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let descriptor = callframe.argument(0);
        let label_str = if descriptor.is_object() {
            get_label_str(global, descriptor)?
        } else {
            None
        };

        Ok(GPUCommandEncoder {
            inner: Arc::clone(&this.inner),
            commands: JsCell::new(Vec::new()),
            label: JsCell::new(label_str.unwrap_or_default()),
        }
        .to_js(global))
    }

    #[bun_jsc::host_fn(method)]
    pub fn create_query_set(
        _this: &Self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Err(global.throw(format_args!("GPUQuerySet is not yet supported")))
    }

    #[bun_jsc::host_fn(method)]
    pub fn destroy(
        this: &Self,
        _global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        this.inner.device.destroy();
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn push_error_scope(
        _this: &Self,
        _global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn pop_error_scope(
        _this: &Self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut promise = JSPromiseStrong::init(global);
        let value = promise.value();
        let mut p = promise.swap();
        p.resolve(global, JSValue::NULL)?;
        Ok(value)
    }
}

// ── Descriptor parsing helpers ─────────────────────────────────────────────

fn get_label_str(global: &JSGlobalObject, descriptor: JSValue) -> JsResult<Option<String>> {
    match descriptor.get(global, b"label")? {
        Some(v) if v.is_string() => {
            let s = v.to_bun_string(global)?;
            Ok(Some(
                String::from_utf8_lossy(s.to_utf8().slice()).into_owned(),
            ))
        }
        _ => Ok(None),
    }
}

fn parse_bind_group_layout_entries(
    global: &JSGlobalObject,
    entries_val: JSValue,
) -> JsResult<Vec<wgpu::BindGroupLayoutEntry>> {
    if entries_val.is_undefined_or_null() || !entries_val.is_object() {
        return Ok(Vec::new());
    }

    let length = entries_val.get_length(global)? as u32;
    let mut entries = Vec::with_capacity(length as usize);

    for i in 0..length {
        let entry = JSValue::get_index(entries_val, global, i)?;
        if !entry.is_object() {
            continue;
        }

        let binding = entry
            .get(global, b"binding")?
            .map(|v| v.as_number() as u32)
            .unwrap_or(0);

        let visibility_bits = entry
            .get(global, b"visibility")?
            .map(|v| v.as_number() as u32)
            .unwrap_or(4); // COMPUTE
        let visibility = wgpu::ShaderStages::from_bits_truncate(visibility_bits);

        // Determine binding type from the entry's sub-descriptors
        let binding_type = if let Some(buffer_desc) = entry.get(global, b"buffer")? {
            if buffer_desc.is_object() {
                let type_str = buffer_desc
                    .get(global, b"type")?
                    .and_then(|v| {
                        if v.is_string() {
                            v.to_bun_string(global)
                                .ok()
                                .map(|s| String::from_utf8_lossy(s.to_utf8().slice()).into_owned())
                        } else {
                            None
                        }
                    })
                    .unwrap_or_else(|| "uniform".to_string());

                let has_dynamic_offset = buffer_desc
                    .get(global, b"hasDynamicOffset")?
                    .map(|v| v.to_boolean())
                    .unwrap_or(false);

                let buf_type = match type_str.as_str() {
                    "storage" => wgpu::BufferBindingType::Storage { read_only: false },
                    "read-only-storage" => wgpu::BufferBindingType::Storage { read_only: true },
                    _ => wgpu::BufferBindingType::Uniform,
                };

                wgpu::BindingType::Buffer {
                    ty: buf_type,
                    has_dynamic_offset,
                    min_binding_size: None,
                }
            } else {
                wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                }
            }
        } else {
            // Default to uniform buffer
            wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: false,
                min_binding_size: None,
            }
        };

        entries.push(wgpu::BindGroupLayoutEntry {
            binding,
            visibility,
            ty: binding_type,
            count: None,
        });
    }

    Ok(entries)
}

fn collect_bind_group_layouts(
    global: &JSGlobalObject,
    layouts_val: JSValue,
) -> JsResult<Vec<Arc<wgpu::BindGroupLayout>>> {
    if layouts_val.is_undefined_or_null() || !layouts_val.is_object() {
        return Ok(Vec::new());
    }

    let length = layouts_val.get_length(global)? as u32;
    let mut layouts = Vec::with_capacity(length as usize);

    for i in 0..length {
        let element = JSValue::get_index(layouts_val, global, i)?;
        let ptr = GPUBindGroupLayout::from_js(element).ok_or_else(|| {
            global.throw(format_args!(
                "bindGroupLayouts must contain GPUBindGroupLayout objects"
            ))
        })?;
        // SAFETY: the JSValue is alive during this call
        let layout_ref = unsafe { &*ptr };
        layouts.push(Arc::clone(&layout_ref.layout));
    }

    Ok(layouts)
}

fn parse_bind_group_entries<'a>(
    global: &JSGlobalObject,
    entries_val: JSValue,
) -> JsResult<Vec<wgpu::BindGroupEntry<'a>>> {
    if entries_val.is_undefined_or_null() || !entries_val.is_object() {
        return Ok(Vec::new());
    }

    let length = entries_val.get_length(global)? as u32;
    let mut entries = Vec::with_capacity(length as usize);

    for i in 0..length {
        let entry = JSValue::get_index(entries_val, global, i)?;
        if !entry.is_object() {
            continue;
        }

        let binding = entry
            .get(global, b"binding")?
            .map(|v| v.as_number() as u32)
            .unwrap_or(0);

        let resource_val = entry.get(global, b"resource")?.ok_or_else(|| {
            global.throw(format_args!(
                "bind group entry {} missing resource",
                binding
            ))
        })?;

        let resource = if resource_val.is_object() {
            // Check if it's a buffer binding descriptor { buffer, offset?, size? }
            if let Some(buffer_val) = resource_val.get(global, b"buffer")? {
                let buf_ptr = GPUBuffer::from_js(buffer_val).ok_or_else(|| {
                    global.throw(format_args!("resource.buffer must be a GPUBuffer"))
                })?;
                let buf_ref = unsafe { &*buf_ptr };
                let state = buf_ref.buffer_state.lock().unwrap();
                let buffer = state.buffer.as_ref().ok_or_else(|| {
                    global.throw(format_args!("GPUBuffer is in invalid state for binding"))
                })?;

                let offset = resource_val
                    .get(global, b"offset")?
                    .map(|v| v.as_number() as u64)
                    .unwrap_or(0);
                let size_opt = resource_val
                    .get(global, b"size")?
                    .map(|v| wgpu::BufferSize::new(v.as_number() as u64))
                    .flatten();

                wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                    buffer: unsafe { &*(buffer as *const wgpu::Buffer) },
                    offset,
                    size: size_opt,
                })
            } else {
                return Err(
                    global.throw(format_args!("bind group entry resource must have a buffer"))
                );
            }
        } else {
            return Err(global.throw(format_args!("bind group entry resource must be an object")));
        };

        entries.push(wgpu::BindGroupEntry { binding, resource });
    }

    Ok(entries)
}
