//! The JS-independent half of WebGPU: the wgpu instance, id handles, errors, and name tables.

// The proof that `wgpu_core::global::Global` is `Sync` is deeper than the default of 128.
#![recursion_limit = "256"]

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Once, OnceLock};
use std::time::{Duration, Instant};

use bun_core::strings;
use bun_threading::Guarded;

pub use wgpu_core as wgc;
pub use wgpu_types as wgt;

#[cfg(target_vendor = "apple")]
mod apple;
pub mod names;

use wgc::global::Global;
use wgc::id;

/// The process's wgpu instance. Creating it loads the GPU API, so it happens on first use.
pub fn instance() -> &'static Global {
    static INSTANCE: OnceLock<Global> = OnceLock::new();
    INSTANCE.get_or_init(|| {
        let mut desc = wgt::InstanceDescriptor::new_without_display_handle();
        desc.backends = wgt::Backends::PRIMARY;
        // Without its frameworks the Metal backend cannot run: no backend, no adapters.
        #[cfg(target_vendor = "apple")]
        if !apple::load() {
            desc.backends = wgt::Backends::empty();
        }
        // The GPU API's own debug layers; wgpu-core's WebGPU validation does not need them.
        desc.flags = wgt::InstanceFlags::empty();
        Global::new("bun", desc, None)
    })
}

/// Stack per level of each kind of recursion: an operator of an expression, a link of an `else if` chain, a module-scope declaration that an earlier one uses. Measured with naga 30.0.1 through each of its back ends (SPIR-V, MSL, HLSL), then padded three to five times: 0.9 KB, 1.2 KB and 0.2 KB at opt-level "s", and about 36 KB, 57 KB and 3 KB in a debug build with ASAN.
const STACK_PER_LEVEL: [usize; 3] = if cfg!(debug_assertions) {
    [96 << 10, 192 << 10, 12 << 10]
} else {
    [4 << 10, 6 << 10, 1 << 10]
};

/// Where the WGSL line comment whose text starts at `from` ends: at the next line break.
fn line_comment_end(source: &[u8], from: usize) -> usize {
    let mut at = from;
    while let Some(hit) = strings::index_of_any_pos(source, b"\n\x0B\x0C\r\xC2\xE2", at) {
        let rest = &source[hit..];
        let is_break = rest[0].is_ascii()
            || rest.starts_with("\u{85}".as_bytes())
            || rest.starts_with("\u{2028}".as_bytes())
            || rest.starts_with("\u{2029}".as_bytes());
        if is_break {
            return hit;
        }
        at = hit + 1;
    }
    source.len()
}

/// Where the WGSL block comment whose text starts at `from` ends. Block comments nest.
fn block_comment_end(source: &[u8], from: usize) -> usize {
    let (mut depth, mut at) = (1usize, from);
    while let Some(hit) = strings::index_of_any_pos(source, b"/*", at) {
        at = hit + 1;
        match (source[hit], source.get(at)) {
            (b'/', Some(b'*')) => {
                depth += 1;
                at += 1;
            }
            (b'*', Some(b'/')) => {
                depth -= 1;
                at += 1;
                if depth == 0 {
                    return at;
                }
            }
            _ => {}
        }
    }
    source.len()
}

/// Whether the word at `at` is `else`, and not a part of a longer one such as `elsewhere`. Only ASCII counts as a part of a word here: a byte of another character can be a blank, and the count has to err on the high side.
fn is_else(source: &[u8], at: usize) -> bool {
    let in_word =
        |byte: Option<&u8>| byte.is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'_');
    source[at..].starts_with(b"else")
        && !in_word(at.checked_sub(1).and_then(|before| source.get(before)))
        && !in_word(source.get(at + 4))
}

/// Whether the next token from `at` on is `else`. What separates two tokens is blankspace and comments.
fn else_follows(source: &[u8], mut at: usize) -> bool {
    loop {
        let rest = &source[at..];
        at = match rest {
            [b' ' | b'\t'..=b'\r', ..] => at + 1,
            [0xC2, 0x85, ..] => at + 2,
            [0xE2, 0x80, 0x8E | 0x8F | 0xA8 | 0xA9, ..] => at + 3,
            [b'/', b'/', ..] => line_comment_end(source, at + 2),
            [b'/', b'*', ..] => block_comment_end(source, at + 2),
            _ => return is_else(source, at),
        };
    }
}

/// Upper bounds of how deep `source` (WGSL) can nest, in the order of [`STACK_PER_LEVEL`]. An expression is no deeper than the count of its statement's bytes that can add a level to a tree: every ASCII byte but a letter, a digit, `_`, a blank, `,` and the `.` of a number. An `if` nests one level per `else` of its chain, inside the chains of the blocks around it. A chain of declarations that use each other is no longer than the count of module-scope declarations. A statement ends at a `;`, `{` or `}` outside of a comment, so the comments have to be exactly the grammar's: one that ends earlier or later than naga's hides a `;` from naga, and the two halves of one expression count as two.
fn nesting(source: &[u8]) -> [usize; 3] {
    let (mut deepest, mut levels, mut declarations) = (0usize, 0usize, 0usize);
    // The `else` count of the `if` chain that is open at each brace depth, and their sum.
    let (mut chains, mut links, mut most_links) = (vec![0usize], 0usize, 0usize);
    let mut at = 0usize;
    while let Some(&byte) = source.get(at) {
        at += 1;
        match (byte, source.get(at)) {
            (b'/', Some(b'/')) => at = line_comment_end(source, at + 1),
            (b'/', Some(b'*')) => at = block_comment_end(source, at + 1),
            (b';' | b'{' | b'}', _) => {
                if byte == b'{' {
                    chains.push(0);
                } else if byte == b'}' {
                    if chains.len() > 1 {
                        links -= chains.pop().unwrap_or(0);
                    }
                    // An `if` chain goes on only with an `else` right after the `}`.
                    if let Some(chain) = chains.last_mut().filter(|_| !else_follows(source, at)) {
                        links -= core::mem::take(chain);
                    }
                }
                if chains.len() == 1 {
                    declarations += 1;
                }
                deepest = deepest.max(levels);
                levels = 0;
            }
            (b'e', _) if is_else(source, at - 1) => {
                if let Some(chain) = chains.last_mut() {
                    *chain += 1;
                }
                links += 1;
                most_links = most_links.max(links);
            }
            (b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_' | b',', _) => {}
            (b' ' | b'\t'..=b'\r' | 0x80.., _) => {}
            // A number: the name of a member does not start with a digit.
            (b'.', Some(b'0'..=b'9')) => {}
            _ => levels += 1,
        }
    }
    [deepest.max(levels), most_links, declarations]
}

/// The longest chain of `else if` a shader can have. The back ends keep naga's IR, where each link nests in the one before, and the thread that releases the last reference to a module drops it link by link, recursively: the JS thread inside a finalizer, at worst with only the stack JSC reserves for native code. Chrome's compiler stops at 127.
const MAX_ELSE_CHAIN: usize = 1024;

/// The stack a compile of `source` (WGSL) needs. naga recurses once per nesting level with no limit of its own, and its parser builds some deep trees in a loop, where its own limits do not apply: `!!!!x`, `a + a + a`, `v.xyzw.xyzw`, a chain of `else if`, declarations that use each other. More than [`MAX_COMPILE_STACK`] for a source that no thread compiles.
pub fn compile_stack(source: &[u8]) -> usize {
    // The JS thread's stack, plus the nesting the parser does limit.
    const BASE: usize = (8 << 20) + 256 * STACK_PER_LEVEL[1];
    let nesting = nesting(source);
    if nesting[1] > MAX_ELSE_CHAIN {
        return usize::MAX;
    }
    nesting
        .iter()
        .zip(STACK_PER_LEVEL)
        .fold(BASE, |stack, (levels, per_level)| {
            stack.saturating_add(levels.saturating_mul(per_level))
        })
}

/// The largest stack [`compile`] asks for. No shader nests that deep, and past it the answer would depend on the machine: Linux refuses a mapping larger than its memory and swap.
const MAX_COMPILE_STACK: usize = 16 << 30;

/// Runs a shader or pipeline compile on a thread with `stack` bytes of stack (see [`compile_stack`]). `None` if `stack` is more than [`MAX_COMPILE_STACK`], the thread could not be created, or the process is exiting.
pub fn compile<R: Send>(stack: usize, f: impl FnOnce() -> R + Send) -> Option<R> {
    // Counted before the check, so the exit either sees this compile or this sees the exit.
    COMPILING.fetch_add(1, Ordering::AcqRel);
    let compiled = if exiting() || stack > MAX_COMPILE_STACK {
        None
    } else {
        std::thread::scope(|scope| {
            std::thread::Builder::new()
                .name(String::from("bun-webgpu-compile"))
                .stack_size(stack)
                .spawn_scoped(scope, f)
                .ok()?
                .join()
                .ok()
        })
    };
    COMPILING.fetch_sub(1, Ordering::AcqRel);
    compiled
}

/// A wgpu-core id that is unregistered when the value drops. wgpu-core panics on an id it no longer knows.
pub trait OwnedId {
    type Id: Copy;
    fn id(&self) -> Self::Id;
}

macro_rules! owned_id {
    ($(#[$meta:meta])* $name:ident, $id:ty, $drop:ident) => {
        $(#[$meta])*
        pub struct $name($id);

        impl $name {
            /// Takes ownership of `id`: it is released when the value drops.
            pub fn new(id: $id) -> Self {
                Self(id)
            }
            #[inline]
            pub fn id(&self) -> $id {
                self.0
            }
        }

        impl OwnedId for $name {
            type Id = $id;
            #[inline]
            fn id(&self) -> $id {
                self.0
            }
        }

        impl Drop for $name {
            fn drop(&mut self) {
                instance().$drop(self.0);
            }
        }
    };
}

owned_id!(Adapter, id::AdapterId, adapter_drop);
owned_id!(Buffer, id::BufferId, buffer_drop);
owned_id!(Texture, id::TextureId, texture_drop);
owned_id!(TextureView, id::TextureViewId, texture_view_drop);
owned_id!(Sampler, id::SamplerId, sampler_drop);
owned_id!(
    BindGroupLayout,
    id::BindGroupLayoutId,
    bind_group_layout_drop
);
owned_id!(PipelineLayout, id::PipelineLayoutId, pipeline_layout_drop);
owned_id!(BindGroup, id::BindGroupId, bind_group_drop);
owned_id!(ShaderModule, id::ShaderModuleId, shader_module_drop);
owned_id!(
    ComputePipeline,
    id::ComputePipelineId,
    compute_pipeline_drop
);
owned_id!(RenderPipeline, id::RenderPipelineId, render_pipeline_drop);
owned_id!(CommandEncoder, id::CommandEncoderId, command_encoder_drop);
owned_id!(CommandBuffer, id::CommandBufferId, command_buffer_drop);
owned_id!(RenderBundle, id::RenderBundleId, render_bundle_drop);
owned_id!(QuerySet, id::QuerySetId, query_set_drop);
owned_id!(
    ComputePassEncoder,
    id::ComputePassEncoderId,
    compute_pass_drop
);
owned_id!(RenderPassEncoder, id::RenderPassEncoderId, render_pass_drop);
owned_id!(
    RenderBundleEncoder,
    id::RenderBundleEncoderId,
    render_bundle_encoder_drop
);

/// A device that exists, for [`wait_for_idle_at_exit`].
struct LiveDevice {
    id: id::DeviceId,
    /// The device's [`Device::exclusive`] lock: a poll frees every mapping when it finds the device lost.
    poll_lock: Arc<Guarded<()>>,
    /// [`release_device`] is waiting for its queue on its own thread.
    releasing: bool,
}

static DEVICES: Guarded<Vec<LiveDevice>> = Guarded::new(Vec::new());
static COMPILING: AtomicUsize = AtomicUsize::new(0);
static IDLE_AT_EXIT: AtomicBool = AtomicBool::new(false);
static EXITING: AtomicBool = AtomicBool::new(false);

/// The process is on its way out. A Worker can still run script: its new submissions and compiles are dropped, so that the GPU can go idle.
pub fn exiting() -> bool {
    EXITING.load(Ordering::Acquire)
}

/// How long an exit waits for the GPU to go idle. A shader that does not end has to lose.
const EXIT_WAIT: Duration = Duration::from_secs(10);

/// How long an exit waits for a release that is already in progress. That release has its own wait, which cannot be cut short.
const RELEASE_WAIT: Duration = Duration::from_secs(1);

/// Waits for the GPU and the driver's compiler to go idle. Every id stays registered: a Worker can still run script that uses one. Runs on its own thread: wgpu-core's locks read thread-local data, which the exiting thread no longer has.
fn drain_devices() {
    let release_deadline = Instant::now() + RELEASE_WAIT;
    while DEVICES.lock().iter().any(|device| device.releasing) {
        if Instant::now() >= release_deadline {
            break;
        }
        std::thread::sleep(Duration::from_millis(1));
    }
    let deadline = Instant::now() + EXIT_WAIT;
    loop {
        let busy = COMPILING.load(Ordering::Acquire) != 0
            || DEVICES.lock().iter().any(|device| {
                if device.releasing {
                    return false;
                }
                let _exclusive = device.poll_lock.lock();
                matches!(
                    instance().device_poll(device.id, wgt::PollType::Poll),
                    Ok(status) if !status.is_queue_empty()
                )
            });
        if !busy || Instant::now() >= deadline {
            break;
        }
        std::thread::sleep(Duration::from_millis(1));
    }
    IDLE_AT_EXIT.store(true, Ordering::Release);
}

/// `exit()` unloads the GPU driver while its own threads still run or compile a submission, which crashes inside the driver.
extern "C" fn wait_for_idle_at_exit() {
    EXITING.store(true, Ordering::Release);
    if DEVICES.lock().is_empty() {
        return;
    }
    let spawned = std::thread::Builder::new()
        .name(String::from("bun-webgpu-exit"))
        .spawn(drain_devices);
    if spawned.is_err() {
        return;
    }
    let deadline = Instant::now() + RELEASE_WAIT + EXIT_WAIT + Duration::from_secs(1);
    while !IDLE_AT_EXIT.load(Ordering::Acquire) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(1));
    }
}

/// wgpu-core's `Queue::drop` blocks until the GPU has finished the queue's work.
fn release_device(device: id::DeviceId, queue: id::QueueId) {
    let global = instance();
    global.queue_drop(queue);
    let mut devices = DEVICES.lock();
    devices.retain(|live| live.id != device);
    drop(devices);
    global.device_drop(device);
}

/// A device and its queue. wgpu-core keeps the device alive while its resources exist.
pub struct Device {
    device: id::DeviceId,
    queue: id::QueueId,
    /// Held by [`poll`](Self::poll) on the pool thread and by [`exclusive`](Self::exclusive) on the JS thread.
    poll_lock: Arc<Guarded<()>>,
}

impl Device {
    pub fn new(device: id::DeviceId, queue: id::QueueId) -> Self {
        static AT_EXIT: Once = Once::new();
        // Only where `bun_core::Global::exit` leaves through a path that runs the exit handlers of libraries: libc's `exit()` (macOS, ASAN builds) and `ExitProcess`. `quick_exit` runs none, so there is nothing to wait for.
        if cfg!(any(target_os = "macos", windows)) || bun_core::env::ENABLE_ASAN {
            AT_EXIT.call_once(|| bun_core::add_exit_callback(wait_for_idle_at_exit));
        }
        let poll_lock = Arc::new(Guarded::new(()));
        DEVICES.lock().push(LiveDevice {
            id: device,
            poll_lock: Arc::clone(&poll_lock),
            releasing: false,
        });
        Self {
            device,
            queue,
            poll_lock,
        }
    }
    #[inline]
    pub fn id(&self) -> id::DeviceId {
        self.device
    }
    #[inline]
    pub fn queue_id(&self) -> id::QueueId {
        self.queue
    }

    /// Fires the ready callbacks; `false` if the device is lost. Never a timed `Wait`: gfx-rs/wgpu#9958 aborts on it.
    pub fn poll(&self) -> bool {
        let _exclusive = self.poll_lock.lock();
        instance()
            .device_poll(self.device, wgt::PollType::Poll)
            .is_ok()
    }

    /// Runs `f` while no [`poll`](Self::poll) runs. A poll on the pool thread maps buffers, and it frees every mapping when it finds the device lost.
    pub fn exclusive<R>(&self, f: impl FnOnce() -> R) -> R {
        let _exclusive = self.poll_lock.lock();
        f()
    }
}

impl Drop for Device {
    fn drop(&mut self) {
        let (device, queue) = (self.device, self.queue);
        if let Some(live) = DEVICES.lock().iter_mut().find(|live| live.id == device) {
            live.releasing = true;
        }
        // Not here: this is the JS thread, often inside a finalizer, and the wait can be long.
        let spawned = std::thread::Builder::new()
            .name(String::from("bun-webgpu-release"))
            .spawn(move || release_device(device, queue));
        if spawned.is_err() {
            release_device(device, queue);
        }
    }
}

/// The `GPUError` subclasses. src/js/internal/webgpu.ts indexes its class table with the discriminant.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum ErrorKind {
    Validation = 0,
    OutOfMemory = 1,
    Internal = 2,
}

/// `GPUErrorFilter`.
pub fn parse_error_filter(s: &[u8]) -> Option<ErrorKind> {
    match s {
        b"validation" => Some(ErrorKind::Validation),
        b"out-of-memory" => Some(ErrorKind::OutOfMemory),
        b"internal" => Some(ErrorKind::Internal),
        _ => None,
    }
}

/// A wgpu-core error flattened for delivery to JS.
#[derive(Debug)]
pub struct GpuError {
    pub kind: ErrorKind,
    pub message: String,
    /// The device is lost. WebGPU drops operations on a lost device without a report.
    pub device_lost: bool,
}

impl GpuError {
    pub fn validation(message: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Validation,
            message: message.into(),
            device_lost: false,
        }
    }

    pub fn from_wgpu(err: &(impl wgt::error::WebGpuError + 'static)) -> Self {
        let (kind, device_lost) = match err.webgpu_error_type() {
            wgt::error::ErrorType::Validation => (ErrorKind::Validation, false),
            wgt::error::ErrorType::OutOfMemory => (ErrorKind::OutOfMemory, false),
            wgt::error::ErrorType::Internal => (ErrorKind::Internal, false),
            wgt::error::ErrorType::DeviceLost => (ErrorKind::Internal, true),
        };
        Self {
            kind,
            message: error_chain(err),
            device_lost,
        }
    }
}

/// `err` and every `source()` below it, one per line, indented by depth.
pub fn error_chain(err: &(dyn core::error::Error + 'static)) -> String {
    use core::fmt::Write;
    let mut out = err.to_string();
    let mut depth = 1usize;
    let mut source = err.source();
    while let Some(e) = source {
        out.push('\n');
        for _ in 0..depth {
            out.push_str("  ");
        }
        let _ = write!(out, "{e}");
        depth += 1;
        source = e.source();
    }
    out
}
