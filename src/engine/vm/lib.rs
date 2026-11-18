//! The heap, the object model, realms and the run-time operations that every tier calls.

#![feature(
    adt_const_params,
    allocator_ext,
    allow_internal_unstable,
    auto_traits,
    core_intrinsics,
    loop_match,
    macro_metavar_expr_concat,
    marker_trait_attr,
    maybe_uninit_fill,
    naked_functions_rustic_abi,
    negative_impls,
    rust_preserve_none_cc,
    offset_of_enum,
    rust_cold_cc,
    thread_local,
    variant_count
)]
#![allow(incomplete_features, internal_features)]
// References to cells are plain pointers, and a `JsResult<Value>` is one word.
#![allow(improper_ctypes_definitions)]

extern crate self as bun_engine_vm;

pub mod caches;
pub mod call;
mod cell_type;
pub mod code;
mod cx;
mod debugger;
pub mod direct;
mod error;
mod frame;
mod function;
mod hash;
pub mod heap;
mod hooks;
pub mod ic;
mod intrinsic;
mod object;
mod operations;
mod options;
mod primitive;
mod probes;
mod realm;
mod runtime;
pub mod scope;
mod services;
mod traps;
mod value;
mod vm;
mod watchpoint;

pub use call::{CallData, NativeFunction, RepeatedCall};
pub use cell_type::{CellType, CellTypeRange, TypeFlags};
pub use code::*;
pub use cx::{Cx, JsResult, NoGc, Thrown};
pub use debugger::{CollectionObserver, Debugger, DebuggerFrame, WasmModuleDescription};
pub use error::*;
pub use frame::{CallFrame, EntryRecord};
pub use function::*;
pub use hash::{FastHashMap, FastHashSet, FastHasher};
pub use heap::{
    CellKind, Extends, Field, FieldArray, Gc, GcCell, GcFree, JsCell, RootVec, Strong, Trace,
    TracedMap, TracedVec, ValueVec, Visitor, Weak, WeakField, root_vec,
};
pub use hooks::{BuiltinSource, Hooks};
pub use intrinsic::{BuiltinId, Intrinsic};
pub use object::*;
pub use operations::*;
pub use options::{Options, options, parse_flag, parse_number, set_options};
pub use primitive::*;
pub use probes::{Forbidden, Probes};
pub use realm::*;
pub use runtime::*;
pub use scope::{Environment, ModuleEnvironment, ScopeTemplate};
pub use traps::{DeferTraps, Trap, TrapObserver, Traps, WakeOnTermination};
pub use value::Value;
pub use vm::{Embedder, SuspendException, Vm, VmRef, VmShapes};
pub use watchpoint::{
    DeferredFire, InlineWatchpointSet, Watcher, Watchpoint, WatchpointSet, WatchpointState,
};
