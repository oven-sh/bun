use core::cell::{Cell, RefCell};
use core::ptr;
use core::sync::atomic::{AtomicPtr, Ordering};
use std::rc::{Rc, Weak};
use std::sync::Arc;

use bun_collections::ArrayHashMap;
use bun_collections::smallvec::SmallVec;
use bun_core::String;
use bun_dawn_sys::{
    self as dawn, AllLimits, Chain, DeviceLostReason, ErrorType, FeatureName, Host as _,
    LoggingType, OwnedAdapter, OwnedDevice, Serial, Wake,
};
use bun_jsc::bindgen::{Error, EventBase, JsHeap, JsPayload as _, JsScope, JsWrapper, Result};
use bun_jsc::console_object::{self, MessageLevel, MessageType};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    AbortCause, AbortHandle, DOMExceptionCode, JSGlobalObject, JSPromise, JSValue, JsCell,
    JsClass as _, JsError, JsResult, StopReason, Strong,
};
use bun_threading::Guarded;

use super::buffer::Buffer;
use super::convert::{self, size_or_whole};
use super::instance::{Deferred, Host, Instance, Operation, Origin};
use super::pipeline::{create_pipeline_error, with_compute_pipeline_descriptor};
use super::{
    Child, GPUAdapterInfo, GPUBindGroup, GPUBindGroupLayout, GPUBuffer, GPUCommandEncoder,
    GPUComputePipeline, GPUDeviceLostInfo, GPUError, GPUPipelineLayout, GPUQueue,
    GPURenderBundleEncoder, GPURenderPipeline, GPUSampler, GPUShaderModule, GPUSupportedFeatures,
    GPUSupportedLimits, GPUTexture, GPUUncapturedErrorEvent, Object, idl,
};

bun_core::declare_scope!(WebGPU, hidden);

const MAX_WARNINGS: u32 = 500;
/// So that devices nobody refers to are collected before the driver runs out of them.
const ESTIMATED_SIZE_OF_DEVICE: usize = 16 * 1024 * 1024;

/// For what loads a driver or can compile a shader, be it one of Dawn's own. Neither checks how much stack is left.
pub(super) fn check_stack<'a>(heap: &JsHeap<'a>) -> Result<'a, ()> {
    const NEEDED: usize = if cfg!(bun_asan) { 2 } else { 1 } * 1024 * 1024;
    if bun_core::StackCheck::init().is_safe_to_recurse_with_extra(NEEDED) {
        return Ok(());
    }
    // SAFETY: the callers return the error.
    Err(unsafe { heap.global() }.throw_stack_overflow().into())
}

enum Event {
    UncapturedError(ErrorType, Vec<u8>),
    Warning(Vec<u8>),
    Lost(DeviceLostReason, Vec<u8>),
}

struct Events {
    queue: Guarded<Vec<Event>>,
    host: Arc<Host>,
    /// Only the JS thread follows it. Null while nobody is there to tell.
    device: AtomicPtr<Device>,
}

impl Events {
    fn push(&self, event: Event) {
        self.queue.lock().push(event);
        if !self.host.is_js_thread() {
            return self.host.wake();
        }
        // SAFETY: a device clears this before it is dropped, on this thread.
        if let Some(device) = unsafe { self.device.load(Ordering::SeqCst).as_ref() } {
            device.stay_alive_for_events();
        }
    }
}

impl dawn::DeviceEvents for Events {
    fn uncaptured_error(&self, r#type: ErrorType, message: &[u8]) {
        self.push(Event::UncapturedError(r#type, message.to_vec()));
    }

    fn log(&self, r#type: LoggingType, message: &[u8]) {
        match r#type {
            LoggingType::Warning | LoggingType::Error => {
                self.push(Event::Warning(message.to_vec()));
            }
            _ => bun_core::scoped_log!(WebGPU, "{}", bun_core::fmt::s(message)),
        }
    }

    fn lost(&self, reason: DeviceLostReason, message: &[u8]) {
        self.push(Event::Lost(reason, message.to_vec()));
    }
}

pub(crate) struct Device {
    pub(super) dawn: OwnedDevice,
    pub(super) instance: Rc<Instance>,
    events: Arc<Events>,
    origin: Origin,
    wrapper: JsCell<bun_jsc::Weak<()>>,
    /// From an event to the next `complete_events`.
    pending_events: RefCell<Option<(Strong, Operation)>>,
    mapped_buffers: RefCell<Vec<Weak<Buffer>>>,
    /// By the id of a [`QueueWait`].
    queue_waits: RefCell<ArrayHashMap<u32, Serial>>,
    last_queue_wait: Cell<u32>,
    warnings: Cell<u32>,
    queue_label: String,
    abort_handle: AbortHandle,
}

bun_jsc::impl_abort_handle_owner!(
    Device,
    abort_handle,
    keep_alive = |this| -> Rc<Device> {
        // SAFETY: `Rc::as_ptr` of a device that has not been dropped, which disarms the handle.
        unsafe {
            Rc::increment_strong_count(this);
            Rc::from_raw(this)
        }
    },
    |this, cause| {
        // SAFETY: kept alive above.
        let this = unsafe { &*this };
        this.stop_events();
        for buffer in this.take_mapped_buffers() {
            buffer.detach_views(VirtualMachine::get().jsc_vm());
        }
        this.dawn.destroy();
        match cause {
            AbortCause::ContextStopped(StopReason::VmTeardown) => {
                this.instance.release_operations();
            }
            _ => this.instance.schedule(),
        }
    }
);

impl Drop for Device {
    fn drop(&mut self) {
        self.stop_events();
    }
}

/// An object has memory of the driver, or can be the last to let go of one that has.
#[derive(Clone)]
pub(crate) struct HoldsMemory(Weak<Device>);

impl HoldsMemory {
    pub(super) fn of(device: &Rc<Device>) -> Self {
        Self(Rc::downgrade(device))
    }
}

impl Drop for HoldsMemory {
    fn drop(&mut self) {
        if let Some(device) = self.0.upgrade() {
            device.will_release_memory();
        }
    }
}

/// An operation that ends when the GPU has come to it.
pub(super) struct QueueWait {
    device: Rc<Device>,
    id: u32,
}

impl QueueWait {
    /// The device is not to be dropped while Dawn calls back.
    pub(super) fn finish(self) -> Rc<Device> {
        Rc::clone(&self.device)
    }
}

impl Drop for QueueWait {
    fn drop(&mut self) {
        self.device.queue_waits.borrow_mut().swap_remove(&self.id);
    }
}

impl Device {
    pub(super) fn has_feature(&self, feature: FeatureName) -> bool {
        self.dawn.has_feature(feature).into()
    }

    pub(super) fn missing_feature<'a>(
        heap: &JsHeap<'a>,
        feature: FeatureName,
        user: core::fmt::Arguments<'_>,
    ) -> Error<'a> {
        heap.type_error(format_args!(
            "{user} requires the feature \"{}\", which the device was not created with",
            feature.name().unwrap_or_default()
        ))
    }

    /// `start` hands the wait to Dawn, and returns what that waits for.
    pub(super) fn wait_for_queue(self: &Rc<Self>, start: impl FnOnce(QueueWait) -> Serial) {
        let wait = self.add_queue_wait();
        self.set_serial_of_queue_wait(wait.id, start(wait));
    }

    fn add_queue_wait(self: &Rc<Self>) -> QueueWait {
        let id = self.last_queue_wait.get().wrapping_add(1);
        self.last_queue_wait.set(id);
        self.queue_waits.borrow_mut().insert(id, Serial::default());
        let device = Rc::clone(self);
        QueueWait { device, id }
    }

    fn set_serial_of_queue_wait(&self, id: u32, serial: Serial) {
        if let Some(entry) = self.queue_waits.borrow_mut().get_mut(&id) {
            *entry = serial;
        }
    }

    /// Dawn looks at all waits at each wake, so those for very many submits end in batches.
    fn serial_to_wake_after(&self) -> Option<Serial> {
        const BATCHES: usize = 256;
        let waits = self.queue_waits.borrow();
        if waits.values().len() < BATCHES {
            return waits.values().iter().min().copied();
        }
        let mut serials = waits.values().to_vec();
        serials.sort_unstable();
        serials.dedup();
        Some(serials[serials.len() / BATCHES])
    }

    pub(super) fn will_release_memory(&self) {
        if !self.dawn.is_destroyed() {
            self.dawn.will_release_memory();
            self.instance.schedule();
        }
    }

    pub(super) fn watch_queue(&self, has_results: bool) {
        let serial = self.serial_to_wake_after();
        let is_script_done = !has_results && serial.is_none();
        match self.dawn.wake_after(serial, is_script_done) {
            Wake::Follows => {}
            Wake::None if serial.is_none() => {}
            Wake::None | Wake::Missed => self.instance.schedule(),
        }
    }

    pub(super) fn add_mapped_buffer(&self, buffer: &Rc<Buffer>) {
        if buffer.is_listed_by_device.replace(true) {
            return;
        }
        let mut buffers = self.mapped_buffers.borrow_mut();
        if buffers.len() == buffers.capacity() {
            buffers.retain(|buffer| {
                buffer.upgrade().is_some_and(|buffer| {
                    buffer.is_listed_by_device.set(!buffer.is_unmapped());
                    buffer.is_listed_by_device.get()
                })
            });
            let kept = buffers.len();
            buffers.reserve(kept);
        }
        buffers.push(Rc::downgrade(buffer));
    }

    fn take_mapped_buffers(&self) -> impl Iterator<Item = Rc<Buffer>> {
        (self.mapped_buffers.take().into_iter())
            .filter_map(|buffer| buffer.upgrade())
            .inspect(|buffer| buffer.is_listed_by_device.set(false))
    }

    fn stay_alive_for_events(&self) {
        let mut pending = self.pending_events.borrow_mut();
        if pending.is_none()
            && let Some(wrapper) = self.wrapper.get().get()
        {
            *pending = Some((
                Strong::create(wrapper, &self.origin.global),
                Operation::new(&self.instance, self.origin),
            ));
        }
    }

    fn stop_events(&self) {
        (self.events.device).store(ptr::null_mut(), Ordering::SeqCst);
        self.pending_events.take();
    }

    pub(super) fn complete_events(self: &Rc<Self>) {
        let _pending = self.pending_events.take();
        let events = core::mem::take(&mut *self.events.queue.lock());
        if events.is_empty() || self.events.device.load(Ordering::SeqCst).is_null() {
            return;
        }
        let Some(wrapper) = self.wrapper.get().get() else {
            return;
        };
        for event in events {
            let device = Rc::clone(self);
            let wrapper = Strong::create(wrapper, &self.origin.global);
            Operation::new(&self.instance, self.origin)
                .complete(move |global| device.deliver(global, wrapper.get(), event));
        }
    }

    fn deliver(&self, global: &JSGlobalObject, wrapper: JSValue, event: Event) -> JsResult<()> {
        match event {
            Event::Warning(message) => self.warn(global, &message),
            Event::UncapturedError(r#type, message) => {
                let was_canceled = !fire_uncaptured_error(global, wrapper, r#type, &message)?;
                // A worker that is being terminated calls no listener, so none could cancel.
                if !was_canceled && global.bun_vm().script_allowed() {
                    self.warn(global, &message)?;
                }
                Ok(())
            }
            Event::Lost(reason, message) => {
                let info = GPUDeviceLostInfo {
                    reason: match reason {
                        DeviceLostReason::Destroyed => idl::GPUDeviceLostReason::Destroyed,
                        _ => idl::GPUDeviceLostReason::Unknown,
                    },
                    message: String::clone_utf8(&message),
                };
                let lost = idl::js_GPUDevice::lost_get_cached(wrapper).unwrap_or_else(|| {
                    let lost = JSPromise::create(global).to_js();
                    idl::js_GPUDevice::lost_set_cached(wrapper, global, lost);
                    lost
                });
                let lost = lost.as_promise().expect("the field only holds a promise");
                JSPromise::opaque_mut(lost).resolve(global, info.to_js(global))
            }
        }
    }

    fn warn(&self, global: &JSGlobalObject, message: &[u8]) -> JsResult<()> {
        let count = self.warnings.get();
        let message = match count {
            ..MAX_WARNINGS => message,
            MAX_WARNINGS => b"WebGPU: too many warnings. This GPUDevice prints no more of them.",
            _ => return Ok(()),
        };
        self.warnings.set(count + 1);
        let message = bun_jsc::bun_string_jsc::create_utf8_for_js(global, message)?;
        console_object::message_with_type_and_level(
            MessageType::Log,
            MessageLevel::Warning,
            global,
            &[message],
        );
        if global.has_exception() {
            return Err(JsError::Thrown);
        }
        Ok(())
    }
}

/// Whether no listener canceled the event.
fn fire_uncaptured_error(
    global: &JSGlobalObject,
    device: JSValue,
    r#type: ErrorType,
    message: &[u8],
) -> JsResult<bool> {
    let base = EventBase {
        r#type: String::static_("uncapturederror"),
        bubbles: false,
        cancelable: true,
        composed: false,
        is_trusted: true,
    };
    let fire = |cx: &mut JsScope<'_>| {
        let target = JsWrapper::<GPUDevice>::from_js(&cx.heap, device).expect("a GPUDevice");
        target
            .dispatch_new_event(cx, &base, GPUUncapturedErrorEvent, |cx, event| {
                let error = GPUError::create(&cx.heap, r#type, message).to_js();
                let (event, global) = (event.to_js(), cx.global());
                idl::js_GPUUncapturedErrorEvent::error_set_cached(event, global, error);
                idl::js_GPUUncapturedErrorEvent::device_set_cached(event, global, device);
            })
            .map_err(|error| error.into_js_error(global))
    };
    // SAFETY: the event loop runs this task.
    unsafe { JsScope::with(global.as_mut_ptr(), fire) }
}

pub(crate) type GPUDevice = Object<dawn::Device, Rc<Device>>;

impl GPUDevice {
    /// The error is the message of an `OperationError`.
    pub(super) fn request(
        cx: &mut JsScope<'_>,
        instance: &Rc<Instance>,
        adapter: &OwnedAdapter,
        descriptor: &idl::GPUDeviceDescriptor,
        required_features: &[FeatureName],
        required_limits: AllLimits,
    ) -> core::result::Result<JSValue, Vec<u8>> {
        let events = Arc::new(Events {
            queue: Guarded::default(),
            host: Arc::clone(instance.host()),
            device: AtomicPtr::new(ptr::null_mut()),
        });
        let dawn = adapter.request_device(
            dawn::DeviceOptions {
                label: convert::label(&descriptor.label.to_utf8()),
                required_features,
                required_limits,
                queue_label: convert::label(&descriptor.default_queue.label.to_utf8()),
            },
            Arc::clone(&events),
        )?;
        let device = Rc::new(Device {
            dawn,
            instance: Rc::clone(instance),
            events,
            origin: Origin::of_caller(cx),
            wrapper: JsCell::default(),
            pending_events: RefCell::default(),
            mapped_buffers: RefCell::default(),
            queue_waits: RefCell::default(),
            last_queue_wait: Cell::new(0),
            warnings: Cell::new(0),
            queue_label: descriptor.default_queue.label.clone(),
            abort_handle: AbortHandle::for_owner::<Device>(),
        });
        instance.add_device(&device);

        let address = Rc::as_ptr(&device).cast_mut();
        device.events.device.store(address, Ordering::SeqCst);
        device.abort_handle.set_only_waits_to_be_closed();
        // SAFETY: what an `Rc` holds does not move, and dropping the handle disarms it.
        unsafe { AbortHandle::arm_owner(address, cx.js_thread().context()) };

        let handle = device.dawn.handle();
        let wrapper = Self::with_state(handle, &descriptor.label, Rc::clone(&device))
            .into_js(&cx.heap)
            .to_js();
        let global = cx.global();
        (device.wrapper).set(bun_jsc::Weak::create_passive(wrapper, global));
        // It may have been lost already.
        device.stay_alive_for_events();
        global.vm().report_extra_memory(ESTIMATED_SIZE_OF_DEVICE);
        Ok(wrapper)
    }

    pub(crate) fn get_features<'a>(
        &self,
        heap: &JsHeap<'a>,
    ) -> JsWrapper<'a, GPUSupportedFeatures> {
        GPUSupportedFeatures::read(|features| self.handle.get_features(features)).into_js(heap)
    }

    pub(crate) fn get_limits<'a>(&self, heap: &JsHeap<'a>) -> JsWrapper<'a, GPUSupportedLimits> {
        GPUSupportedLimits(self.handle.all_limits()).into_js(heap)
    }

    pub(crate) fn get_adapter_info<'a>(&self, heap: &JsHeap<'a>) -> JsWrapper<'a, GPUAdapterInfo> {
        GPUAdapterInfo::read(&|info| self.handle.get_adapter_info(info)).into_js(heap)
    }

    pub(crate) fn get_queue<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
    ) -> JsWrapper<'a, GPUQueue> {
        let device = &self.state;
        Object::with_state(
            self.handle.get_queue(),
            &device.queue_label,
            Rc::clone(device),
        )
        .into_child_of(heap, this_value.to_js())
    }

    pub(crate) fn get_lost(&self, cx: &mut JsScope<'_>) -> JSValue {
        JSPromise::create(cx.global()).to_js()
    }

    pub(crate) fn destroy<'a>(&self, cx: &mut JsScope<'a>) -> Result<'a, ()> {
        let device = &self.state;
        let mut result = Ok(());
        for buffer in device.take_mapped_buffers() {
            match result {
                Ok(()) => result = buffer.unmap_for_destroyed_device(cx.global()),
                Err(_) => {
                    buffer.detach_views(cx.global().vm());
                    device.add_mapped_buffer(&buffer);
                }
            }
        }
        if !device.dawn.is_destroyed() {
            device.dawn.destroy();
            device.instance.schedule();
        }
        Ok(result?)
    }

    pub(crate) fn create_buffer<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
        descriptor: &idl::GPUBufferDescriptor,
    ) -> Result<'a, JsWrapper<'a, GPUBuffer>> {
        let buffer = GPUBuffer::create(heap, &self.state, descriptor)?;
        Ok(buffer.into_child_of(heap, this_value.to_js()))
    }

    pub(crate) fn create_texture<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
        descriptor: &idl::GPUTextureDescriptor,
    ) -> Result<'a, JsWrapper<'a, GPUTexture>> {
        let texture = GPUTexture::create(heap, &self.state, descriptor)?;
        Ok(texture.into_child_of(heap, this_value.to_js()))
    }

    pub(crate) fn create_sampler<'a>(
        &self,
        heap: &JsHeap<'a>,
        descriptor: &idl::GPUSamplerDescriptor,
    ) -> JsWrapper<'a, GPUSampler> {
        let handle = self.handle.create_sampler(Some(&dawn::SamplerDescriptor {
            next_in_chain: Chain::END,
            label: convert::label(&descriptor.label.to_utf8()),
            address_mode_u: descriptor.address_mode_u.into(),
            address_mode_v: descriptor.address_mode_v.into(),
            address_mode_w: descriptor.address_mode_w.into(),
            mag_filter: descriptor.mag_filter.into(),
            min_filter: descriptor.min_filter.into(),
            mipmap_filter: descriptor.mipmap_filter.into(),
            lod_min_clamp: descriptor.lod_min_clamp,
            lod_max_clamp: descriptor.lod_max_clamp,
            compare: (descriptor.compare).map_or(dawn::CompareFunction::Undefined, Into::into),
            max_anisotropy: descriptor.max_anisotropy,
        }));
        Object::with_state(handle, &descriptor.label, HoldsMemory::of(&self.state)).into_js(heap)
    }

    pub(crate) fn create_bind_group_layout<'a>(
        &self,
        heap: &JsHeap<'a>,
        descriptor: &idl::GPUBindGroupLayoutDescriptor,
    ) -> Result<'a, JsWrapper<'a, GPUBindGroupLayout>> {
        let external_texture = dawn::ExternalTextureBindingLayout::default();
        let mut entries = SmallVec::<[_; 8]>::with_capacity(descriptor.entries.len());
        for entry in &descriptor.entries {
            let mut converted = dawn::BindGroupLayoutEntry {
                binding: entry.binding,
                visibility: dawn::ShaderStage::from_bits(entry.visibility),
                ..Default::default()
            };
            if let Some(buffer) = &entry.buffer {
                converted.buffer.r#type = buffer.r#type.into();
                converted.buffer.has_dynamic_offset = buffer.has_dynamic_offset.into();
                converted.buffer.min_binding_size = buffer.min_binding_size;
            }
            if let Some(sampler) = &entry.sampler {
                converted.sampler.r#type = sampler.r#type.into();
            }
            if let Some(texture) = &entry.texture {
                converted.texture.sample_type = texture.sample_type.into();
                converted.texture.view_dimension = texture.view_dimension.into();
                converted.texture.multisampled = texture.multisampled.into();
            }
            if let Some(texture) = &entry.storage_texture {
                converted.storage_texture.access = texture.access.into();
                converted.storage_texture.format =
                    self.state.texture_format(heap, texture.format)?;
                converted.storage_texture.view_dimension = texture.view_dimension.into();
            }
            if entry.external_texture.is_some() {
                converted.next_in_chain = Chain::from(&external_texture);
            }
            entries.push(converted);
        }
        let handle = (self.handle).create_bind_group_layout(&dawn::BindGroupLayoutDescriptor {
            next_in_chain: Chain::END,
            label: convert::label(&descriptor.label.to_utf8()),
            entries: (*entries).into(),
        });
        Ok(
            Object::with_state(handle, &descriptor.label, HoldsMemory::of(&self.state))
                .into_js(heap),
        )
    }

    pub(crate) fn create_pipeline_layout<'a>(
        &self,
        heap: &JsHeap<'a>,
        descriptor: &idl::GPUPipelineLayoutDescriptor<'a>,
    ) -> JsWrapper<'a, GPUPipelineLayout> {
        let bind_group_layouts = (descriptor.bind_group_layouts.iter())
            .map(|layout| layout.map(|layout| &*layout.handle))
            .collect::<SmallVec<[_; 4]>>();
        let handle = (self.handle).create_pipeline_layout(&dawn::PipelineLayoutDescriptor {
            next_in_chain: Chain::END,
            label: convert::label(&descriptor.label.to_utf8()),
            bind_group_layouts: (*bind_group_layouts).into(),
            immediate_size: descriptor.immediate_size,
        });
        Object::with_state(handle, &descriptor.label, HoldsMemory::of(&self.state)).into_js(heap)
    }

    pub(crate) fn create_bind_group<'a>(
        &self,
        heap: &JsHeap<'a>,
        descriptor: &idl::GPUBindGroupDescriptor<'a>,
    ) -> JsWrapper<'a, GPUBindGroup> {
        let entries = (descriptor.entries.iter())
            .map(|entry| {
                let mut converted = dawn::BindGroupEntry {
                    binding: entry.binding,
                    ..Default::default()
                };
                match &entry.resource {
                    idl::GPUBindingResource::Sampler(sampler) => {
                        converted.sampler = Some(&sampler.handle);
                    }
                    idl::GPUBindingResource::Texture(texture) => {
                        converted.texture_view = Some(texture.default_view());
                    }
                    idl::GPUBindingResource::View(view) => {
                        converted.texture_view = Some(&view.handle);
                    }
                    idl::GPUBindingResource::Buffer(buffer) => {
                        converted.buffer = Some(&buffer.handle);
                    }
                    idl::GPUBindingResource::Binding(binding) => {
                        converted.buffer = Some(&binding.buffer.handle);
                        converted.offset = binding.offset;
                        converted.size = size_or_whole(binding.size);
                    }
                }
                converted
            })
            .collect::<SmallVec<[_; 8]>>();
        let handle = self.handle.create_bind_group(&dawn::BindGroupDescriptor {
            next_in_chain: Chain::END,
            label: convert::label(&descriptor.label.to_utf8()),
            layout: &descriptor.layout.handle,
            entries: (*entries).into(),
        });
        Object::with_state(handle, &descriptor.label, HoldsMemory::of(&self.state)).into_js(heap)
    }

    pub(crate) fn create_shader_module<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
        descriptor: &idl::GPUShaderModuleDescriptor<'a>,
    ) -> Result<'a, JsWrapper<'a, GPUShaderModule>> {
        check_stack(heap)?;
        let source = dawn::ShaderSourceWGSL {
            chain: Default::default(),
            code: descriptor.code.into(),
        };
        let handle = (self.handle).create_shader_module(&dawn::ShaderModuleDescriptor {
            next_in_chain: Chain::from(&source),
            label: convert::label(&descriptor.label.to_utf8()),
        });
        let module = Object::with_state(handle, &descriptor.label, Rc::clone(&self.state));
        Ok(module.into_child_of(heap, this_value.to_js()))
    }

    pub(crate) fn create_compute_pipeline<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
        descriptor: &idl::GPUComputePipelineDescriptor<'a>,
    ) -> Result<'a, JsWrapper<'a, GPUComputePipeline>> {
        check_stack(heap)?;
        let handle = with_compute_pipeline_descriptor(descriptor, |descriptor| {
            self.handle.create_compute_pipeline(descriptor)
        });
        let pipeline = Object::with_state(handle, &descriptor.label, HoldsMemory::of(&self.state));
        Ok(pipeline.into_child_of(heap, this_value.to_js()))
    }

    pub(crate) fn create_render_pipeline<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
        descriptor: &idl::GPURenderPipelineDescriptor<'a>,
    ) -> Result<'a, JsWrapper<'a, GPURenderPipeline>> {
        check_stack(heap)?;
        let handle =
            (self.state).with_render_pipeline_descriptor(heap, descriptor, |descriptor| {
                self.handle.create_render_pipeline(descriptor)
            })?;
        let pipeline = Object::with_state(handle, &descriptor.label, HoldsMemory::of(&self.state));
        Ok(pipeline.into_child_of(heap, this_value.to_js()))
    }

    /// The callback for Dawn, and the promise that it settles.
    fn defer_pipeline<T: bun_core::ExternalSharedDescriptor + 'static>(
        &self,
        this_value: JSValue,
        cx: &mut JsScope<'_>,
        label: &String,
    ) -> (
        impl FnOnce(dawn::CreatePipelineAsyncStatus, Option<dawn::Ref<T>>, dawn::StringView<'_>)
        + 'static
        + use<T>,
        JSValue,
    )
    where
        Object<T>: Child,
    {
        let (deferred, promise) = Deferred::new(&self.state.instance, cx);
        let device = Strong::create(this_value, cx.global());
        let label = label.clone();
        let state = HoldsMemory::of(&self.state);
        let callback = move |status, handle: Option<_>, message: dawn::StringView<'_>| {
            let message = String::clone_utf8(message.as_bytes());
            deferred.complete(move |global, promise| match handle {
                Some(handle) => {
                    let pipeline = Object::with_state(handle, &label, state)
                        .into_child_of(JsHeap::from_global(global), device.get());
                    promise.resolve(global, pipeline.to_js())
                }
                None => promise.reject(global, Ok(create_pipeline_error(global, status, message))),
            });
        };
        (callback, promise)
    }

    pub(crate) fn create_compute_pipeline_async<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        descriptor: &idl::GPUComputePipelineDescriptor<'a>,
    ) -> Result<'a, JSValue> {
        check_stack(&cx.heap)?;
        let (callback, promise) = self.defer_pipeline(this_value.to_js(), cx, &descriptor.label);
        let callback = dawn::CreateComputePipelineAsyncCallbackInfo::new(callback);
        with_compute_pipeline_descriptor(descriptor, |descriptor| {
            (self.handle).create_compute_pipeline_async(descriptor, callback);
        });
        Ok(promise)
    }

    pub(crate) fn create_render_pipeline_async<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        descriptor: &idl::GPURenderPipelineDescriptor<'a>,
    ) -> Result<'a, JSValue> {
        check_stack(&cx.heap)?;
        let (callback, promise) = self.defer_pipeline(this_value.to_js(), cx, &descriptor.label);
        (self.state).with_render_pipeline_descriptor(&cx.heap, descriptor, |descriptor| {
            let callback = dawn::CreateRenderPipelineAsyncCallbackInfo::new(callback);
            (self.handle).create_render_pipeline_async(descriptor, callback);
        })?;
        Ok(promise)
    }

    pub(crate) fn create_command_encoder<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
        descriptor: &idl::GPUCommandEncoderDescriptor,
    ) -> JsWrapper<'a, GPUCommandEncoder> {
        let handle = (self.handle).create_command_encoder(Some(&dawn::CommandEncoderDescriptor {
            next_in_chain: Chain::END,
            label: convert::label(&descriptor.label.to_utf8()),
        }));
        Object::with_state(handle, &descriptor.label, HoldsMemory::of(&self.state))
            .into_child_of(heap, this_value.to_js())
    }

    pub(crate) fn create_render_bundle_encoder<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
        descriptor: &idl::GPURenderBundleEncoderDescriptor,
    ) -> Result<'a, JsWrapper<'a, GPURenderBundleEncoder>> {
        let device = &self.state;
        let color_formats = (descriptor.color_formats.iter())
            .map(|&format| device.optional_texture_format(heap, format))
            .collect::<Result<'a, SmallVec<[_; 8]>>>()?;
        let handle =
            (self.handle).create_render_bundle_encoder(&dawn::RenderBundleEncoderDescriptor {
                next_in_chain: Chain::END,
                label: convert::label(&descriptor.label.to_utf8()),
                // Dawn reads 8 bits of the length.
                color_formats: color_formats[..color_formats.len().min(u8::MAX.into())].into(),
                depth_stencil_format: device
                    .optional_texture_format(heap, descriptor.depth_stencil_format)?,
                sample_count: descriptor.sample_count,
                depth_read_only: descriptor.depth_read_only.into(),
                stencil_read_only: descriptor.stencil_read_only.into(),
            });
        Ok(
            Object::with_state(handle, &descriptor.label, HoldsMemory::of(&self.state))
                .into_child_of(heap, this_value.to_js()),
        )
    }

    pub(crate) fn create_query_set<'a>(
        &self,
        heap: &JsHeap<'a>,
        descriptor: &idl::GPUQuerySetDescriptor,
    ) -> Result<'a, JsWrapper<'a, GPUQuerySet>> {
        let &idl::GPUQuerySetDescriptor { r#type, count, .. } = descriptor;
        let feature = FeatureName::TimestampQuery;
        if r#type == idl::GPUQueryType::Timestamp && !self.state.has_feature(feature) {
            let user = format_args!("The query type \"timestamp\"");
            return Err(Device::missing_feature(heap, feature, user));
        }
        let handle = self.handle.create_query_set(&dawn::QuerySetDescriptor {
            next_in_chain: Chain::END,
            label: convert::label(&descriptor.label.to_utf8()),
            r#type: r#type.into(),
            count,
        });
        let state = QuerySet {
            r#type,
            count,
            memory: Cell::new(Some(HoldsMemory::of(&self.state))),
        };
        Ok(Object::with_state(handle, &descriptor.label, state).into_js(heap))
    }

    pub(crate) fn push_error_scope(&self, filter: idl::GPUErrorFilter) {
        self.handle.push_error_scope(filter.into());
    }

    pub(crate) fn pop_error_scope<'a>(&self, cx: &mut JsScope<'a>) -> Result<'a, JSValue> {
        let (deferred, promise) = Deferred::new(&self.state.instance, cx);
        let callback = dawn::PopErrorScopeCallbackInfo::new(move |status, r#type, message| {
            let message = message.as_bytes().to_vec();
            deferred.complete(move |global, promise| {
                if status != dawn::PopErrorScopeStatus::Success {
                    let error = global.create_dom_exception_instance(
                        DOMExceptionCode::OperationError,
                        format_args!("{}", bun_core::fmt::s(&message)),
                    );
                    return promise.reject(global, Ok(error));
                }
                let error = match r#type {
                    ErrorType::NoError => JSValue::NULL,
                    _ => GPUError::create(JsHeap::from_global(global), r#type, &message).to_js(),
                };
                promise.resolve(global, error)
            });
        });
        self.handle.pop_error_scope(callback);
        Ok(promise)
    }
}

pub(crate) type GPUQuerySet = Object<dawn::QuerySet, QuerySet>;

pub(crate) struct QuerySet {
    r#type: idl::GPUQueryType,
    count: u32,
    memory: Cell<Option<HoldsMemory>>,
}

impl GPUQuerySet {
    pub(crate) fn destroy(&self) {
        self.handle.destroy();
        self.state.memory.take();
    }

    pub(crate) fn get_type(&self) -> idl::GPUQueryType {
        self.state.r#type
    }

    pub(crate) fn get_count(&self) -> u32 {
        self.state.count
    }
}
