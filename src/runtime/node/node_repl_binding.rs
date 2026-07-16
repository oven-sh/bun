//! Native helpers for the ported `node:repl`. These replace the vendored
//! acorn parser: the REPL only needs a syntax pass with error position, and
//! Bun's own `bun_js_parser` already provides that.

use bun_alloc::Arena;
use bun_ast::{Kind as MsgKind, Log, Source};
use bun_core::{String as BunString, ZigString};
use bun_js_parser::{Parser, ParserOptions};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc as _};

/// `checkSyntax(code)`: `null` on success, else `{message, atEOF, tokenStart}`
/// for the first parse error. `internal/repl/native-parse.js` classifies
/// recoverability from those.
#[bun_jsc::host_fn]
pub(crate) fn check_syntax(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let code_arg = frame.argument(0);
    if !code_arg.is_string() {
        return Err(global.throw_invalid_argument_type("checkSyntax", "code", "string"));
    }
    let code_holder = code_arg.to_slice(global)?;
    let code = code_holder.slice();

    let vm = global.bun_vm();
    let arena = Arena::new();
    let mut log = Log::init();

    // Plain JS, no repl_mode: this is a syntax check only, not the transform.
    let mut opts = ParserOptions::init(vm.transpiler.options.jsx.clone(), bun_ast::Loader::Js);
    opts.features.dead_code_elimination = false;
    opts.features.top_level_await = true;

    let source = Source::init_path_string(b"[repl]", code);

    let parsed_ok = match Parser::init(
        opts,
        &mut log,
        &source,
        &vm.transpiler.options.define,
        &arena,
    ) {
        Ok(parser) => parser.parse().is_ok(),
        Err(_) => false,
    };

    if parsed_ok && log.errors == 0 {
        return Ok(JSValue::NULL);
    }

    // First error message + byte offset. `tokenStart` is the first char at
    // `offset` so JS doesn't need to convert the byte index to UTF-16.
    // A failure with no logged message (or no location) tells us nothing about
    // where the input ran out, so report `atEOF: false`: an unknown parse error
    // must not be classified as recoverable, or the REPL waits for more input
    // on a line that can never compile.
    let (text, offset) = log
        .msgs
        .iter()
        .find(|m| m.kind == MsgKind::Err)
        .map(|m| {
            (
                m.data.text.as_ref(),
                m.data.location.as_ref().map(|l| l.offset),
            )
        })
        .unwrap_or((b"Syntax Error".as_slice(), None));

    let at_eof = offset.is_some_and(|off| off >= code.len());
    let token_start: &[u8] = match offset {
        Some(off) if off < code.len() => {
            let rest = &code[off..];
            let n = bun_core::strings::wtf8_byte_sequence_length(rest[0]) as usize;
            &rest[..n.min(rest.len())]
        }
        _ => b"",
    };

    let obj = JSValue::create_empty_object(global, 3);
    let mut msg = BunString::clone_utf8(text);
    obj.put(
        global,
        ZigString::static_(b"message"),
        msg.transfer_to_js(global)?,
    );
    obj.put(
        global,
        ZigString::static_(b"atEOF"),
        JSValue::js_boolean(at_eof),
    );
    let mut ts = BunString::clone_utf8(token_start);
    obj.put(
        global,
        ZigString::static_(b"tokenStart"),
        ts.transfer_to_js(global)?,
    );
    Ok(obj)
}
