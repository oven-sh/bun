//! Files for Server Components are generated using `AstBuilder`, instead of
//! running through the js_parser. It emits a ParseTask.Result and joins
//! with the same logic that it runs though.

use core::mem::offset_of;
use std::io::Write as _;

use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_collections::BabyList;
use bun_core::fmt as bun_fmt;

use bun_logger::{self as logger, Loc, Log, Source};
use bun_threading::ThreadPool as ThreadPoolLib;

use bun_js_parser::ast::{
    self as js_ast, Binding, BundledAst as JSAst, Expr, ExprNodeList, Stmt, B, E, G, S,
};

use crate::bundle_v2::{AstBuilder, BundleV2};
use crate::options;

pub use bun_js_parser::ast::{Index, Ref};
pub use crate::bundle_v2::{DeferredBatchTask, ParseTask, ThreadPool};
// TODO(port): the Zig re-exports `DeferredBatchTask`, `ThreadPool`, `ParseTask`, `Ref`, `Index`
// publicly from this module; verify whether downstream callers depend on these being re-exported
// here vs. importing from bundle_v2 directly. Phase B may delete the re-exports.

pub struct ServerComponentParseTask<'a> {
    pub task: ThreadPoolLib::Task,
    pub data: Data,
    pub ctx: &'a BundleV2,
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
    pub named_exports: JSAst::NamedExports,
}

pub struct ClientEntryWrapper {
    // TODO(port): lifetime — Zig `[]const u8` borrowed from caller; never freed in this file.
    pub path: Box<[u8]>,
}

/// Raw thread-pool callback. Recovers `&mut ServerComponentParseTask` from the
/// intrusive `task` field and dispatches the parse, then posts the result back
/// to the owning event loop.
fn task_callback_wrap(thread_pool_task: *mut ThreadPoolLib::Task) {
    // SAFETY: `thread_pool_task` points to the `task` field of a heap-allocated
    // `ServerComponentParseTask` enqueued by BundleV2; offset_of recovers the parent.
    let task: &mut ServerComponentParseTask = unsafe {
        &mut *(thread_pool_task
            .cast::<u8>()
            .sub(offset_of!(ServerComponentParseTask, task))
            .cast::<ServerComponentParseTask>())
    };

    // `Worker::get` returns an RAII guard; `unget` happens on Drop.
    let worker = ThreadPool::Worker::get(task.ctx);
    let mut log = Log::new(worker.allocator());

    let value = match task_callback(task, &mut log, worker.allocator()) {
        Ok(success) => ParseTask::result::Value::Success(success),
        // Only possible error is OOM; abort like `bun.outOfMemory()`.
        Err(_oom) => bun_core::out_of_memory(),
    };

    let result = Box::into_raw(Box::new(ParseTask::Result {
        ctx: task.ctx,
        // SAFETY: Zig leaves `.task = undefined`; consumer overwrites before read;
        // ThreadPoolLib::Task is POD with no NonNull/NonZero fields.
        task: unsafe { core::mem::zeroed() },
        value,
        watcher_data: ParseTask::result::WatcherData::NONE,
    }));

    match worker.ctx.event_loop() {
        bun_jsc::EventLoopHandle::Js(jsc_event_loop) => {
            jsc_event_loop.enqueue_task_concurrent(ConcurrentTask::from_callback(
                result,
                ParseTask::on_complete,
            ));
        }
        bun_jsc::EventLoopHandle::Mini(mini) => {
            mini.enqueue_task_concurrent_with_extra_ctx::<ParseTask::Result, BundleV2>(
                result,
                BundleV2::on_parse_task_complete,
                // TODO(port): Zig passes `.task` as the intrusive-field selector;
                // Rust side likely encodes this via offset_of! inside the helper.
                offset_of!(ParseTask::Result, task),
            );
        }
    }
}

fn task_callback<'bump>(
    task: &mut ServerComponentParseTask,
    log: &mut Log,
    bump: &'bump Arena,
) -> Result<ParseTask::result::Success, bun_alloc::AllocError> {
    let mut ab = AstBuilder::init(
        bump,
        &task.source,
        task.ctx.transpiler.options.hot_module_reloading,
    )?;

    match &task.data {
        Data::ClientReferenceProxy(data) => task.generate_client_reference_proxy(data, &mut ab)?,
        Data::ClientEntryWrapper(data) => task.generate_client_entry_wrapper(data, &mut ab)?,
    }

    let mut bundled_ast = ab.to_bundled_ast(match &task.data {
        // Server-side
        Data::ClientReferenceProxy(_) => task.ctx.transpiler.options.target,
        // Client-side,
        Data::ClientEntryWrapper(_) => options::Target::Browser,
    })?;

    // `wrapper_ref` is used to hold the HMR api ref (see comment in
    // `src/ast/Ast.zig`)
    bundled_ast.wrapper_ref = ab.hmr_api_ref;

    Ok(ParseTask::result::Success {
        ast: bundled_ast,
        source: task.source.clone(),
        loader: options::Loader::Js,
        log: core::mem::take(log),
        use_directive: js_ast::UseDirective::None,
        side_effects: js_ast::SideEffects::NoSideEffectsPureData,
    })
}

impl<'a> ServerComponentParseTask<'a> {
    /// Expose the thread-pool callback so callers can construct
    /// `ThreadPoolLib::Task { callback: Self::TASK_CALLBACK }`.
    pub const TASK_CALLBACK: fn(*mut ThreadPoolLib::Task) = task_callback_wrap;

    fn generate_client_entry_wrapper(
        &self,
        data: &ClientEntryWrapper,
        b: &mut AstBuilder,
    ) -> Result<(), bun_alloc::AllocError> {
        // TODO(port): narrow error set
        let record = b.add_import_record(&data.path, bun_options_types::ImportKind::Stmt)?;
        let namespace_ref = b.new_symbol(js_ast::SymbolKind::Other, b"main")?;
        b.append_stmt(S::Import {
            namespace_ref,
            import_record_index: record,
            items: &[],
            is_single_line: true,
        })?;
        b.import_records.as_mut_slice()[record as usize]
            .flags
            .was_originally_bare_import = true;
        Ok(())
    }

    fn generate_client_reference_proxy(
        &self,
        data: &ReferenceProxy,
        b: &mut AstBuilder,
    ) -> Result<(), bun_alloc::AllocError> {
        // TODO(port): narrow error set
        let server_components = self
            .ctx
            .framework
            .as_ref()
            .unwrap()
            .server_components
            .as_ref()
            // config must be non-null to enter this function
            .unwrap_or_else(|| unreachable!());

        let client_named_exports = &data.named_exports;

        let register_client_reference = b.add_import_stmt(
            &server_components.server_runtime_import,
            &[&server_components.server_register_client_reference],
        )?[0];

        let module_path = b.new_expr(E::String {
            // In development, the path loaded is the source file: Easy!
            //
            // In production, the path here must be the final chunk path, but
            // that information is not yet available since chunks are not
            // computed. The unique_key replacement system is used here.
            data: if self.ctx.transpiler.options.dev_server.is_some() {
                data.other_source.path.pretty.clone()
            } else {
                // PERF(port): was arena allocPrint — profile in Phase B
                let mut buf = bumpalo::collections::Vec::<u8>::new_in(b.bump);
                write!(
                    &mut buf,
                    "{}S{:08}",
                    bun_fmt::hex_int_lower(self.ctx.unique_key),
                    data.other_source.index.get(),
                )
                .map_err(|_| bun_alloc::AllocError)?;
                buf.into_bump_slice()
            },
        });

        for key in client_named_exports.keys() {
            let is_default = key.as_ref() == b"default";

            // This error message is taken from
            // https://github.com/facebook/react/blob/c5b9375767e2c4102d7e5559d383523736f1c902/packages/react-server-dom-webpack/src/ReactFlightWebpackNodeLoader.js#L323-L354
            let err_msg_string = {
                // PERF(port): was arena allocPrint — profile in Phase B
                let mut buf = bumpalo::collections::Vec::<u8>::new_in(b.bump);
                if is_default {
                    write!(
                        &mut buf,
                        concat!(
                            "Attempted to call the default export of {module_path} from ",
                            "the server, but it's on the client. It's not possible to invoke a ",
                            "client function from the server, it can only be rendered as a ",
                            "Component or passed to props of a Client Component.",
                        ),
                        module_path = bstr::BStr::new(&data.other_source.path.pretty),
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
                .map_err(|_| bun_alloc::AllocError)?;
                buf.into_bump_slice()
            };

            // throw new Error(...)
            let err_msg = b.new_expr(E::New {
                target: b.new_expr(E::Identifier {
                    r#ref: b.new_external_symbol(b"Error")?,
                }),
                args: BabyList::<Expr>::from_slice(
                    b.bump,
                    &[b.new_expr(E::String { data: err_msg_string })],
                )?,
                close_parens_loc: Loc::EMPTY,
            });

            // registerClientReference(
            //   () => { throw new Error(...) },
            //   "src/filepath.tsx",
            //   "Comp"
            // );
            let value = b.new_expr(E::Call {
                target: register_client_reference,
                args: ExprNodeList::from_slice(
                    b.bump,
                    &[
                        b.new_expr(E::Arrow {
                            body: js_ast::FnBody {
                                stmts: b
                                    .bump
                                    .alloc_slice_copy(&[b.new_stmt(S::Throw { value: err_msg })]),
                                loc: Loc::EMPTY,
                            },
                        }),
                        module_path,
                        b.new_expr(E::String { data: key.clone() }),
                    ],
                )?,
            });

            if is_default {
                let r#ref = b.new_symbol(js_ast::SymbolKind::Other, b"default")?;
                // export default registerClientReference(...);
                b.append_stmt(S::ExportDefault {
                    value: js_ast::ExportDefaultValue::Expr(value),
                    default_name: js_ast::LocRef { r#ref },
                })?;
            } else {
                // export const Component = registerClientReference(...);
                let export_ref = b.new_symbol(js_ast::SymbolKind::Other, key)?;
                b.append_stmt(S::Local {
                    decls: G::Decl::List::from_slice(
                        b.bump,
                        &[G::Decl {
                            binding: Binding::alloc(
                                b.bump,
                                B::Identifier { r#ref: export_ref },
                                Loc::EMPTY,
                            ),
                            value: Some(value),
                        }],
                    )?,
                    is_export: true,
                    kind: js_ast::LocalKind::KConst,
                })?;
            }
        }

        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/ServerComponentParseTask.zig (247 lines)
//   confidence: medium
//   todos:      4
//   notes:      AST node struct-init shapes (E::*, S::*, G::Decl) and ParseTask::Result field paths are guessed; intrusive .task field selector for mini.enqueue_task_concurrent_with_extra_ctx needs Phase-B API.
// ──────────────────────────────────────────────────────────────────────────
