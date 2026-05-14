use std::sync::{Arc, Mutex};

use bun_jsc::{
    AnyTaskJob, AnyTaskJobCtx, ArrayBuffer, CallFrame, JSGlobalObject, JSPromiseStrong, JSType,
    JSValue, JsCell, JsResult,
};

use super::inner::GpuDeviceInner;

#[derive(Clone, Copy, PartialEq)]
pub enum MapStateKind {
    Unmapped,
    Pending,
    MappedRead,
    MappedWrite,
}

pub struct GpuBufferState {
    pub buffer: Option<wgpu::Buffer>,
    pub inner: Arc<GpuDeviceInner>,
    pub size: u64,
    pub usage: u32,
    pub map_state: MapStateKind,
    pub mapped_data: Option<Vec<u8>>,
}

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct GPUBuffer {
    pub buffer_state: Arc<Mutex<GpuBufferState>>,
    pub label: JsCell<String>,
}

impl GPUBuffer {
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

    pub fn get_size(this: &Self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        let state = this.buffer_state.lock().unwrap();
        Ok(JSValue::js_number_from_uint64(state.size))
    }

    pub fn get_usage(this: &Self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        let state = this.buffer_state.lock().unwrap();
        Ok(JSValue::js_number(state.usage as f64))
    }

    pub fn get_map_state(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let state = this.buffer_state.lock().unwrap();
        let s: &[u8] = match state.map_state {
            MapStateKind::Unmapped => b"unmapped",
            MapStateKind::Pending => b"pending",
            MapStateKind::MappedRead | MapStateKind::MappedWrite => b"mapped",
        };
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, s)
    }

    #[bun_jsc::host_fn(method)]
    pub fn map_async(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let mode = callframe.argument(0).as_number() as u32;

        {
            let mut state = this.buffer_state.lock().unwrap();
            if state.map_state != MapStateKind::Unmapped {
                return Err(global.throw(format_args!(
                    "GPUBuffer.mapAsync: buffer is not in unmapped state"
                )));
            }
            state.map_state = MapStateKind::Pending;
        }

        let promise = JSPromiseStrong::init(global);
        let promise_value = promise.value();

        AnyTaskJob::create_and_schedule(
            global,
            MapAsyncTask {
                buffer_state: Arc::clone(&this.buffer_state),
                mode,
                promise,
                error: None,
            },
        )?;

        Ok(promise_value)
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_mapped_range(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let offset = if callframe.arguments_count() > 0 {
            let v = callframe.argument(0);
            if v.is_number() {
                v.as_number() as usize
            } else {
                0
            }
        } else {
            0
        };
        let state = this.buffer_state.lock().unwrap();
        match state.map_state {
            MapStateKind::MappedRead | MapStateKind::MappedWrite => {
                if let Some(data) = &state.mapped_data {
                    let size = if callframe.arguments_count() > 1 {
                        let v = callframe.argument(1);
                        if v.is_number() {
                            v.as_number() as usize
                        } else {
                            data.len().saturating_sub(offset)
                        }
                    } else {
                        data.len().saturating_sub(offset)
                    };
                    let end = (offset + size).min(data.len());
                    let slice = &data[offset..end];
                    ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global, slice)
                } else {
                    ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global, &[])
                }
            }
            _ => Err(global.throw(format_args!(
                "GPUBuffer.getMappedRange: buffer is not mapped"
            ))),
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn unmap(
        this: &Self,
        _global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut state = this.buffer_state.lock().unwrap();
        state.mapped_data = None;
        state.map_state = MapStateKind::Unmapped;
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn destroy(
        this: &Self,
        _global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut state = this.buffer_state.lock().unwrap();
        if let Some(buffer) = state.buffer.take() {
            buffer.destroy();
        }
        Ok(JSValue::UNDEFINED)
    }
}

// ── Async task: map_async ────────────────────────────────────────────────────

const GPU_MAP_READ: u32 = 1;

struct MapAsyncTask {
    buffer_state: Arc<Mutex<GpuBufferState>>,
    mode: u32,
    promise: JSPromiseStrong,
    error: Option<String>,
}

// SAFETY: Arc<Mutex<GpuBufferState>> is Send; wgpu types are Send
unsafe impl Send for MapAsyncTask {}

impl AnyTaskJobCtx for MapAsyncTask {
    fn run(&mut self, _global: *mut JSGlobalObject) {
        // Take the buffer out while we work so the mutex isn't held during poll
        let (buffer, inner, size) = {
            let mut state = self.buffer_state.lock().unwrap();
            let inner = Arc::clone(&state.inner);
            let size = state.size;
            match state.buffer.take() {
                Some(b) => (b, inner, size),
                None => {
                    self.error = Some("GPUBuffer has been destroyed".to_string());
                    state.map_state = MapStateKind::Unmapped;
                    return;
                }
            }
        };

        if self.mode == GPU_MAP_READ {
            let (tx, rx) = std::sync::mpsc::channel::<Result<(), wgpu::BufferAsyncError>>();
            buffer
                .slice(..)
                .map_async(wgpu::MapMode::Read, move |result| {
                    let _ = tx.send(result);
                });
            let _ = inner.device.poll(wgpu::PollType::wait_indefinitely());

            match rx.recv() {
                Ok(Ok(())) => {
                    let data = buffer.slice(..).get_mapped_range().to_vec();
                    buffer.unmap();
                    let mut state = self.buffer_state.lock().unwrap();
                    state.buffer = Some(buffer);
                    state.mapped_data = Some(data);
                    state.map_state = MapStateKind::MappedRead;
                }
                _ => {
                    let mut state = self.buffer_state.lock().unwrap();
                    state.buffer = Some(buffer);
                    state.map_state = MapStateKind::Unmapped;
                    self.error = Some("GPUBuffer mapping failed".to_string());
                }
            }
        } else {
            // MAP_WRITE: create a staging buffer
            let staged = vec![0u8; size as usize];
            let mut state = self.buffer_state.lock().unwrap();
            state.buffer = Some(buffer);
            state.mapped_data = Some(staged);
            state.map_state = MapStateKind::MappedWrite;
        }
    }

    fn then(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        let mut promise = self.promise.swap();
        if let Some(err) = self.error.take() {
            let js_err = global.throw(format_args!("{}", err));
            promise.reject_with_async_stack(global, Err(js_err))?;
        } else {
            promise.resolve(global, JSValue::UNDEFINED)?;
        }
        Ok(())
    }
}
