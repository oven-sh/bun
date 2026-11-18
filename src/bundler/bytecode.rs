//! Bytecode for `--bytecode` and for the compile cache of `node:module`.

use std::rc::Rc;

use bun_engine_bytecode::cache::{Digest, Encoder, Goal, Key, Output, Payload};
use bun_engine_bytecode::{
    BuiltinFunction, Compiler, FunctionRef, Host, Instrumentation, Request, SourceCache,
};
use bun_engine_text::{Identifier, StringRef};

use crate::options_impl::Format;

pub use bun_engine_bytecode::cache::StringTableBuilder;

unsafe extern "Rust" {
    /// What `@names` mean. Defined in `bun_engine_embed`.
    safe fn __bun_engine_embed_detached_host() -> Box<dyn Host>;
}

unsafe extern "C" {
    /// InternalModuleRegistry.cpp
    safe fn Bun__builtinsSection(length: &mut usize) -> *const u8;
}

/// This executable's builtins section (`bun_exe_format::builtins`).
pub fn host_builtins() -> &'static [u8] {
    let mut length = 0;
    let section = Bun__builtinsSection(&mut length);
    // SAFETY: a read-only section of the executable, and its length.
    unsafe { core::slice::from_raw_parts(section, length) }
}

#[derive(Clone, Copy)]
pub enum Source<'a> {
    Module(&'a [u8]),
    /// `(function(exports, require, module, ...) {})`
    CommonJs(&'a [u8]),
    /// As a builtins section has it, with the `source_stamp` of that.
    InternalModule(&'a [u8], u32),
}

impl<'a> Source<'a> {
    pub fn chunk(format: Format, text: &'a [u8]) -> Option<Source<'a>> {
        match format {
            Format::Esm => Some(Source::Module(text)),
            Format::Cjs => Some(Source::CommonJs(text)),
            _ => None,
        }
    }
}

fn describe_internal_module(text: &StringRef) -> FunctionRef {
    BuiltinFunction::module(Identifier::from_literal(""), text.len() as u32)
}

/// Stays on its thread.
pub struct Generator {
    compiler: Compiler,
    host: Box<dyn Host>,
    stack_limit: usize,
}

impl Default for Generator {
    fn default() -> Generator {
        bun_core::StackCheck::configure_thread();
        Generator {
            compiler: Compiler::default(),
            host: __bun_engine_embed_detached_host(),
            stack_limit: bun_core::StackCheck::init().limit(),
        }
    }
}

impl Generator {
    /// False if the text has an error.
    pub(crate) fn add(&mut self, source: Source<'_>, mut output: Output<'_>) -> bool {
        let (Source::Module(bytes) | Source::CommonJs(bytes) | Source::InternalModule(bytes, _)) =
            source;
        // An executable has its chunks as `encode_text_module` writes them. All else is read as Latin-1.
        let is_utf8 = output.strings.is_some() && !matches!(source, Source::InternalModule(..));
        let units = is_utf8.then(|| bun_core::strings::wtf8_to_utf16_alloc(bytes));
        let Ok(text) =
            (units.flatten()).map_or_else(|| StringRef::try_from_units(bytes), StringRef::from_vec)
        else {
            return false;
        };
        let request = Request {
            source: &text,
            cache: Some(&mut SourceCache::default()),
            host: &*self.host,
            instrumentation: Instrumentation::empty(),
            stack_limit: self.stack_limit,
        };
        let compiler = &mut self.compiler;
        match source {
            Source::Module(_) => output.add_program(compiler, request, Goal::Module).is_ok(),
            Source::CommonJs(_) => {
                output.depth = output.depth.saturating_add(1);
                output.add_program(compiler, request, Goal::Script).is_ok()
            }
            Source::InternalModule(_, stamp) => {
                let function = describe_internal_module(&text);
                (output.add_builtin(compiler, request, &function, stamp)).is_ok()
            }
        }
    }

    /// `depth`: how many levels of functions below the top level get code. `strings`: those of the executable that it
    /// is for.
    pub fn generate(
        &mut self,
        source: Source<'_>,
        depth: u32,
        strings: Option<&mut StringTableBuilder>,
    ) -> Option<Box<[u8]>> {
        let mut encoder = Encoder::default();
        let output = Output {
            encoder: &mut encoder,
            strings,
            names: None,
            depth,
        };
        self.add(source, output).then_some(())?;
        Some(encoder.finish().ok()?.payload.into())
    }
}

/// Of all the code that this executable has for a chunk.
pub fn digest_of_chunk(
    text: &StringRef,
    is_esm: bool,
    bytecode: &'static [u8],
    entry: u32,
) -> Option<Digest> {
    let key = Key::of_program(text, if is_esm { Goal::Module } else { Goal::Script });
    let (host, payload) = (
        __bun_engine_embed_detached_host(),
        Payload::embedded(bytecode),
    );
    Digest::of(&Rc::default(), (&payload, entry), &key, &*host, None)
}

pub fn digest_of_internal_module(
    text: &'static [u8],
    stamp: u32,
    bytecode: &'static [u8],
    entry: u32,
) -> Option<Digest> {
    let (host, payload) = (
        __bun_engine_embed_detached_host(),
        Payload::embedded(bytecode),
    );
    let text = StringRef::from_static_units(text);
    let function = describe_internal_module(&text);
    let key = Key::of_builtin(&text, stamp, &*host);
    let function = Some(&function);
    Digest::of(&Rc::default(), (&payload, entry), &key, &*host, function)
}
