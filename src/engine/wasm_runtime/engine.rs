//! What all threads share: the host, the options and the stubs.

use bun_engine_asm::Features as CpuFeatures;
use bun_engine_exec_memory::OutOfExecutableMemory;
use bun_engine_wasm_compiler::abi::{Callable, HostLayout};
use bun_engine_wasm_format::Features;

use crate::code::Optimizer;
use crate::faults;
use crate::host::Host;
use crate::stubs::StubCode;
use crate::value::HostCell;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Tiering {
    /// Nothing is compiled, and no machine code is made at all.
    Interpreted,
    BaselineOnly,
    /// Functions are optimized when they are first called.
    OptimizedOnly,
    /// After this many turns of loops, or what corresponds to them in calls.
    After(u32),
}

impl Tiering {
    pub const DEFAULT: Self = Self::After(50_000);

    /// Whether a function ever gets machine code.
    pub const fn compiles(self) -> bool {
        !matches!(self, Self::Interpreted)
    }
}

#[derive(Clone, Copy)]
pub struct Options {
    pub features: Features,
    pub cpu: CpuFeatures,
    /// Without it all checks are explicit.
    pub handle_faults: bool,
    /// Takes `handle_faults`.
    pub guard_memories: bool,
    pub tiering: Tiering,
    pub optimizer: Optimizer,
    /// Without it all work is done by the thread that asks for it, at once.
    pub use_threads: bool,
    /// Random bits.
    pub seed: u64,
}

pub struct Engine {
    host: &'static dyn Host,
    layout: HostLayout,
    options: Options,
    /// None where nothing is compiled.
    stubs: Option<StubCode>,
}

impl Engine {
    /// It stays for good. Code of different engines does not meet on a stack.
    pub fn new(
        host: &'static dyn Host,
        mut options: Options,
    ) -> Result<&'static Self, OutOfExecutableMemory> {
        options.handle_faults =
            options.handle_faults && options.tiering.compiles() && faults::install_handler();
        // Only code that leaves a check to a fault needs the handler for the room after a memory.
        options.guard_memories &= options.handle_faults || !options.tiering.compiles();
        let mut layout = host.layout();
        layout.null_guard_size = match options.handle_faults {
            true => faults::NULL_GUARD_SIZE,
            false => 0,
        };
        let stubs = match options.tiering.compiles() {
            true => Some(StubCode::new(&layout, options.cpu)?),
            false => None,
        };
        Ok(Box::leak(Box::new(Self {
            host,
            layout,
            options,
            stubs,
        })))
    }

    #[inline]
    pub(crate) fn host(&self) -> &'static dyn Host {
        self.host
    }

    #[inline]
    pub fn layout(&self) -> &HostLayout {
        &self.layout
    }

    /// With what turned out to be impossible switched off.
    #[inline]
    pub fn options(&self) -> &Options {
        &self.options
    }

    #[inline]
    pub(crate) fn stubs(&self) -> &StubCode {
        self.stubs.as_ref().expect("an engine that compiles")
    }

    #[inline]
    pub(crate) fn stubs_if_any(&self) -> Option<&StubCode> {
        self.stubs.as_ref()
    }

    /// Whether functions get machine code. Without it the stubs below are not there, and the host runs functions
    /// itself.
    #[inline]
    pub fn compiles(&self) -> bool {
        self.stubs.is_some()
    }

    /// The stub for an import of any type that leads to [`Host::call`].
    pub fn host_call_stub(&self) -> usize {
        self.stubs().host_call
    }

    /// To jump to with the frame pointer at a frame like that of the stub, and a word for [`Host::put_results`] where
    /// functions return one.
    pub fn end_of_host_call_stub(&self) -> usize {
        self.stubs().end_of_host_call
    }

    /// Calls a function of any type. It is called like a JavaScript function, with a `funcref` for the callee, and
    /// leaves the rest to [`Host::put_arguments`] and [`Host::take_results`].
    pub fn enter_stub(&self) -> usize {
        self.stubs().enter
    }

    /// To jump to with a frame like that of the stub, when the function has returned.
    pub fn end_of_enter_stub(&self) -> usize {
        self.stubs().end_of_enter
    }

    /// # Safety
    /// `function` is a `funcref`.
    #[inline]
    pub unsafe fn callable_of(&self, function: HostCell) -> Callable {
        // SAFETY: the caller's.
        unsafe {
            function
                .field::<Callable>(self.layout.function_callable)
                .read()
        }
    }
}
