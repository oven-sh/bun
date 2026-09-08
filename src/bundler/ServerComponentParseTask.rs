//! Files for Server Components are generated using `AstBuilder`, instead of
//! running through the js_parser. It emits a ParseTask.Result and joins
//! with the same logic that it runs though.

use std::fmt::Write as _;

use bun_alloc::{AllocError as OOM, Arena}; // bumpalo::Bump re-export
use bun_collections::VecExt;

use bun_ast::{Loc, Log, Source};

use bun_ast::ast_result::NamedExports;
use bun_ast::{B, Binding, E, G, S, Stmt, symbol};
use bun_ast::{ExprNodeList, LocRef, StmtOrExpr, UseDirective};
use bun_ast::{ImportKind, ImportRecordFlags};

use crate::AstBuilder::AstBuilder;
use crate::JSAst;
use crate::bundle_v2::ParseShared;
use crate::cache::ExternalFreeFunction;
use crate::options::{Loader, Target};
use crate::parse_task::{self, ResultValue, Success, WatcherData};

pub(crate) struct ServerComponentParseTask<'a> {
    pub task: bun_threading::GroupedTask,
    pub data: Data,
    pub ctx: std::sync::Arc<ParseShared<'a>>,
    pub source: Source,
}

bun_core::intrusive_field!(['a] ServerComponentParseTask<'a>, task: bun_threading::GroupedTask);
impl bun_threading::GroupTask for ServerComponentParseTask<'_> {
    #[inline]
    fn run(self: Box<Self>) {
        Self::run_task(self);
    }
}

#[allow(clippy::large_enum_variant)]
pub enum Data {
    /// Generate server-side code for a "use client" module. Given the
    /// client ast, a "reference proxy" is created with identical exports.
    ClientReferenceProxy(ReferenceProxy),

    ClientEntryWrapper(ClientEntryWrapper),
}

pub struct ReferenceProxy {
    pub(crate) other_source: Source,
    pub(crate) named_exports: NamedExports,
}

pub struct ClientEntryWrapper {
    // Owned copy.
    pub(crate) path: Box<[u8]>,
}

impl<'a> ServerComponentParseTask<'a> {
    /// Worker-thread entry point (see [`bun_threading::GroupTask`]): build the
    /// AST, then hand the result to the bundle thread.
    fn run_task(mut self: Box<Self>) {
        let ctx = std::sync::Arc::clone(&self.ctx);
        let ctx: &ParseShared<'a> = &ctx;
        let worker = ctx.pool.get_worker();
        let mut log = Log::new();
        let arena: &'a Arena = worker.arena();

        let value = match task_callback(&mut self, &mut log, arena) {
            Ok(success) => ResultValue::Success(success),
            // Only possible error is OOM; abort like `bun.outOfMemory()`.
            Err(_oom) => bun_core::out_of_memory(),
        };

        // After the send: `on_parse_task_complete` mutates the graph on the
        // bundle thread.
        ctx.inbox
            .push(crate::inbox::Incoming::ParseTask(parse_task::Result {
                parse_task: None,
                value,
                external: ExternalFreeFunction::NONE,
                watcher_data: WatcherData::NONE,
            }));
        drop(worker);
    }
}

fn task_callback<'a>(
    task: &mut ServerComponentParseTask<'a>,
    log: &mut Log,
    bump: &'a Arena,
) -> Result<Success<'a>, OOM> {
    let ctx = std::sync::Arc::clone(&task.ctx);
    let ctx: &ParseShared<'a> = &ctx;
    let options = &ctx.pool.seed().options;
    // `Source` is not `Clone`; the original is consumed here.
    // Take it up-front so `ab`'s borrow of it ends
    // (via NLL) before we move it into `Success`.
    let source = core::mem::take(&mut task.source);
    let mut ab = AstBuilder::init(bump, &source, options.hot_module_reloading)?;

    match &task.data {
        Data::ClientReferenceProxy(data) => generate_client_reference_proxy(ctx, data, &mut ab)?,
        Data::ClientEntryWrapper(data) => generate_client_entry_wrapper(data, bump, &mut ab)?,
    }

    let target = match &task.data {
        // Server-side
        Data::ClientReferenceProxy(_) => options.target,
        // Client-side,
        Data::ClientEntryWrapper(_) => Target::Browser,
    };
    let hmr_api_ref = ab.hmr_api_ref;
    let mut bundled_ast: JSAst<'a> = ab.to_bundled_ast(target)?;

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

fn generate_client_entry_wrapper<'a>(
    data: &ClientEntryWrapper,
    bump: &'a Arena,
    b: &mut AstBuilder<'a, '_>,
) -> Result<(), OOM> {
    // `add_import_record` stores the slice in the `ImportRecord`; copy it into
    // the worker arena so it lives as long as the AST.
    let record = b.add_import_record(
        bun_ast::StoreStr::new(bump.alloc_slice_copy(&data.path)).slice(),
        ImportKind::Stmt,
    )?;
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
    ctx: &ParseShared,
    data: &ReferenceProxy,
    b: &mut AstBuilder,
) -> Result<(), OOM> {
    let options = &ctx.pool.seed().options;
    let server_components = options
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
        if options.has_dev_server() {
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

    for key in client_named_exports.keys() {
        let key: &[u8] = key.as_ref();
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
