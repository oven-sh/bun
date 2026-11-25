use bun_ast::{E, Expr, ExprData, ExprNodeList, G, ToJSError};
use bun_ast::{Loc, Log, Range, Source};
use bun_bundler::Transpiler;
use bun_collections::VecExt;
use bun_core::strings;
use bun_js_parser::Macro::{MacroContext, Macros, NAMESPACE_WITH_COLON};
use bun_jsc::macro_host::{CopiedValue, Failure, MacroHost, Node, VmOptions};
use bun_jsc::{JSGlobalObject, ModuleLoader, ProtectedJSValue};

use crate::Error;
use crate::expr_jsc::{ExprJsc, js_err};

bun_core::declare_scope!(Macro, visible);

struct Arguments<'a> {
    exprs: &'a [Expr],
    context: Option<&'a CopiedValue>,
}

// SAFETY: `to_js` only reads the AST, and the parser that owns it sleeps while another thread has this.
unsafe impl Sync for Arguments<'_> {}

impl Arguments<'_> {
    fn to_js(&self, global: &JSGlobalObject) -> Result<Vec<ProtectedJSValue>, ToJSError> {
        let exprs = self.exprs.iter().map(|expr| expr.to_js(global));
        let context = (self.context.iter()).map(|it| (it.to_js)(&it.bytes, global).map_err(js_err));
        exprs
            .chain(context)
            .map(|value| Ok(value?.protected()))
            .collect()
    }
}

fn call_macro(
    ctx: MacroContext<'_>,
    bump: &bun_alloc::Arena,
    import_record_path: &[u8],
    source_dir: &[u8],
    log: &mut Log,
    source: &Source,
    import_range: Range,
    caller: Expr,
    function_name: &[u8],
) -> crate::Result<Expr> {
    let (thread, context) = match ctx.macros {
        Macros::Defer(deferred) => {
            deferred.set(true);
            return Err(Error::MacroFailed);
        }
        Macros::Run { thread, context } => (thread, context),
    };
    let host = MacroHost::of(thread);
    if let Some(refusal) = host.refusal() {
        log.add_range_error(Some(source), import_range, refusal.as_bytes());
        return Err(Error::MacroFailed);
    }
    let import_record_path_without_macro_prefix = import_record_path
        .strip_prefix(NAMESPACE_WITH_COLON)
        .unwrap_or(import_record_path);

    let transpiler = ctx.transpiler().cast::<Transpiler<'_>>();

    let input_specifier: &[u8] = 'brk: {
        if let Some(replacement) = ModuleLoader::HardcodedModule::Alias::get(
            import_record_path,
            bun_ast::Target::Bun,
            Default::default(),
        ) {
            break 'brk replacement.path.as_bytes();
        }

        // SAFETY: the contract of `MacroContext::new`.
        let resolver = unsafe { &mut (*transpiler).resolver };
        let resolve_result = match resolver.resolve(
            source_dir,
            import_record_path_without_macro_prefix,
            bun_ast::ImportKind::Stmt,
        ) {
            Ok(r) => r,
            Err(bun_resolver::Error::ModuleNotFound) => {
                log.add_resolve_error(
                    Some(source),
                    import_range,
                    format_args!(
                        "Macro \"{}\" not found",
                        bstr::BStr::new(import_record_path)
                    ),
                    import_record_path,
                    bun_ast::ImportKind::Stmt,
                    bun_ast::Error::ModuleNotFound,
                );
                return Err(Error::MacroNotFound);
            }
            Err(e) => {
                log.add_range_error_fmt(
                    Some(source),
                    import_range,
                    format_args!(
                        "{} resolving macro \"{}\"",
                        e.name(),
                        bstr::BStr::new(import_record_path)
                    ),
                );
                return Err(e.into());
            }
        };
        break 'brk resolve_result.path_pair.primary.text;
    };

    let ExprData::ECall(call) = &caller.data else {
        log.add_error(
            Some(source),
            caller.loc,
            b"template literal macro invocations are not supported",
        );
        return Err(Error::MacroFailed);
    };

    bun_core::scoped_log!(Macro, "call {}", bstr::BStr::new(function_name));
    bun_core::Output::flush();

    let arguments = Arguments {
        exprs: call.args.slice(),
        context: context.map(|it| it.downcast_ref().expect("a CopiedValue")),
    };
    let build_options = || {
        // SAFETY: the contract of `MacroContext::new`.
        let transpiler = unsafe { &*transpiler };
        let mut transform_options = (*transpiler.options.transform_options).clone();
        // These are about the output of the build. What the macro imports has to resolve.
        transform_options.external = Vec::new();
        transform_options.packages = None;
        VmOptions {
            transform_options,
            env: bun_core::handle_oom(transpiler.env().clone_loaded()),
            watcher: transpiler.resolver.watcher.clone(),
        }
    };
    let answer = host.call(
        input_specifier,
        function_name,
        &|global| arguments.to_js(global),
        &build_options,
    );
    match answer {
        Ok(nodes) => expr_from_nodes(&nodes, bump, log, caller.loc),
        Err(Failure::Threw) => Err(Error::MacroFailed),
        Err(Failure::Load) => Err(Error::MacroLoadError),
        Err(Failure::Arguments(err)) => Err(err.into()),
        Err(Failure::Message(text)) => {
            log.add_error(Some(source), caller.loc, text.into_vec());
            Err(Error::MacroFailed)
        }
    }
}

// `bun_js_parser` cannot name `Transpiler` or JSC types, so it calls this, which is resolved at link time.
#[unsafe(no_mangle)]
fn __bun_macro_context_call(
    ctx: MacroContext<'_>,
    bump: &bun_alloc::Arena,
    import_record_path: &[u8],
    source_dir: &[u8],
    log: &mut Log,
    source: &Source,
    import_range: Range,
    caller: Expr,
    function_name: &[u8],
) -> Result<Expr, bun_js_parser::Error> {
    // ABI: the `extern "Rust"` declaration in bun_js_parser names
    // `bun_js_parser::Error`; keep both sides byte-identical.
    let caller_loc = caller.loc;
    call_macro(
        ctx,
        bump,
        import_record_path,
        source_dir,
        log,
        source,
        import_range,
        caller,
        function_name,
    )
    .map_err(|e| {
        // visit_expr only prints a fallback "macro threw exception" when
        // nothing was added to the log; record the specific cause here so
        // errors like ToJSError's "Cannot convert argument type to JS"
        // reach the user (03830.test.ts snapshot asserts on this).
        if e.name() != "MacroFailed" {
            log.add_error_fmt(
                Some(source),
                caller_loc,
                format_args!("\"{}\" error in macro", e.name()),
            );
        }
        bun_js_parser::Error::MacroFailed
    })
}

/// Containers are filled once every node has its `Expr`, because they can form cycles.
fn expr_from_nodes(
    nodes: &[Node],
    bump: &bun_alloc::Arena,
    log: &mut Log,
    loc: Loc,
) -> crate::Result<Expr> {
    let mut exprs = Vec::with_capacity(nodes.len());
    for node in nodes {
        exprs.push(match node {
            Node::Undefined => Expr::init(E::Undefined {}, loc),
            Node::Null => Expr::init(E::Null {}, loc),
            &Node::Boolean(value) => Expr::init(E::Boolean { value }, loc),
            &Node::Number(value) => Expr::init(E::Number::new(value), loc),
            // As UTF-16, the printer escapes it correctly.
            Node::String(text) => {
                Expr::init(E::EString::init_utf16(bump.alloc_slice_copy(text)), loc)
            }
            Node::Array(_) => Expr::init(
                E::Array {
                    items: bun_alloc::AstAlloc::vec(),
                    was_originally_macro: true,
                    ..Default::default()
                },
                loc,
            ),
            Node::Object(_) => Expr::init(
                E::Object {
                    properties: bun_alloc::AstAlloc::vec(),
                    was_originally_macro: true,
                    ..Default::default()
                },
                loc,
            ),
            Node::Blob {
                bytes,
                content_type,
            } => expr_from_blob(bytes, bump, content_type, log, loc)
                .map_err(|_| Error::MacroFailed)?,
        });
    }

    for (node, expr) in nodes.iter().zip(&exprs) {
        match (node, expr.data) {
            (Node::Array(items), ExprData::EArray(mut array)) => {
                array.items = ExprNodeList::init_capacity(items.len());
                for &item in items {
                    VecExt::append(&mut array.items, exprs[item as usize]);
                }
            }
            (Node::Object(properties), ExprData::EObject(mut object)) => {
                object.properties = G::PropertyList::init_capacity(properties.len());
                for (key, value) in properties {
                    let key = Expr::init(E::EString::init(bump.alloc_slice_copy(key)), loc);
                    VecExt::append(
                        &mut object.properties,
                        G::Property {
                            flags: E::own_key_property_flags(&key),
                            key: Some(key),
                            value: Some(exprs[*value as usize]),
                            ..Default::default()
                        },
                    );
                }
            }
            _ => {}
        }
    }
    Ok(exprs[0])
}

/// Lives here, not on `bun_ast::Expr`, because it parses JSON via `bun_parsers`
/// — `bun_ast` is a
/// leaf below both.
fn expr_from_blob(
    bytes: &[u8],
    bump: &bun_alloc::Arena,
    content_type: &[u8],
    log: &mut Log,
    loc: bun_ast::Loc,
) -> crate::Result<Expr> {
    use bun_ast::{E, ExprData, StoreStr as Str};

    // MIME essence: `type/subtype` with the parameters cut off.
    let essence: &[u8] = match strings::index_of_char_usize(content_type, b';') {
        Some(semicolon) => &content_type[..semicolon],
        None => content_type,
    }
    .trim_ascii();

    // `+json` is the RFC 6839 structured syntax suffix: `application/ld+json`.
    let is_json = essence.ends_with(b"/json") || essence.ends_with(b"+json");

    if is_json {
        let mut out_expr: Expr = match bun_parsers::json::parse_for_macro(bytes, log, bump) {
            Ok(e) => e,
            Err(_) => return Err(crate::Error::MacroFailed),
        };
        out_expr.loc = loc;
        match &mut out_expr.data {
            ExprData::EObject(obj) => obj.was_originally_macro = true,
            ExprData::EArray(arr) => arr.was_originally_macro = true,
            _ => {}
        }
        return Ok(out_expr);
    }

    let is_text_like = essence.starts_with(b"text/")
        || matches!(
            essence,
            b"application/javascript"
                | b"application/x-javascript"
                | b"application/ecmascript"
                | b"application/xml"
        );

    if is_text_like {
        let mut output = bun_core::MutableString::init_empty();
        bun_core::quote_for_json(bytes, &mut output, true)?;
        let owned = output.to_owned_slice();
        // strip the surrounding quotes; copy into the bump arena so the
        // `E.String` data outlives `owned`.
        let unquoted: &[u8] = if owned.len() >= 2 {
            &owned[1..owned.len() - 1]
        } else {
            &owned[..]
        };
        let data = Str::new(bump.alloc_slice_copy(unquoted));
        return Ok(Expr::init(
            E::String {
                data,
                ..Default::default()
            },
            loc,
        ));
    }

    // Fallback: base64 data URL.
    let prefix = b"data:";
    let mid = b";base64,";
    let encoded_len = bun_base64::encode_len(bytes);
    let total = prefix.len() + content_type.len() + mid.len() + encoded_len;
    let buf: &mut [u8] = bump.alloc_slice_fill_copy(total, 0u8);
    let mut i = 0usize;
    buf[i..i + prefix.len()].copy_from_slice(prefix);
    i += prefix.len();
    buf[i..i + content_type.len()].copy_from_slice(content_type);
    i += content_type.len();
    buf[i..i + mid.len()].copy_from_slice(mid);
    i += mid.len();
    let n = bun_base64::encode(&mut buf[i..], bytes);
    let data = Str::new(&buf[..i + n]);
    Ok(Expr::init(
        E::String {
            data,
            ..Default::default()
        },
        loc,
    ))
}
