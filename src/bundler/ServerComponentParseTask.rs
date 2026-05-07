//! Files for Server Components are generated using `AstBuilder`, instead of
//! running through the js_parser. It emits a ParseTask.Result and joins
//! with the same logic that it runs though.

use core::mem::offset_of;
use std::fmt::Write as _;

use bun_alloc::{AllocError as OOM, Arena}; // bumpalo::Bump re-export
use bun_collections::BabyList;
use bun_core::fmt as bun_fmt;

use bun_logger::{Loc, Log, Source};
use bun_threading::thread_pool::Task as ThreadPoolTask;

use bun_js_parser::ast::{
    self as js_ast, ast::NamedExports, symbol, Binding, Expr, Stmt, B, E, G, S,
};
use bun_js_parser::{ExprNodeList, LocRef, StmtOrExpr, UseDirective};
use bun_options_types::{ImportKind, ImportRecordFlags};
use bun_resolver as _resolver;

use crate::bundle_v2::BundleV2;
use crate::cache::ExternalFreeFunction;
use crate::options::{self, Loader, Target};
use crate::parse_task::{self, on_complete, ResultValue, Success, WatcherData};
use crate::ungate_support::JSAst;
use crate::AstBuilder::AstBuilder;
use crate::Worker;

pub use crate::ThreadPool;

pub use crate::parse_task::ParseTask;
pub use crate::DeferredBatchTask::DeferredBatchTask;
pub use bun_js_parser::ast::{Index, Ref};
// TODO(port): the Zig re-exports `DeferredBatchTask`, `ThreadPool`, `ParseTask`, `Ref`, `Index`
// publicly from this module; verify whether downstream callers depend on these being re-exported
// here vs. importing from bundle_v2 directly. Phase B may delete the re-exports.

pub struct ServerComponentParseTask {
    pub task: ThreadPoolTask,
    pub data: Data,
    // BACKREF (LIFETIMES.tsv) — Zig `*BundleV2` is mutable; written through in `on_complete`.
    pub ctx: *mut BundleV2<'static>,
    pub source: Source,
}

pub enum Data {
    /// Generate server-side code for a "use client" module. Given the
    /// client ast, a "reference proxy" is created with identical exports.
    ClientReferenceProxy(ReferenceProxy),

    ClientEntryWrapper(ClientEntryWrapper),
}

pub struct ReferenceProxy {
    pub other_source: Source,
    pub named_exports: NamedExports,
}

pub struct ClientEntryWrapper {
    // TODO(port): lifetime — Zig `[]const u8` borrowed from caller; never freed in this file.
    pub path: Box<[u8]>,
}

/// Raw thread-pool callback. Recovers `&mut ServerComponentParseTask` from the
/// intrusive `task` field and dispatches the parse, then posts the result back
/// to the owning event loop.
fn task_callback_wrap(thread_pool_task: *mut ThreadPoolTask) {
    // SAFETY: `thread_pool_task` points to the `task` field of a heap-allocated
    // `ServerComponentParseTask` enqueued by BundleV2; offset_of recovers the parent.
    let task: &mut ServerComponentParseTask = unsafe {
        &mut *(thread_pool_task
            .cast::<u8>()
            .sub(offset_of!(ServerComponentParseTask, task))
            .cast::<ServerComponentParseTask>())
    };

    // SAFETY: `task.ctx` is a live BACKREF to the owning BundleV2.
    let worker = Worker::get(unsafe { &*task.ctx });
    // PORT NOTE: `defer worker.unget()` — handled at end of fn (no early returns).
    let mut log = Log::new();

    // SAFETY: `worker.allocator` is set in `Worker::create` to point at the
    // worker-owned bump arena; lives for the worker's lifetime.
    let allocator: &Arena = unsafe { &*worker.allocator };

    let value = match task_callback(task, &mut log, allocator) {
        Ok(success) => ResultValue::Success(success),
        // Only possible error is OOM; abort like `bun.outOfMemory()`.
        Err(_oom) => bun_core::out_of_memory(),
    };

    let result = Box::new(parse_task::Result {
        ctx: task.ctx,
        // SAFETY: Zig leaves `.task = undefined`; consumer overwrites before read.
        task: Default::default(),
        value,
        external: ExternalFreeFunction::NONE,
        watcher_data: WatcherData::NONE,
    });
    let result = Box::into_raw(result);

    // Zig matched `worker.ctx.loop().*` on `AnyEventLoop::{js, mini}`.
    // SAFETY: `worker.ctx` is a live BACKREF.
    let r#loop = *unsafe { &mut *(worker.ctx as *mut BundleV2<'static>) }.r#loop();
    worker.unget();
    let Some(any_loop) = r#loop else {
        // No event loop registered (e.g., synchronous CLI bundling) — run inline.
        on_complete(result);
        return;
    };
    // SAFETY: BACKREF — `any_loop` outlives this parse task.
    match unsafe { &mut *any_loop.as_ptr() } {
        bun_event_loop::AnyEventLoop::Js { owner, vtable } => {
            // SAFETY: vtable populated by runtime; `owner` is a live `*mut jsc::EventLoop`.
            unsafe {
                (vtable.enqueue_task_concurrent)(
                    *owner,
                    bun_event_loop::ConcurrentTask::ConcurrentTask::from_callback(
                        result,
                        |p| { on_complete(p); Ok(()) },
                    ),
                );
            }
        }
        bun_event_loop::AnyEventLoop::Mini(mini) => {
            mini.enqueue_task_concurrent_with_extra_ctx::<parse_task::Result, BundleV2<'static>>(
                result,
                on_complete_mini,
                offset_of!(parse_task::Result, task),
            );
        }
    }
}

fn on_complete_mini(result: *mut parse_task::Result, _ctx: *mut BundleV2<'static>) {
    // `on_complete` already recovers `ctx` from `result.ctx`.
    on_complete(result);
}

fn task_callback(
    task: &mut ServerComponentParseTask,
    log: &mut Log,
    bump: &Arena,
) -> Result<Success, OOM> {
    // SAFETY: `task.ctx` is a live BACKREF to the owning BundleV2.
    let ctx: &BundleV2 = unsafe { &*task.ctx };
    // PORT NOTE: `Source` is not `Clone`; the original is consumed here
    // (Zig copied by value). Take it up-front so `ab`'s borrow of it ends
    // (via NLL) before we move it into `Success`.
    let source = core::mem::take(&mut task.source);
    let mut ab = AstBuilder::init(
        bump,
        &source,
        ctx.transpiler().options.hot_module_reloading,
    )?;

    match &task.data {
        Data::ClientReferenceProxy(data) => generate_client_reference_proxy(ctx, data, &mut ab)?,
        Data::ClientEntryWrapper(data) => generate_client_entry_wrapper(data, &mut ab)?,
    }

    let target = match &task.data {
        // Server-side
        Data::ClientReferenceProxy(_) => ctx.transpiler().options.target,
        // Client-side,
        Data::ClientEntryWrapper(_) => Target::Browser,
    };
    let hmr_api_ref = ab.hmr_api_ref;
    // SAFETY: `BundledAst` stores arena-backed raw pointers; the elided lifetime
    // on `to_bundled_ast`'s return only ties it to `&mut ab` borrow-wise, not
    // semantically. Erase to `'static` to match `Success.ast: JSAst`.
    let mut bundled_ast: JSAst =
        unsafe { core::mem::transmute::<_, JSAst>(ab.to_bundled_ast(target)?) };

    // `wrapper_ref` is used to hold the HMR api ref (see comment in
    // `src/ast/Ast.zig`)
    bundled_ast.wrapper_ref = hmr_api_ref;

    Ok(Success {
        ast: bundled_ast,
        source,
        loader: Loader::Js,
        log: core::mem::take(log),
        use_directive: UseDirective::None,
        side_effects: _resolver::SideEffects::NoSideEffectsPureData,
        unique_key_for_additional_file: b"",
        content_hash_for_additional_file: 0,
        package_name: b"",
    })
}

impl ServerComponentParseTask {
    /// Expose the thread-pool callback so callers can construct
    /// `ThreadPoolLib::Task { callback: Self::TASK_CALLBACK }`.
    pub const TASK_CALLBACK: fn(*mut ThreadPoolTask) = task_callback_wrap;
}

impl Default for ServerComponentParseTask {
    /// Mirrors Zig's `task: ThreadPoolLib.Task = .{ .callback = &taskCallbackWrap }`
    /// default-field-value. Callers (`bundle_v2.rs`) supply `data`/`ctx`/`source`
    /// via FRU and rely on this for the intrusive `task` link.
    fn default() -> Self {
        Self {
            task: ThreadPoolTask {
                node: Default::default(),
                callback: task_callback_wrap,
            },
            data: Data::ClientEntryWrapper(ClientEntryWrapper { path: Box::default() }),
            ctx: core::ptr::null_mut(),
            source: Source::default(),
        }
    }
}

fn generate_client_entry_wrapper(
    data: &ClientEntryWrapper,
    b: &mut AstBuilder,
) -> Result<(), OOM> {
    // SAFETY: `add_import_record` requires `&'static [u8]` only because the
    // resulting `ImportRecord` stores the slice raw; `data.path` outlives the
    // bundle pass (owned by the heap-allocated task). Erase the lifetime.
    let path: &'static [u8] =
        unsafe { core::mem::transmute::<&[u8], &'static [u8]>(&data.path[..]) };
    let record = b.add_import_record(path, ImportKind::Stmt)?;
    let namespace_ref = b.new_symbol(symbol::Kind::Other, b"main")?;
    b.append_stmt(S::Import {
        namespace_ref,
        import_record_index: record,
        is_single_line: true,
        ..Default::default()
    })?;
    b.import_records[record as usize]
        .flags
        .insert(ImportRecordFlags::WAS_ORIGINALLY_BARE_IMPORT);
    Ok(())
}

fn generate_client_reference_proxy(
    ctx: &BundleV2,
    data: &ReferenceProxy,
    b: &mut AstBuilder,
) -> Result<(), OOM> {
    let server_components = ctx
        .framework
        .as_ref()
        .unwrap()
        .server_components
        .as_ref()
        // config must be non-null to enter this function
        .unwrap_or_else(|| unreachable!());

    let client_named_exports = &data.named_exports;

    // SAFETY: `add_import_stmt` requires `'static` slices only because the
    // resulting `ImportRecord`/`ClauseItem`s store them raw; the framework
    // config outlives the bundle pass. Erase the lifetimes.
    let runtime_import: &'static [u8] = unsafe {
        core::mem::transmute::<&[u8], &'static [u8]>(&server_components.server_runtime_import[..])
    };
    let register_ref: &'static [u8] = unsafe {
        core::mem::transmute::<&[u8], &'static [u8]>(
            &server_components.server_register_client_reference[..],
        )
    };
    let register_client_reference = b.add_import_stmt(runtime_import, [register_ref])?[0];

    let module_path = b.new_expr(E::String::init(
        // In development, the path loaded is the source file: Easy!
        //
        // In production, the path here must be the final chunk path, but
        // that information is not yet available since chunks are not
        // computed. The unique_key replacement system is used here.
        if !ctx.transpiler().options.dev_server.is_null() {
            b.bump.alloc_slice_copy(data.other_source.path.pretty)
        } else {
            // PERF(port): was arena allocPrint — profile in Phase B
            let mut buf = bumpalo::collections::String::new_in(b.bump);
            write!(
                &mut buf,
                "{}S{:08}",
                bun_fmt::hex_int_lower::<16>(ctx.unique_key),
                data.other_source.index.0,
            )
            .map_err(|_| OOM)?;
            buf.into_bump_str().as_bytes()
        },
    ));

    for key in client_named_exports.keys() {
        let key: &[u8] = key.as_ref();
        let is_default = key == b"default";

        // This error message is taken from
        // https://github.com/facebook/react/blob/c5b9375767e2c4102d7e5559d383523736f1c902/packages/react-server-dom-webpack/src/ReactFlightWebpackNodeLoader.js#L323-L354
        let err_msg_string: &[u8] = {
            // PERF(port): was arena allocPrint — profile in Phase B
            let mut buf = bumpalo::collections::String::new_in(b.bump);
            if is_default {
                write!(
                    &mut buf,
                    concat!(
                        "Attempted to call the default export of {module_path} from ",
                        "the server, but it's on the client. It's not possible to invoke a ",
                        "client function from the server, it can only be rendered as a ",
                        "Component or passed to props of a Client Component.",
                    ),
                    module_path = bstr::BStr::new(data.other_source.path.pretty),
                )
            } else {
                write!(
                    &mut buf,
                    concat!(
                        "Attempted to call {key}() from the server but {key} ",
                        "is on the client. It's not possible to invoke a client function from ",
                        "the server, it can only be rendered as a Component or passed to ",
                        "props of a Client Component.",
                    ),
                    key = bstr::BStr::new(key),
                )
            }
            .map_err(|_| OOM)?;
            buf.into_bump_str().as_bytes()
        };

        // throw new Error(...)
        // Hoist the `&mut self` symbol allocation out of the nested `&self`
        // `new_expr` calls to satisfy the borrow checker.
        let error_ref = b.new_external_symbol(b"Error")?;
        let err_msg = b.new_expr(E::New {
            target: b.new_expr(E::Identifier {
                ref_: error_ref,
                ..Default::default()
            }),
            args: BabyList::<Expr>::from_slice(&[b.new_expr(E::String::init(err_msg_string))])?,
            close_parens_loc: Loc::EMPTY,
            ..Default::default()
        });

        // registerClientReference(
        //   () => { throw new Error(...) },
        //   "src/filepath.tsx",
        //   "Comp"
        // );
        let throw_stmt = b.new_stmt(S::Throw { value: err_msg });
        let arrow_body_stmts: &mut [Stmt] = b.bump.alloc_slice_copy(&[throw_stmt]);
        let value = b.new_expr(E::Call {
            target: register_client_reference,
            args: ExprNodeList::from_slice(&[
                b.new_expr(E::Arrow {
                    body: G::FnBody {
                        stmts: arrow_body_stmts as *mut [Stmt],
                        loc: Loc::EMPTY,
                    },
                    ..Default::default()
                }),
                module_path,
                b.new_expr(E::String::init(b.bump.alloc_slice_copy(key))),
            ])?,
            ..Default::default()
        });

        if is_default {
            let ref_ = b.new_symbol(symbol::Kind::Other, b"default")?;
            // export default registerClientReference(...);
            b.append_stmt(S::ExportDefault {
                value: StmtOrExpr::Expr(value),
                default_name: LocRef { loc: Loc::EMPTY, ref_: Some(ref_) },
            })?;
        } else {
            // export const Component = registerClientReference(...);
            let export_ref = b.new_symbol(symbol::Kind::Other, key)?;
            b.append_stmt(S::Local {
                decls: G::DeclList::from_slice(&[G::Decl {
                    binding: Binding::alloc(
                        b.bump,
                        B::Identifier { r#ref: export_ref },
                        Loc::EMPTY,
                    ),
                    value: Some(value),
                }])?,
                is_export: true,
                kind: S::Kind::KConst,
                ..Default::default()
            })?;
        }
    }

    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/ServerComponentParseTask.zig (247 lines)
//   confidence: medium
//   notes:      Event-loop dispatch (`EventLoop::Js`/`::Mini`) follows the
//               crate-wide pattern shared with ParseTask.rs / bundle_v2.rs;
//               resolves once `ungate_support::EventLoop` becomes a real enum.
// ──────────────────────────────────────────────────────────────────────────
