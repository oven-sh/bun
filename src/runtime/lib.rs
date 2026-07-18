#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![allow(ambiguous_glob_reexports, hidden_glob_reexports)]
// FFI signatures with non-repr(C) types are silent ABI corruption — promote to
// hard errors. Opaque-pointer round-trips (C++ stores `void*`, never derefs)
// are individually `#[allow]`ed at the extern block with a justification.
#![deny(improper_ctypes, improper_ctypes_definitions)]
#![feature(adt_const_params)]
#![feature(thread_local)]
#![allow(incomplete_features)]

extern crate alloc;
extern crate self as bun_runtime;
extern crate bun_js as bun_js_parser;
extern crate bun_js as bun_js_printer;
// Self-aliases so mounted `*_jsc` sources' sibling extern refs resolve to this
// crate root until Step 7.14's sed rewrites them to `crate::<mount>::`.
pub extern crate self as bun_sql_jsc;
pub extern crate self as bun_http_jsc;
pub extern crate self as bun_css_jsc;
pub extern crate self as bun_bundler_jsc;
pub extern crate self as bun_install_jsc;
pub extern crate self as bun_js_parser_jsc;
pub extern crate self as bun_sourcemap_jsc;
pub extern crate self as bun_patch_jsc;
pub extern crate self as bun_semver_jsc;
pub extern crate self as bun_sys_jsc;
pub extern crate self as bun_ast_jsc;

extern crate bun_crypto as bun_boringssl;
extern crate bun_crypto as bun_boringssl_sys;
extern crate bun_crypto as bun_s3_signing;
extern crate bun_crypto as bun_sha_hmac;
pub mod error;
pub use error::{Error, Result};

// §8 Step 7.5 — flat group-A re-export so mounted group-B / `*_jsc` sources'
// `use crate::{self as jsc, JSValue, JSGlobalObject, VM, …}` lines resolve.
pub use bun_jsc::*;

/// `crate::jsc` is now a thin re-export of the real `bun_jsc` crate. Draft
/// modules that imported `crate::jsc::…` (instead of `bun_jsc::…`) continue to
/// resolve unchanged.
pub mod jsc {
    pub use bun_jsc::*;
}

// ─────────────────────────────────────────────────────────────────────────────
// §8 Step 7.5 — group-B `#[path]` mounts (files stay under src/jsc/ on disk).
// ─────────────────────────────────────────────────────────────────────────────
#[path = "../jsc/VirtualMachine.rs"]
pub mod virtual_machine;
#[path = "../jsc/ModuleLoader.rs"]
pub mod module_loader;
#[path = "../jsc/AsyncModule.rs"]
pub mod async_module;
#[path = "../jsc/ConsoleObject.rs"]
pub mod console_object;
#[path = "../jsc/Debugger.rs"]
pub mod debugger;
#[path = "../jsc/event_loop.rs"]
pub mod event_loop;
#[path = "../jsc/hot_reloader.rs"]
pub mod hot_reloader;
#[path = "../jsc/ipc.rs"]
pub mod ipc;
#[path = "../jsc/rare_data.rs"]
pub mod rare_data;
#[path = "../jsc/web_worker.rs"]
pub mod web_worker;
#[path = "../jsc/RuntimeTranspilerStore.rs"]
pub mod runtime_transpiler_store;
#[path = "../jsc/RuntimeTranspilerCache.rs"]
pub mod runtime_transpiler_cache;
#[path = "../jsc/virtual_machine_exports.rs"]
pub mod virtual_machine_exports;
#[path = "../jsc/btjs.rs"]
pub mod btjs;
#[path = "../jsc/HTTPServerAgent.rs"]
pub mod http_server_agent;
#[path = "../jsc/GarbageCollectionController.rs"]
pub mod garbage_collection_controller;
#[path = "../jsc/NodeModuleModule.rs"]
pub mod node_module_module;
#[path = "../jsc/PluginRunner.rs"]
pub mod plugin_runner;
#[path = "../jsc/PosixSignalHandle.rs"]
pub mod posix_signal_handle;
#[path = "../jsc/ProcessAutoKiller.rs"]
pub mod process_auto_killer;
#[path = "../jsc/SavedSourceMap.rs"]
pub mod saved_source_map;
#[path = "../jsc/WorkTask.rs"]
pub mod work_task;
#[path = "../jsc/ConcurrentPromiseTask.rs"]
pub mod concurrent_promise_task;
#[path = "../jsc/CppTask.rs"]
pub mod cpp_task;
#[path = "../jsc/JSCScheduler.rs"]
pub mod jsc_scheduler;
#[path = "../jsc/Task.rs"]
pub mod task;
#[path = "../jsc/EventLoopHandle.rs"]
pub mod event_loop_handle;
#[path = "../jsc/any_task_job.rs"]
pub mod any_task_job;
#[path = "../jsc/JSSecrets.rs"]
pub mod js_secrets;
#[path = "../jsc/AbortSignal.rs"]
pub mod abort_signal;
#[path = "../jsc/arguments_slice.rs"]
pub mod arguments_slice;

pub mod jsc_ext;
#[path = "vm_error.rs"]
pub mod vm_error;

/// §8 Step 7.5 — `crate::vm::<N>` facade over the group-B mounts. Re-exports
/// both snake_case module paths and the PascalCase type names the pre-split
/// `bun_jsc` surface carried.
pub mod vm {
    pub use super::virtual_machine::*;
    pub use super::module_loader::*;
    pub use super::async_module::*;
    pub use super::console_object::*;
    pub use super::debugger::*;
    pub use super::event_loop::*;
    pub use super::hot_reloader::*;
    pub use super::ipc::*;
    pub use super::rare_data::*;
    pub use super::web_worker::*;
    pub use super::runtime_transpiler_store::*;
    pub use super::runtime_transpiler_cache::*;
    pub use super::virtual_machine_exports::*;
    pub use super::http_server_agent::*;
    pub use super::garbage_collection_controller::*;
    pub use super::node_module_module::*;
    pub use super::plugin_runner::*;
    pub use super::posix_signal_handle::*;
    pub use super::process_auto_killer::*;
    pub use super::saved_source_map::*;
    pub use super::concurrent_promise_task::*;
    pub use super::cpp_task::*;
    pub use super::jsc_scheduler::*;
    pub use super::task::*;
    pub use super::task::Task;
    pub use super::event_loop_handle::*;
    pub use super::any_task_job::*;
    pub use super::js_secrets::*;
    pub use super::abort_signal::*;
    pub use super::arguments_slice::*;

    pub use super::{
        abort_signal, any_task_job, arguments_slice, async_module, btjs, concurrent_promise_task,
        console_object, debugger, event_loop, event_loop_handle, garbage_collection_controller,
        hot_reloader, http_server_agent, ipc, js_secrets, jsc_scheduler, module_loader,
        node_module_module, plugin_runner, posix_signal_handle, process_auto_killer, rare_data,
        runtime_transpiler_cache, runtime_transpiler_store, saved_source_map, task,
        virtual_machine, virtual_machine_exports, web_worker, work_task,
    };
    pub use super::cpp_task;
    pub use super::console_object as ConsoleObject;
    pub use super::console_object::Formatter;
    pub use super::debugger as Debugger;
    pub use super::event_loop as EventLoop;
    pub use super::module_loader as ModuleLoader;
    pub use super::rare_data as RareData;
    pub use super::saved_source_map as SavedSourceMap;
    pub use super::virtual_machine as VirtualMachine;
    pub use super::virtual_machine::InitOptions as VirtualMachineInitOptions;

    pub use super::vm_error as error;
    pub use super::vm_error::{Error, Result};
}

// Crate-root compat re-exports for group-B names that pre-split `bun_jsc`
// exposed flat (matched by `pub use crate::*;` consumers).
pub use self::abort_signal::{AbortSignal, AbortSignalRef};
pub use self::any_task_job::{AnyTaskJob, AnyTaskJobCtx};
pub use self::arguments_slice::ArgumentsSlice;
pub use self::console_object as ConsoleObject;
pub use self::console_object::Formatter;
pub use self::debugger as Debugger;
pub use self::event_loop as EventLoop;
pub use self::hot_reloader::{HotReloader, ImportWatcher, NewHotReloader, WatchReloader};
pub use self::module_loader as ModuleLoader;
pub use self::rare_data as RareData;
pub use self::runtime_transpiler_cache::RuntimeTranspilerCache;
pub use self::runtime_transpiler_store::RuntimeTranspilerStore;
pub use self::saved_source_map as SavedSourceMap;
pub use self::task::{Task, TaskTag, Taskable, task_tag};
pub use self::event_loop::{
    AbstractVM, AnyEventLoop, AnyTask, AnyTaskWithExtraContext, ConcurrentCppTask,
    ConcurrentPromiseTask, ConcurrentTask, CppTask, DeferredTaskQueue, EventLoopHandle,
    EventLoopKind, EventLoopTask, EventLoopTaskPtr, GarbageCollectionController, ManagedTask,
    MiniEventLoop, MiniVM, PosixSignalHandle, PosixSignalTask, WorkPool, WorkPoolTask, WorkTask,
    WorkTaskContext,
};
pub use self::posix_signal_handle as PosixSignalHandleMod;
pub use self::sys_jsc::SystemErrorJsc;
pub use bun_loop::PlatformEventLoop;
pub use self::virtual_machine as VirtualMachine;
pub use self::virtual_machine::InitOptions as VirtualMachineInitOptions;
pub use self::virtual_machine::VirtualMachine as VirtualMachineRef;
pub use self::web_worker::WebWorker;
pub use self::jsc_ext::*;

// ─────────────────────────────────────────────────────────────────────────────
// §8 Step 7.5 — `*_jsc` crate mounts. Source dirs stay under src/*_jsc/.
// ─────────────────────────────────────────────────────────────────────────────
#[path = "../sql_jsc/lib.rs"]
pub mod sql;
#[path = "../http_jsc/lib.rs"]
pub mod http_jsc;
#[path = "../css_jsc/lib.rs"]
pub mod css_jsc;
#[path = "../bundler_jsc/lib.rs"]
pub mod bundler_jsc;
#[path = "../install_jsc/lib.rs"]
pub mod install_jsc;
#[path = "../js_parser_jsc/lib.rs"]
pub mod js_parser_jsc;
#[path = "../sourcemap_jsc/lib.rs"]
pub mod sourcemap_jsc;
#[path = "../patch_jsc/lib.rs"]
pub mod patch_jsc;
#[path = "../semver_jsc/lib.rs"]
pub mod semver_jsc;
#[path = "../sys_jsc/lib.rs"]
pub mod sys_jsc;
#[path = "../ast_jsc/lib.rs"]
pub mod ast_jsc;

// ─── runtime submodules ──────────────────────────────────────────────────
pub mod allocators; // moved from bun_alloc (tier-0 → bun_core/sys/runtime back-edge)
pub mod crypto;
pub mod ffi;
#[path = "node.rs"]
pub mod node;
pub mod server;
pub mod socket;
#[path = "webcore.rs"]
pub mod webcore;

pub mod bake;
pub mod cli;
pub mod shell;
// `Run::boot` / `Run::boot_standalone`. Mounted here
// (not as a separate crate) because every dependency it has is already a dep of
// `bun_runtime`, and the CLI dispatch in `cli/` needs to call it directly. The
// original "higher-tier crate" split was speculative; folding it in breaks the
// cycle the `bun_bun_js` shims were papering over.
#[path = "api.rs"]
pub mod api;
pub mod dispatch;
pub mod hw_exports;

/// Process-init registration for cross-crate `OnceLock` hooks. Called from
/// `bun_bin::main` before CLI dispatch so the `bun install` / `MiniEventLoop`
/// paths find every slot set. Amended per-step as new hooks are introduced.
pub fn register_dispatch_tables() {
    bun_js::MACRO_GC_HOOK
        .set(crate::vm::collect_macro_vm_garbage)
        .ok();
}
pub mod ipc_host;
pub mod jsc_hooks;
pub mod linear_fifo_testing;
pub mod napi;
#[path = "../bun.js.rs"]
pub mod run_main;
pub mod timer;
// `generated_classes_list.rs` lives under `src/jsc/` but every type it
// aliases is defined in this crate (api/webcore/test_runner/bake) or a
// same-tier dep, so it is `#[path]`-mounted here to avoid a bun_jsc cycle.
#[path = "../jsc/generated_classes_list.rs"]
pub mod generated_classes_list;
pub use generated_classes_list::Classes as GeneratedClassesList;
pub mod generated_classes; // include!()s ${BUN_CODEGEN_DIR}/generated_classes.rs
pub mod generated_host_exports; // include!()s ${BUN_CODEGEN_DIR}/generated_host_exports.rs
pub mod generated_js2native; // include!()s ${BUN_CODEGEN_DIR}/generated_js2native.rs
pub mod generated_jssink; // include!()s ${BUN_CODEGEN_DIR}/generated_jssink.rs

pub mod dns_jsc;
pub mod image;
pub mod test_runner;
pub mod valkey_jsc;

// ─── crate-root re-exports for `cli/` submodules ────────────────────────────
// Modules under `src/runtime/cli/**` use crate-root paths
// (`crate::Command`, `crate::test_command`, `crate::run_command`, …).
// Surface those names here
// so `*_command.rs` and `test/parallel/*.rs` files resolve their
// `use crate::…` lines without per-file edits.
pub use cli::{
    Cli, Command, add_completions, build_command, bunx_command, command, create_command,
    filter_arg, filter_run, multi_run, package_manager_command, run_command, shell_completions,
    test_command,
};

pub mod webview;
