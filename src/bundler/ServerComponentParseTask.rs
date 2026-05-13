//! Files for Server Components are generated using `AstBuilder`, instead of
//! running through the js_parser. It emits a ParseTask.Result and joins
//! with the same logic that it runs though.

use core::mem::offset_of;
use std::fmt::Write as _;

use bun_alloc::{AllocError as OOM, Arena}; // bumpalo::Bump re-export
use bun_collections::VecExt;

use bun_ast::{Loc, Log, Source};
use bun_threading::thread_pool::Task as ThreadPoolTask;

use bun_ast::ast_result::NamedExports;
use bun_ast::{self as js_ast, B, Binding, E, Expr, G, S, Stmt, symbol};
use bun_ast::{ExprNodeList, LocRef, StmtOrExpr, UseDirective};
use bun_ast::{ImportKind, ImportRecordFlags};
use bun_resolver as _resolver;

use crate::AstBuilder::AstBuilder;
use crate::Worker;
use crate::bundle_v2::BundleV2;
use crate::cache::ExternalFreeFunction;
use crate::options::{self, Loader, Target};
use crate::parse_task::{self, ResultValue, Success, WatcherData, on_complete};
use crate::ungate_support::JSAst;

pub use crate::ThreadPool;

pub use crate::DeferredBatchTask::DeferredBatchTask;
pub use crate::parse_task::ParseTask;
use bun_ast::{Index, Ref};

pub struct ServerComponentParseTask {
    pub task: ThreadPoolTask,
    pub data: Data,
    // BACKREF (LIFETIMES.tsv) — Zig `*BundleV2` is mutable; written through in `on_complete`.
    // `ParentRef` (write-provenance via `NonNull::from(&mut self)` at construction)
    // so deref sites are safe; `None` only for the FRU `Default` placeholder.
    pub ctx: Option<bun_ptr::ParentRef<BundleV2<'static>>>,
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
// CONCURRENCY: thread-pool callback — runs on worker threads, one task per
// `ServerComponentParseTask` (heap-allocated, scheduled exactly once). Writes:
// own fields + `Log` (local) + result is posted via
// `ctx.loop_.enqueue_task_concurrent` (MPSC). Reads `ctx: &BundleV2` shared.
// `ServerComponentParseTask` is `Send` because `ctx: *mut BundleV2` is a
// backref to a `Send` type and `Source`/`Data` payloads are bundle-arena
// slices.
fn task_callback_wrap(thread_pool_task: *mut ThreadPoolTask) {
    // SAFETY: `thread_pool_task` points to the `task` field of a heap-allocated
    // `ServerComponentParseTask` enqueued by BundleV2; offset_of recovers the parent.
    let task: &mut ServerComponentParseTask = unsafe {
        &mut *(bun_core::from_field_ptr!(ServerComponentParseTask, task, thread_pool_task))
    };

    // `ctx` is a `ParentRef` BACKREF to the owning BundleV2 (set at enqueue).
    let ctx = task
        .ctx
        .expect("ServerComponentParseTask.ctx set at enqueue");
    let worker = Worker::get(ctx.get());
    // PORT NOTE: `defer worker.unget()` — handled at end of fn (no early returns).
    let mut log = Log::new();

    // SAFETY: `worker.arena` is set in `Worker::create` to point at the
    // worker-owned bump arena; lives for the worker's lifetime.
    let arena: &Arena = worker.arena();

    let value = match task_callback(task, &mut log, arena) {
        Ok(success) => ResultValue::Success(success),
        // Only possible error is OOM; abort like `bun.outOfMemory()`.
        Err(_oom) => bun_core::out_of_memory(),
    };

    let result = Box::new(parse_task::Result {
        // `ctx` already a `ParentRef<BundleV2>` with write provenance
        // (constructed from `NonNull::from(&mut self)` in `bundle_v2.rs`).
        ctx,
        // SAFETY: Zig leaves `.task = undefined`; consumer overwrites before read.
        task: Default::default(),
        value,
        external: ExternalFreeFunction::NONE,
        watcher_data: WatcherData::NONE,
    });
    let result = bun_core::heap::into_raw(result);

    // Zig matched `worker.ctx.loop().*` on `AnyEventLoop::{js, mini}`.
    // `worker.ctx` is a `BackRef<BundleV2>` (safe `Deref`); the BACKREF deref
    // of `linker.r#loop` is centralised in `LinkerContext::any_loop_mut`.
    //
    // Zig `worker.ctx.loop().*` is non-optional (.zig:52) — `BundleV2::init`
    // always sets `linker.r#loop` before scheduling any ServerComponentParseTask.
    // Running `on_complete` inline on the worker thread would violate
    // `BundleV2::on_parse_task_complete`'s threading contract (it mutates the
    // bundler graph, which is owned by the main/bundler thread).
    match worker
        .ctx
        .linker
        .any_loop_mut()
        .expect("BundleV2.linker.loop must be set before scheduling ServerComponentParseTask")
    {
        bun_event_loop::AnyEventLoop::Js { owner } => {
            owner.enqueue_task_concurrent(
                bun_event_loop::ConcurrentTask::ConcurrentTask::from_callback(result, |p| {
                    on_complete(p);
                    Ok(())
                }),
            );
        }
        bun_event_loop::AnyEventLoop::Mini(mini) => {
            mini.enqueue_task_concurrent_with_extra_ctx::<parse_task::Result, BundleV2<'static>>(
                result,
                on_complete_mini,
                offset_of!(parse_task::Result, task),
            );
        }
    }
    // Zig: `defer worker.unget()` — runs at function exit, i.e. after enqueue.
    worker.unget();
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
    // `ctx` is a `ParentRef` BACKREF to the owning BundleV2; safe `Deref`.
    let ctx: &BundleV2 = task
        .ctx
        .as_deref()
        .expect("ServerComponentParseTask.ctx set at enqueue");
    // PORT NOTE: `Source` is not `Clone`; the original is consumed here
    // (Zig copied by value). Take it up-front so `ab`'s borrow of it ends
    // (via NLL) before we move it into `Success`.
    let source = core::mem::take(&mut task.source);
    let mut ab = AstBuilder::init(bump, &source, ctx.transpiler().options.hot_module_reloading)?;

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
    let mut bundled_ast: JSAst = ab.to_bundled_ast(target)?;

    // `wrapper_ref` is used to hold the HMR api ref (see comment in
    // `src/ast/Ast.zig`)
    bundled_ast.wrapper_ref = hmr_api_ref;

    Ok(Success {
        ast: bundled_ast,
        source,
        loader: Loader::Js,
        log: core::mem::take(log),
        use_directive: UseDirective::None,
        side_effects: bun_ast::SideEffects::NoSideEffectsPureData,
        unique_key_for_additional_file: bun_ast::StoreStr::EMPTY,
        content_hash_for_additional_file: 0,
        package_name: bun_ast::StoreStr::EMPTY,
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
            data: Data::ClientEntryWrapper(ClientEntryWrapper {
                path: Box::default(),
            }),
            ctx: None,
            source: Source::default(),
        }
    }
}

fn generate_client_entry_wrapper(data: &ClientEntryWrapper, b: &mut AstBuilder) -> Result<(), OOM> {
    // `add_import_record` stores the slice raw in the `ImportRecord`; `data.path`
    // outlives the bundle pass (owned by the heap-allocated task). Route through
    // `StoreStr` so the lifetime erasure goes through one audited unsafe.
    let path = bun_ast::StoreStr::new(&data.path[..]);
    let record = b.add_import_record(path.slice(), ImportKind::Stmt)?;
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

    // `add_import_stmt` stores the slices raw in `ImportRecord`/`ClauseItem`s;
    // the framework config outlives the bundle pass. Route through `StoreStr`
    // so the lifetime erasure goes through one audited unsafe.
    let runtime_import = bun_ast::StoreStr::new(&server_components.server_runtime_import[..]);
    let register_ref =
        bun_ast::StoreStr::new(&server_components.server_register_client_reference[..]);
    let register_client_reference =
        b.add_import_stmt(runtime_import.slice(), [register_ref.slice()])?[0];

    let module_path = b.new_expr(E::String::init(
        // In development, the path loaded is the source file: Easy!
        //
        // In production, the path here must be the final chunk path, but
        // that information is not yet available since chunks are not
        // computed. The unique_key replacement system is used here.
        if ctx.transpiler().options.has_dev_server() {
            b.bump.alloc_slice_copy(data.other_source.path.pretty)
        } else {
            // PERF(port): was arena allocPrint — profile in Phase B
            let mut buf = bun_alloc::ArenaString::new_in(b.bump);
            write!(
                &mut buf,
                "{}",
                crate::chunk::UniqueKey {
                    prefix: ctx.unique_key,
                    kind: crate::chunk::QueryKind::Scb,
                    index: data.other_source.index.0,
                },
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
            let mut buf = bun_alloc::ArenaString::new_in(b.bump);
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
            args: bun_ast::ExprNodeList::from_slice(&[b.new_expr(E::String::init(err_msg_string))]),
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
                        stmts: bun_ast::StoreSlice::new_mut(arrow_body_stmts),
                        loc: Loc::EMPTY,
                    },
                    ..Default::default()
                }),
                module_path,
                b.new_expr(E::String::init(b.bump.alloc_slice_copy(key))),
            ]),
            ..Default::default()
        });

        if is_default {
            let ref_ = b.new_symbol(symbol::Kind::Other, b"default")?;
            // export default registerClientReference(...);
            b.append_stmt(S::ExportDefault {
                value: StmtOrExpr::Expr(value),
                default_name: LocRef {
                    loc: Loc::EMPTY,
                    ref_: Some(ref_),
                },
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
                }]),
                is_export: true,
                kind: S::Kind::KConst,
                ..Default::default()
            })?;
        }
    }

    Ok(())
}

// ported from: src/bundler/ServerComponentParseTask.zig
