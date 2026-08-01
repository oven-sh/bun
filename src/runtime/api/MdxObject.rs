//! `Bun.mdx` — compile MDX source to a JSX module via `bun_md::mdx`.

use crate::api::MarkdownObject::{PinnedView, parser_err_to_js};
use crate::node::StringOrBuffer;
use bun_core::OwnedString;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_md::mdx;
use bun_md::root as md;

pub(crate) fn create(global_this: &JSGlobalObject) -> JSValue {
    bun_jsc::create_host_function_object(global_this, &[("compile", __jsc_host_compile, 2)])
}

/// `Bun.mdx.compile(source, options?)` — returns the compiled JSX module as a
/// string. `options` accepts every `Bun.markdown` boolean parser option plus
/// `jsxImportSource` (default `"react"`).
#[bun_jsc::host_fn]
fn compile(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let [input_value, opts_value] = callframe.arguments_as_array::<2>();

    if input_value.is_empty_or_undefined_or_null() {
        return Err(global_this
            .throw_invalid_arguments(format_args!("Expected a string or buffer to compile")));
    }

    let Some(buffer) = StringOrBuffer::from_js(global_this, input_value)? else {
        return Err(global_this
            .throw_invalid_arguments(format_args!("Expected a string or buffer to compile")));
    };

    let pinned = PinnedView::pin(global_this, &buffer)?;
    let input: &[u8] = match &pinned {
        Some(p) => p.slice(),
        None => buffer.slice(),
    };

    let defaults = mdx::MdxOptions::default();
    let mut md_options = defaults.md_options;
    // Owns the bytes `options.jsx_import_source` borrows.
    let jsx_import_source = parse_options(global_this, opts_value, &mut md_options)?;

    let options = mdx::MdxOptions {
        jsx_import_source: match &jsx_import_source {
            Some(v) => v.as_slice(),
            None => defaults.jsx_import_source,
        },
        md_options,
    };

    let result = match mdx::compile(input, &options) {
        Ok(r) => r,
        Err(err) => return Err(mdx_err_to_js(global_this, err, input.len())),
    };

    bun_jsc::bun_string_jsc::create_utf8_for_js(global_this, &result)
}

/// Reads the boolean parser options (camelCase preferred, snake_case accepted)
/// and `jsxImportSource`, returning the latter's owned bytes when present.
fn parse_options(
    global_this: &JSGlobalObject,
    opts_value: JSValue,
    md_options: &mut md::Options,
) -> JsResult<Option<Vec<u8>>> {
    if !opts_value.is_object() {
        return Ok(None);
    }

    for (snake, camel, set) in md::Options::BOOL_FIELD_SETTERS {
        if let Some(val) = opts_value.get_boolean_loose(global_this, camel)? {
            set(md_options, val);
        } else if *camel != *snake {
            if let Some(val) = opts_value.get_boolean_loose(global_this, snake)? {
                set(md_options, val);
            }
        }
    }

    if let Some(import_source) = opts_value.get_stringish(global_this, "jsxImportSource")? {
        let owned = OwnedString::new(import_source);
        let utf8 = owned.to_utf8();
        return Ok(Some(utf8.slice().to_vec()));
    }

    Ok(None)
}

#[cold]
fn mdx_err_to_js(
    global_this: &JSGlobalObject,
    err: mdx::MdxError,
    input_len: usize,
) -> bun_jsc::JsError {
    match err {
        mdx::MdxError::OutOfMemory => global_this.throw_out_of_memory(),
        // Propagates a pending JS exception, stack overflow, or input-size
        // range error unchanged.
        mdx::MdxError::Parser(err) => parser_err_to_js(global_this, err, input_len),
        other => {
            let name: &'static str = (&other).into();
            global_this.throw_value(
                global_this.create_syntax_error_instance(format_args!("MDX compile error: {name}")),
            )
        }
    }
}
