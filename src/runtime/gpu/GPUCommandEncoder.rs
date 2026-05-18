use std::sync::{Arc, Mutex};

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsCell, JsClass as _, JsResult};

use super::GPUBuffer::GpuBufferState;
use super::GPUCommandBuffer::GPUCommandBuffer;
use super::GPUComputePassEncoder::{ComputeCommand, GPUComputePassEncoder};
use super::inner::GpuDeviceInner;

pub enum EncoderCommand {
    ComputePass {
        label: Option<String>,
        commands: Arc<Mutex<Vec<ComputeCommand>>>,
    },
    CopyBufferToBuffer {
        src: Arc<Mutex<GpuBufferState>>,
        src_offset: u64,
        dst: Arc<Mutex<GpuBufferState>>,
        dst_offset: u64,
        size: u64,
    },
}

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct GPUCommandEncoder {
    pub inner: Arc<GpuDeviceInner>,
    pub commands: JsCell<Vec<EncoderCommand>>,
    pub label: JsCell<String>,
}

impl GPUCommandEncoder {
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

    #[bun_jsc::host_fn(method)]
    pub fn begin_compute_pass(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let descriptor = callframe.argument(0);
        let label = if descriptor.is_object() {
            match descriptor.get(global, b"label")? {
                Some(v) if v.is_string() => {
                    let s = v.to_bun_string(global)?;
                    Some(String::from_utf8_lossy(s.to_utf8().slice()).into_owned())
                }
                _ => None,
            }
        } else {
            None
        };

        let commands_arc = Arc::new(Mutex::new(Vec::<ComputeCommand>::new()));
        let pass_val = GPUComputePassEncoder {
            commands: JsCell::new(Arc::clone(&commands_arc)),
            label: JsCell::new(label.clone().unwrap_or_default()),
        }
        .to_js(global);

        this.commands.with_mut(|cmds| {
            cmds.push(EncoderCommand::ComputePass {
                label,
                commands: commands_arc,
            });
        });

        Ok(pass_val)
    }

    #[bun_jsc::host_fn(method)]
    pub fn begin_render_pass(
        _this: &Self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Err(global.throw(format_args!(
            "GPUCommandEncoder.beginRenderPass: render pipelines are not supported in this build"
        )))
    }

    #[bun_jsc::host_fn(method)]
    pub fn copy_buffer_to_buffer(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let src_val = callframe.argument(0);
        let src_offset = callframe.argument(1).as_number() as u64;
        let dst_val = callframe.argument(2);
        let dst_offset = callframe.argument(3).as_number() as u64;
        let size = callframe.argument(4).as_number() as u64;

        let src_ptr = super::GPUBuffer::GPUBuffer::from_js(src_val).ok_or_else(|| {
            global.throw(format_args!("copyBufferToBuffer: src must be a GPUBuffer"))
        })?;
        let dst_ptr = super::GPUBuffer::GPUBuffer::from_js(dst_val).ok_or_else(|| {
            global.throw(format_args!("copyBufferToBuffer: dst must be a GPUBuffer"))
        })?;

        let src_arc = Arc::clone(&unsafe { &*src_ptr }.buffer_state);
        let dst_arc = Arc::clone(&unsafe { &*dst_ptr }.buffer_state);

        this.commands.with_mut(|cmds| {
            cmds.push(EncoderCommand::CopyBufferToBuffer {
                src: src_arc,
                src_offset,
                dst: dst_arc,
                dst_offset,
                size,
            });
        });

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn copy_buffer_to_texture(
        _this: &Self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Err(global.throw(format_args!(
            "GPUCommandEncoder.copyBufferToTexture: not yet implemented"
        )))
    }

    #[bun_jsc::host_fn(method)]
    pub fn copy_texture_to_buffer(
        _this: &Self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Err(global.throw(format_args!(
            "GPUCommandEncoder.copyTextureToBuffer: not yet implemented"
        )))
    }

    #[bun_jsc::host_fn(method)]
    pub fn copy_texture_to_texture(
        _this: &Self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Err(global.throw(format_args!(
            "GPUCommandEncoder.copyTextureToTexture: not yet implemented"
        )))
    }

    #[bun_jsc::host_fn(method)]
    pub fn clear_buffer(
        _this: &Self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Err(global.throw(format_args!(
            "GPUCommandEncoder.clearBuffer: not yet implemented"
        )))
    }

    #[bun_jsc::host_fn(method)]
    pub fn resolve_query_set(
        _this: &Self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Err(global.throw(format_args!(
            "GPUCommandEncoder.resolveQuerySet: not yet implemented"
        )))
    }

    #[bun_jsc::host_fn(method)]
    pub fn finish(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let descriptor = callframe.argument(0);
        let label = if descriptor.is_object() {
            match descriptor.get(global, b"label")? {
                Some(v) if v.is_string() => {
                    let s = v.to_bun_string(global)?;
                    Some(String::from_utf8_lossy(s.to_utf8().slice()).into_owned())
                }
                _ => None,
            }
        } else {
            None
        };

        let mut wgpu_encoder =
            this.inner
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: label.as_deref(),
                });

        let commands = this.commands.with_mut(|c| std::mem::take(c));

        for cmd in commands {
            match cmd {
                EncoderCommand::ComputePass { label, commands } => {
                    let commands_guard = commands.lock().unwrap();
                    {
                        let mut pass =
                            wgpu_encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                                label: label.as_deref(),
                                timestamp_writes: None,
                            });
                        for compute_cmd in commands_guard.iter() {
                            match compute_cmd {
                                ComputeCommand::SetPipeline(pipeline) => {
                                    pass.set_pipeline(pipeline);
                                }
                                ComputeCommand::SetBindGroup {
                                    index,
                                    group,
                                    dynamic_offsets,
                                } => {
                                    pass.set_bind_group(
                                        *index,
                                        Some(group.as_ref()),
                                        dynamic_offsets,
                                    );
                                }
                                ComputeCommand::DispatchWorkgroups { x, y, z } => {
                                    pass.dispatch_workgroups(*x, *y, *z);
                                }
                            }
                        }
                    } // pass dropped here → ends the compute pass
                }
                EncoderCommand::CopyBufferToBuffer {
                    src,
                    src_offset,
                    dst,
                    dst_offset,
                    size,
                } => {
                    let src_state = src.lock().unwrap();
                    let dst_state = dst.lock().unwrap();
                    let src_buf = src_state.buffer.as_ref().ok_or_else(|| {
                        global.throw(format_args!(
                            "copyBufferToBuffer: src buffer has been destroyed"
                        ))
                    })?;
                    let dst_buf = dst_state.buffer.as_ref().ok_or_else(|| {
                        global.throw(format_args!(
                            "copyBufferToBuffer: dst buffer has been destroyed"
                        ))
                    })?;
                    wgpu_encoder
                        .copy_buffer_to_buffer(src_buf, src_offset, dst_buf, dst_offset, size);
                }
            }
        }

        let command_buffer = wgpu_encoder.finish();
        Ok(GPUCommandBuffer {
            command_buffer: std::cell::Cell::new(Some(command_buffer)),
            label: JsCell::new(label.unwrap_or_default()),
        }
        .to_js(global))
    }
}
