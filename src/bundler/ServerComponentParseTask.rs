//! Files for Server Components are generated using `AstBuilder`, instead of
//! running through the js_parser. It emits a ParseTask.Result and joins
//! with the same logic that it runs though.

use core::mem::offset_of;
use std::fmt::Write as _;

use bun_alloc::{AllocError as OOM, Arena}; // bumpalo::Bump re-export
use bun_collections::VecExt;

use bun_ast::{Loc, Log, Source};
use bun_threading::thread_pool::Task as ThreadPoolTask;

use bun_ast::{B, Binding, E, G, S, Stmt, symbol};
use bun_ast::{ExprNodeList, LocRef, StmtOrExpr, UseDirective};

use crate::AstBuilder::AstBuilder;
use crate::JSAst;
use crate::Worker;
use crate::bundle_v2::BundleV2;
use crate::cache::ExternalFreeFunction;
use crate::options::Loader;
use crate::parse_task::{self, ResultValue, Success, WatcherData, on_complete};

/// Generates the server-side "reference proxy" for a "use client" module: a
/// module with the same export names, each bound to a client reference.
///
/// Scheduled by value on the bundle's worker pool
/// (`ThreadPool::schedule_owned`), which hands the `Box` back to
/// [`Self::run_owned`]; the task is dropped there as soon as the proxy's AST
/// has been built, so it must own nothing the AST refers to.
pub(crate) struct ServerComponentParseTask {
    pub task: ThreadPoolTask,
    pub data: ReferenceProxy,
    // BACKREF (LIFETIMES.tsv) — written through in `on_complete`.
    // `ParentRef` (write-provenance via `NonNull::from(&mut self)` at construction)
    // so deref sites are safe.
    pub ctx: bun_ptr::ParentRef<BundleV2<'static>, bun_ptr::Mut>,
    pub source: Source,
}

// Sound to move to a worker thread: `ctx` (the only non-`Send` field) is a
// backref to the bundle, which outlives the task (a bundle finishes only after
// every task it scheduled has reported back through the scan counter) and is
// only read from the worker; the other fields are plain owned data.
bun_threading::owned_task!(ServerComponentParseTask, task);

pub(crate) struct ReferenceProxy {
    /// The "use client" module the proxy stands in for.
    pub(crate) other_source: Source,
    /// Its export names, copied out of the client AST on the bundle thread.
    pub(crate) export_names: Box<[Box<[u8]>]>,
}

impl ServerComponentParseTask {
    // CONCURRENCY: runs on a worker thread, exactly once per task. Writes: own
    // fields + `Log` (local); the result is posted to the bundle thread through
    // its event loop (MPSC). Reads `ctx: &BundleV2` shared.
    fn run_owned(mut self: Box<Self>) {
        let ctx = self.ctx;
        let worker = Worker::get(ctx.get());
        // `defer worker.unget()` — handled at end of fn (no early returns).
        let mut log = Log::new();

        // SAFETY: `worker.arena` is set in `Worker::create` to point at the
        // worker-owned bump arena; lives for the worker's lifetime.
        let arena: &Arena = worker.arena();

        let value = match task_callback(&mut self, &mut log, arena) {
            Ok(success) => ResultValue::Success(success),
            // Only possible error is OOM; abort like `bun.outOfMemory()`.
            Err(_oom) => bun_core::out_of_memory(),
        };
        // The generated AST lives entirely in the worker arena (`task_callback`
        // copies every string it keeps), so nothing refers to the task anymore.
        drop(self);

        let result = Box::new(parse_task::Result {
            // `ctx` already a `ParentRef<BundleV2>` with write provenance
            // (constructed from `NonNull::from(&mut self)` in `bundle_v2.rs`).
            ctx,
            // Placeholder; consumer overwrites before read.
            task: Default::default(),
            value,
            external: ExternalFreeFunction::NONE,
            watcher_data: WatcherData::NONE,
        });
        post_to_bundle_thread(worker, result);
        worker.unget();
    }
}

/// Hands `result` to the bundle thread, which consumes it in `on_complete`.
fn post_to_bundle_thread(worker: &Worker, result: Box<parse_task::Result>) {
    let result = bun_core::heap::into_raw(result);

    // `worker.ctx` is a `BackRef<BundleV2>` (safe `Deref`); the BACKREF deref
    // of `linker.r#loop` is centralised in `LinkerContext::any_loop_mut`.
    //
    // The loop is effectively non-optional — `BundleV2::init`
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
        bun_event_loop::AnyEventLoop::Js { .. } => {
            let ct = bun_event_loop::ConcurrentTask::ConcurrentTask::from_callback(result, |p| {
                // SAFETY: `p` is the `result` Box leaked above; ownership
                // transfers to `on_complete`, which deallocates it.
                unsafe { on_complete(p) };
                Ok(())
            });
            let poster = worker
                .ctx
                .js_poster
                .as_ref()
                .expect("JS-owned bundle has a poster");
            if let bun_event_loop::Posted::Refused(ct) = poster.post(ct) {
                // Owning JS VM torn down mid-bundle: free the hop and the result.
                // SAFETY: refused ⇒ we own the task box and the leaked result.
                unsafe {
                    bun_event_loop::ConcurrentTask::ConcurrentTask::release_refused(ct);
                    drop(bun_core::heap::take(result));
                }
            }
        }
        bun_event_loop::AnyEventLoop::Mini(mini) => {
            // SAFETY: `result` is a freshly Box-leaked `parse_task::Result` (above) and
            // `offset_of!(parse_task::Result, task)` is the intrusive task field within it.
            unsafe {
                mini.enqueue_task_concurrent_with_extra_ctx::<parse_task::Result, BundleV2<'static>>(
                    result,
                    on_complete_mini,
                    offset_of!(parse_task::Result, task),
                );
            }
        }
    }
}

fn on_complete_mini(result: *mut parse_task::Result, _ctx: *mut BundleV2<'static>) {
    // `on_complete` already recovers `ctx` from `result.ctx`.
    // SAFETY: callback contract — `result` is the uniquely-owned Box leaked in
    // `post_to_bundle_thread`; ownership transfers to `on_complete`.
    unsafe { on_complete(result) };
}

/// Builds the proxy's AST in `bump`, the worker arena that outlives the bundle
/// pass. Every byte the AST keeps is copied into `bump`; nothing may point back
/// into `task`, which is dropped as soon as this returns.
fn task_callback(
    task: &mut ServerComponentParseTask,
    log: &mut Log,
    bump: &'static Arena,
) -> Result<Success, OOM> {
    // `ctx` is a `ParentRef` BACKREF to the owning BundleV2; safe `Deref`.
    let ctx: &BundleV2 = &task.ctx;
    // Take the source up-front so `ab`'s borrow of it ends
    // (via NLL) before we move it into `Success`.
    let source = core::mem::take(&mut task.source);
    let mut ab = AstBuilder::init(bump, &source, ctx.transpiler().options.hot_module_reloading)?;

    generate_client_reference_proxy(ctx, &task.data, &mut ab)?;

    let hmr_api_ref = ab.hmr_api_ref;
    // The proxy is server-side code.
    let mut bundled_ast: JSAst = ab.to_bundled_ast(ctx.transpiler().options.target)?;

    // `wrapper_ref` is used to hold the HMR api ref.
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

    for key in &data.export_names {
        // `new_symbol` / `E::String` keep the slice itself, so it has to live
        // in the AST arena, not in the task.
        let key: &[u8] = b.bump.alloc_slice_copy(key);
        let is_default = key == b"default";

        // This error message is taken from
        // https://github.com/facebook/react/blob/c5b9375767e2c4102d7e5559d383523736f1c902/packages/react-server-dom-webpack/src/ReactFlightWebpackNodeLoader.js#L323-L354
        let err_msg_string: &[u8] = {
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
                b.new_expr(E::String::init(key)),
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
                    ref_,
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
