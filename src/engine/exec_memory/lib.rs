//! Executable memory: allocation, linking and patching of generated code.

mod code;
mod free_space;
mod instruction_cache;
mod pages;
mod pool;
#[cfg(windows)]
mod unwinding;

pub use code::{
    CodeHandle, FrameInUse, NativeFrames, Observer, OutOfExecutableMemory, Owner, Owners, Priority,
    link, lock_owners, owner_of_running_code, pressure, refuse, replace_with_jump, set_move_value,
    set_observer, set_transfer_target, transfer_target,
};
pub use instruction_cache::{synchronize_instructions, synchronize_instructions_of_all_threads};
pub use pool::{Usage, address_range, contains, is_available, limit_capacity, usage};
#[cfg(windows)]
pub use unwinding::{ExceptionHandler, describe_frames};
