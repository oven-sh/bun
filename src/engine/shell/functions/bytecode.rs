//! Code that is stored as bytes.

use std::path::Path;

use bun_engine_bytecode::cache::Payload;
use bun_engine_text::Text;
use bun_engine_vm::{JsUint8Array, SourceCode, SourceType, Vm};

use super::scripts::evaluate_in;
use super::to_text;
use crate::prelude::*;
use crate::{files, global, run};

pub(super) const FUNCTIONS: Functions = &[
    ("bytecodeCacheFor", bytecode_for, 2),
    (
        "evalTwiceFromTransientBytecodeCache",
        evaluate_twice_from_bytecode,
        1,
    ),
];

fn checksum(bytes: &[u8]) -> [u8; 8] {
    Text::Latin1(bytes).fingerprint().to_le_bytes()
}

/// Makes the code of a file come from the directory of `--diskCachePath`, and puts it there if it is missing.
pub(crate) fn use_disk_cache(vm: &Vm, source: &SourceCode, path: &str) {
    let state = State::of(vm);
    let command_line = state.command_line();
    let Some(directory) = &command_line.disk_cache else {
        return;
    };
    let provider = &source.provider;
    let is_module = provider.source_type() == SourceType::Module;
    let name = Path::new(path).file_name().unwrap_or_default().display();
    let file = format!(
        "{directory}/{}-{name}.{is_module}.bytecode",
        provider.hash()
    );
    let stored = std::fs::read(&file).ok().and_then(|mut bytes| {
        let (payload, hash) = bytes.split_last_chunk()?;
        (provider.is_source_of(payload, is_module) && checksum(payload) == *hash).then_some(())?;
        bytes.truncate(bytes.len() - size_of::<u64>());
        Some(bytes)
    });
    if stored.is_none() && command_line.requires_disk_cache {
        eprintln!("No bytecode for {path}");
        run::exit(run::EXIT_EXCEPTION);
    }
    let bytes = stored.or_else(|| {
        let depth = command_line.disk_cache_depth.unwrap_or(u32::MAX);
        let bytes = vm.encode_program(provider, is_module, depth)?;
        let partial = format!("{file}.{}", std::process::id());
        let _ = std::fs::write(&partial, [&bytes[..], &checksum(&bytes)].concat())
            .and_then(|()| std::fs::rename(&partial, &file));
        Some(bytes)
    });
    if let Some(bytes) = bytes {
        let payload = match command_line.embeds_disk_cache {
            true => Payload::embedded(bytes.leak()),
            false => Payload::intact(bytes.into()),
        };
        provider.set_bytecode(payload, 0);
    }
}

fn encode_or_throw(cx: &Cx, source: &SourceCode) -> JsResult<Vec<u8>> {
    let is_module = source.provider.source_type() == SourceType::Module;
    let bytes = cx.encode_program(&source.provider, is_module, u32::MAX);
    bytes.ok_or_else(|| cx.throw_error(ErrorType::Error, "no bytecode generated"))
}

#[native_abi]
fn bytecode_for(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let text = frame.argument(0).to_string_ref(cx)?;
    let source_type = match &*to_text(cx, frame.argument(1))? {
        "module" => SourceType::Module,
        _ => SourceType::Program,
    };
    let bytes = encode_or_throw(cx, &files::source(text, None, None, source_type))?;
    JsUint8Array::from_vec(cx, cx.uint8_array_shape(), bytes).map(Into::into)
}

#[native_abi]
fn evaluate_twice_from_bytecode(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let text = frame.argument(0).to_string_ref(cx)?;
    let source = files::source(text, None, None, SourceType::Program);
    let payload = Payload::intact(encode_or_throw(cx, &source)?.into());
    source.provider.set_bytecode(payload, 0);
    let first = evaluate_in(cx, cx.global(), &source)?;
    let second = evaluate_in(cx, global::create(cx), &source)?;
    Ok(cx.new_array_from(&[first, second])?.into())
}
