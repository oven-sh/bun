//! What runs WebAssembly without knowing of JavaScript: memories, tables, instances, code and its tiers.

mod alloc;
mod call;
mod char_codes;
mod code;
mod compile;
mod engine;
mod faults;
mod frames;
mod global;
mod host;
mod instance;
pub mod interpreted;
mod interrupts;
mod memory;
mod module;
mod objects;
mod operations;
mod outcome;
mod queue;
mod registry;
mod resources;
mod slot;
mod store;
mod stubs;
pub mod suspension;
mod table;
mod tag;
mod value;
mod words;

pub use call::{EntryFrame, ExitFrame, HostCall, Incoming, Outgoing};
pub use char_codes::char_codes;
pub use code::{CodeKind, Compilers, Optimizer, optimize_fully};
pub use compile::{CompileError, Compiled, Parsed, StreamingCompiler};
pub use engine::{Engine, Options, Tiering};
pub use frames::{Catch, Frame, Handler, function_at, interpreted_function};
pub use global::Global;
pub use host::{Contents, Expected, Host, Interrupted, Owned, Thrown, Urgency, Vm, Waited};
pub use instance::{
    ConstantError, InitializeError, Instance, LinkError, NativeImport, SegmentError,
};
pub use interrupts::Interrupts;
pub use memory::{GrowError, Memory, MemoryUsage, Pages, SharedMemory, memory_usage};
pub use module::Module;
pub use objects::find_references;
pub use outcome::{Failure, Outcome};
pub use queue::wait_for_background_work;
pub use resources::{Resources, set_resources};
pub use store::{STACK_RESERVE, Store};
pub use table::{Table, TableType};
pub use tag::Tag;
pub use value::{Bits, HostCell, Reference};
