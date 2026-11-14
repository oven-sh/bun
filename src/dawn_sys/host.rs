//! What `Host.cpp` adds to webgpu.h.

use core::cell::Cell;
use core::ffi::c_void;
use core::mem::ManuallyDrop;
use core::ops::Deref;
use core::ptr::{self, NonNull};
use std::rc::Rc;
use std::sync::Arc;

use crate::{
    Adapter, AllLimits, Buffer, CallbackMode, Chain, Device, DeviceDescriptor,
    DeviceLostCallbackInfo, DeviceLostReason, ErrorType, FeatureLevel, FeatureName, Instance,
    LoggingCallbackInfo, LoggingType, PowerPreference, Queue, QueueDescriptor, Ref,
    RequestDeviceStatus, StringView, Texture, UncapturedErrorCallbackInfo,
};

bun_core::declare_scope!(Dawn, hidden);

/// What Dawn asks of the program. It does so on any thread.
pub trait Host: Send + Sync + 'static {
    /// The thread that owns the instance has to call `Instance::process_events`.
    fn wake(self: &Arc<Self>);
    /// `task` has to run on another thread, followed by a `wake`.
    fn post_worker_task(self: &Arc<Self>, task: WorkerTask);
}

/// What a device reports. It does so in any call into Dawn, on any thread.
pub trait DeviceEvents: Send + Sync + 'static {
    fn uncaptured_error(&self, r#type: ErrorType, message: &[u8]);
    fn log(&self, r#type: LoggingType, message: &[u8]);
    /// Nothing follows it.
    fn lost(&self, reason: DeviceLostReason, message: &[u8]);
}

/// Around every call into Dawn, which expects the thread to drain one now and then. What Metal leaves in it holds textures.
pub(crate) struct AutoreleasePool {
    #[cfg(target_os = "macos")]
    pool: *mut c_void,
}

impl AutoreleasePool {
    #[inline]
    pub(crate) fn new() -> Self {
        Self {
            #[cfg(target_os = "macos")]
            pool: BunDawn__pushAutoreleasePool(),
        }
    }
}

#[cfg(target_os = "macos")]
impl Drop for AutoreleasePool {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: the pool this thread pushed last, as this is only ever a local variable.
        unsafe { BunDawn__popAutoreleasePool(self.pool) }
    }
}

/// Destroying a device waits for its tasks.
#[must_use]
pub struct WorkerTask {
    run: unsafe extern "C" fn(*mut c_void),
    task: *mut c_void,
}

// SAFETY: Dawn makes it to run on another thread.
unsafe impl Send for WorkerTask {}

impl WorkerTask {
    pub fn run(self) {
        let _pool = AutoreleasePool::new();
        // SAFETY: the pair Dawn posted, called once.
        unsafe { (self.run)(self.task) }
    }
}

#[repr(C)]
struct BunDawnHost {
    context: *const c_void,
    wake: unsafe extern "C" fn(*const c_void),
    post_worker_task:
        unsafe extern "C" fn(*const c_void, unsafe extern "C" fn(*mut c_void), *mut c_void),
    release: unsafe extern "C" fn(*const c_void),
    log: unsafe extern "C" fn(LoggingType, StringView<'_>, *mut c_void, *mut c_void),
}

type RequestDeviceCallback = unsafe extern "C" fn(
    RequestDeviceStatus,
    Option<Ref<Device>>,
    StringView<'_>,
    *mut c_void,
    *mut c_void,
);

bun_opaque::opaque_ffi! {
    struct QueueWatcher;
}

/// Dawn numbers what it submits to a queue.
#[derive(Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord)]
#[repr(transparent)]
pub struct Serial(u64);

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Wake {
    /// The GPU is idle, the device is lost, or the system is out of resources.
    None,
    Follows,
    /// It has to be asked again.
    Missed,
}

unsafe extern "C" {
    fn BunDawn__createInstance(host: &BunDawnHost) -> Option<NonNull<Instance>>;
    fn BunDawn__releaseInstance(instance: NonNull<Instance>);
    safe fn BunDawn__requestAdapter(
        instance: &Instance,
        feature_level: FeatureLevel,
        power_preference: PowerPreference,
        force_fallback_adapter: bool,
    ) -> Option<Ref<Adapter>>;
    fn BunDawn__requestDevice(
        adapter: &Adapter,
        descriptor: &mut DeviceDescriptor<'_>,
        callback: RequestDeviceCallback,
        context: *mut c_void,
    );
    safe fn BunDawn__bufferMemorySize(buffer: &Buffer) -> u64;
    safe fn BunDawn__textureMemorySize(texture: &Texture) -> u64;
    safe fn BunDawn__createQueueWatcher(device: &Device) -> NonNull<QueueWatcher>;
    fn BunDawn__armQueueWatcher(
        watcher: NonNull<QueueWatcher>,
        serial: Serial,
        is_script_done: bool,
    ) -> Wake;
    fn BunDawn__willReleaseMemory(watcher: NonNull<QueueWatcher>);
    safe fn BunDawn__serialOfLastUse(buffer: &Buffer) -> Serial;
    safe fn BunDawn__serialOfScheduledWork(queue: &Queue) -> Serial;
    fn BunDawn__destroyDevice(device: &Device, watcher: NonNull<QueueWatcher>);
}

#[cfg(target_os = "macos")]
unsafe extern "C" {
    safe fn BunDawn__loadMetal() -> bool;
    safe fn BunDawn__pushAutoreleasePool() -> *mut c_void;
    fn BunDawn__popAutoreleasePool(pool: *mut c_void);
}

pub struct OwnedInstance(NonNull<Instance>);

impl OwnedInstance {
    pub fn new<H: Host>(host: Arc<H>) -> Option<Rc<Self>> {
        unsafe extern "C" fn wake<H: Host>(host: *const c_void) {
            // SAFETY: the `Arc` below, until `release`.
            ManuallyDrop::new(unsafe { Arc::from_raw(host.cast::<H>()) }).wake();
        }
        unsafe extern "C" fn post_worker_task<H: Host>(
            host: *const c_void,
            run: unsafe extern "C" fn(*mut c_void),
            task: *mut c_void,
        ) {
            // SAFETY: the `Arc` below, until `release`.
            ManuallyDrop::new(unsafe { Arc::from_raw(host.cast::<H>()) })
                .post_worker_task(WorkerTask { run, task });
        }
        unsafe extern "C" fn release<H: Host>(host: *const c_void) {
            // SAFETY: the `Arc` below, given back once.
            drop(unsafe { Arc::from_raw(host.cast::<H>()) });
        }
        unsafe extern "C" fn log(
            _: LoggingType,
            message: StringView<'_>,
            _: *mut c_void,
            _: *mut c_void,
        ) {
            bun_core::scoped_log!(Dawn, "{}", bun_core::fmt::s(message.as_bytes()));
        }

        // SAFETY: C++ takes over `context`, whether it succeeds or not.
        let instance = unsafe {
            BunDawn__createInstance(&BunDawnHost {
                context: Arc::into_raw(host).cast(),
                wake: wake::<H>,
                post_worker_task: post_worker_task::<H>,
                release: release::<H>,
                log,
            })
        }?;
        Some(Rc::new(Self(instance)))
    }

    /// The first call loads the driver.
    pub fn request_adapter(
        self: &Rc<Self>,
        feature_level: FeatureLevel,
        power_preference: PowerPreference,
        force_fallback_adapter: bool,
    ) -> Option<OwnedAdapter> {
        #[cfg(target_os = "macos")]
        if !BunDawn__loadMetal() {
            return None;
        }
        let _pool = AutoreleasePool::new();
        let adapter = BunDawn__requestAdapter(
            self,
            feature_level,
            power_preference,
            force_fallback_adapter,
        )?;
        Some(OwnedAdapter {
            adapter,
            instance: Rc::clone(self),
        })
    }
}

impl Deref for OwnedInstance {
    type Target = Instance;
    fn deref(&self) -> &Instance {
        Instance::opaque_ref(self.0.as_ptr())
    }
}

impl Drop for OwnedInstance {
    fn drop(&mut self) {
        let _pool = AutoreleasePool::new();
        // SAFETY: the reference `new` got. A device is an `OwnedDevice`, which is destroyed before it lets go of this.
        unsafe { BunDawn__releaseInstance(self.0) }
    }
}

pub struct OwnedAdapter {
    adapter: Ref<Adapter>,
    instance: Rc<OwnedInstance>,
}

pub struct DeviceOptions<'a> {
    pub label: StringView<'a>,
    pub required_features: &'a [FeatureName],
    pub required_limits: AllLimits,
    pub queue_label: StringView<'a>,
}

impl OwnedAdapter {
    /// The error is Dawn's message.
    pub fn request_device<E: DeviceEvents>(
        &self,
        mut options: DeviceOptions<'_>,
        events: Arc<E>,
    ) -> Result<OwnedDevice, Vec<u8>> {
        unsafe extern "C" fn uncaptured_error<E: DeviceEvents>(
            _: *const c_void,
            r#type: ErrorType,
            message: StringView<'_>,
            events: *mut c_void,
            _: *mut c_void,
        ) {
            // SAFETY: the `Arc` below, until `lost`.
            unsafe { &*events.cast::<E>() }.uncaptured_error(r#type, message.as_bytes());
        }
        unsafe extern "C" fn log<E: DeviceEvents>(
            r#type: LoggingType,
            message: StringView<'_>,
            events: *mut c_void,
            _: *mut c_void,
        ) {
            // SAFETY: the `Arc` below, until `lost`.
            unsafe { &*events.cast::<E>() }.log(r#type, message.as_bytes());
        }
        unsafe extern "C" fn lost<E: DeviceEvents>(
            _: *const c_void,
            reason: DeviceLostReason,
            message: StringView<'_>,
            events: *mut c_void,
            _: *mut c_void,
        ) {
            // SAFETY: the `Arc` below. Dawn calls this once, after the last call of the other two has returned.
            unsafe { Arc::from_raw(events.cast::<E>()) }.lost(reason, message.as_bytes());
        }
        unsafe extern "C" fn done(
            _: RequestDeviceStatus,
            device: Option<Ref<Device>>,
            message: StringView<'_>,
            result: *mut c_void,
            _: *mut c_void,
        ) {
            // SAFETY: `result` below, whose frame is waiting for this.
            unsafe {
                *result.cast::<Result<Ref<Device>, Vec<u8>>>() =
                    device.ok_or_else(|| message.as_bytes().to_vec());
            }
        }

        let events: *mut c_void = Arc::into_raw(events).cast_mut().cast();
        options.required_limits.chain();
        let mut descriptor = DeviceDescriptor {
            next_in_chain: Chain::END,
            label: options.label,
            required_features: options.required_features.into(),
            required_limits: Some(&options.required_limits.core),
            default_queue: QueueDescriptor {
                label: options.queue_label,
                ..Default::default()
            },
            device_lost_callback_info: DeviceLostCallbackInfo {
                next_in_chain: Chain::END,
                mode: CallbackMode::AllowSpontaneous,
                callback: lost::<E>,
                userdata1: events,
                userdata2: ptr::null_mut(),
            },
            uncaptured_error_callback_info: UncapturedErrorCallbackInfo {
                next_in_chain: Chain::END,
                callback: uncaptured_error::<E>,
                userdata1: events,
                userdata2: ptr::null_mut(),
            },
        };
        let mut result: Result<Ref<Device>, Vec<u8>> = Err(Vec::new());
        let _pool = AutoreleasePool::new();
        // SAFETY: each callback takes the pointer beside it.
        unsafe { BunDawn__requestDevice(self, &mut descriptor, done, (&raw mut result).cast()) };
        let device = result?;

        // Ignored if the device is lost already.
        device.set_logging_callback(LoggingCallbackInfo {
            next_in_chain: Chain::END,
            callback: log::<E>,
            userdata1: events,
            userdata2: ptr::null_mut(),
        });
        Ok(OwnedDevice {
            watcher: Cell::new(Some(BunDawn__createQueueWatcher(&device))),
            device,
            _instance: Rc::clone(&self.instance),
        })
    }
}

impl Deref for OwnedAdapter {
    type Target = Adapter;
    fn deref(&self) -> &Adapter {
        &self.adapter
    }
}

/// A device that is destroyed when this is dropped, whatever else refers to it.
pub struct OwnedDevice {
    device: Ref<Device>,
    /// `None` once the device is destroyed.
    watcher: Cell<Option<NonNull<QueueWatcher>>>,
    _instance: Rc<OwnedInstance>,
}

impl OwnedDevice {
    pub fn handle(&self) -> Ref<Device> {
        self.device.clone()
    }

    /// Asks for `Host::wake` once the GPU has finished `serial`, or else all that was submitted. Wakes that were asked for before need not come.
    pub fn wake_after(&self, serial: Option<Serial>, is_script_done: bool) -> Wake {
        self.watcher.get().map_or(Wake::None, |watcher| {
            let _pool = AutoreleasePool::new();
            let serial = serial.unwrap_or(Serial(u64::MAX));
            // SAFETY: only `destroy` frees it, which takes it out first.
            unsafe { BunDawn__armQueueWatcher(watcher, serial, is_script_done) }
        })
    }

    /// Dawn frees it after the next submit, which [`wake_after`](Self::wake_after) makes if nothing else does.
    pub fn will_release_memory(&self) {
        if let Some(watcher) = self.watcher.get() {
            // SAFETY: as in `wake_after`.
            unsafe { BunDawn__willReleaseMemory(watcher) }
        }
    }

    pub fn is_destroyed(&self) -> bool {
        self.watcher.get().is_none()
    }

    /// Waits for the GPU.
    pub fn destroy(&self) {
        if let Some(watcher) = self.watcher.take() {
            let _pool = AutoreleasePool::new();
            // SAFETY: the watcher of this device, given up.
            unsafe { BunDawn__destroyDevice(&self.device, watcher) }
        }
    }
}

impl Deref for OwnedDevice {
    type Target = Device;
    fn deref(&self) -> &Device {
        &self.device
    }
}

impl Drop for OwnedDevice {
    fn drop(&mut self) {
        self.destroy();
    }
}

impl Buffer {
    /// 0 for an invalid buffer.
    pub fn memory_size(&self) -> u64 {
        BunDawn__bufferMemorySize(self)
    }

    /// What the last `map_async` waits for.
    pub fn serial_of_last_use(&self) -> Serial {
        BunDawn__serialOfLastUse(self)
    }
}

impl Queue {
    /// What the last `on_submitted_work_done` waits for.
    pub fn serial_of_scheduled_work(&self) -> Serial {
        BunDawn__serialOfScheduledWork(self)
    }
}

impl Texture {
    /// An estimate. 0 for an invalid texture.
    pub fn memory_size(&self) -> u64 {
        BunDawn__textureMemorySize(self)
    }
}
