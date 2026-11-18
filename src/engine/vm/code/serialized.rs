//! Code as bytes, for another process.

use std::rc::Rc;

use bun_engine_bytecode::Instrumentation;
use bun_engine_bytecode::cache::{self, Encoder, Loaded, Loader, Output, Payload};

use super::cache::{Goal, Key, Unit};
use crate::heap::GcFree;
use crate::{SourceProvider, UnlinkedFunction, Vm, options};

// SAFETY: bytes.
unsafe impl GcFree for Payload {}
// SAFETY: strings, and an observer that is `Sync`, which nothing that refers to a cell is.
unsafe impl GcFree for Loader {}

fn goal_of_program(is_module: bool) -> cache::Goal {
    match is_module {
        true => cache::Goal::Module,
        false => cache::Goal::Script,
    }
}

fn keep_lines<T>(provider: &SourceProvider, loaded: Loaded<T>) -> T {
    provider.set_cached_lines(loaded.lines);
    loaded.root
}

pub(crate) fn log_origin_of_code(is_stored: bool) {
    if options().log_bytecode_cache {
        let outcome = if is_stored { "hit" } else { "miss" };
        bun_engine_platform::log(format_args!(
            "[Disk Cache] Cache {outcome} for sourceCode\n"
        ));
    }
}

impl SourceProvider {
    /// Whether the bytes start like what this build makes of the text.
    pub fn is_source_of(&self, bytecode: &[u8], is_module: bool) -> bool {
        cache::Key::of_program(self.source(), goal_of_program(is_module)).opens(bytecode)
    }
}

impl Vm {
    fn loader(&self) -> &Rc<Loader> {
        &self.services.code.loader
    }

    /// So that what is written down does not depend on when memory is given back.
    pub(super) fn keeps_loaded_code(&self) -> bool {
        self.loader().is_recorded()
    }

    /// With the functions that are nested up to `depth` levels deep. `None` if the text has an error or the code
    /// cannot be stored.
    pub fn encode_program(
        &self,
        provider: &SourceProvider,
        is_module: bool,
        depth: u32,
    ) -> Option<Vec<u8>> {
        let mut encoder = Encoder::default();
        let output = Output {
            encoder: &mut encoder,
            strings: None,
            names: None,
            depth,
        };
        self.with_compiler(provider, Instrumentation::empty(), |compiler, request| {
            output.add_program(compiler, request, goal_of_program(is_module))
        })
        .ok()?;
        Some(encoder.finish().ok()?.payload)
    }

    /// Gives it the code that the payload has for it. `stamp` stands for the text.
    pub fn load_builtin(
        &self,
        builtin: &UnlinkedFunction,
        stamp: u32,
        payload: &Payload,
        entry: u32,
    ) -> bool {
        let key = cache::Key::of_builtin(builtin.provider.source(), stamp, self);
        let loaded = (self.loader()).builtin(payload, entry, &key, self, &builtin.function);
        loaded.map(|it| keep_lines(&builtin.provider, it)).is_some()
    }

    pub(super) fn load_unit(&self, key: &Key<'_>) -> Option<Unit> {
        let is_module = match key.goal {
            Goal::Script => false,
            Goal::Module | Goal::AnalyzedModule => true,
            Goal::Eval | Goal::Function { .. } => return None,
        };
        let (provider, loader, outer) = (key.provider, self.loader(), key.outer);
        let stored = (provider.bytecode()).filter(|_| key.instrumentation.is_empty())?;
        let (payload, entry) = (&stored.payload, stored.entry);
        let wanted = cache::Key {
            source: provider.source(),
            goal: goal_of_program(is_module),
            identity: stored.identity,
        };
        Some(if is_module {
            let needs_interface = key.goal == Goal::Module;
            let loaded = loader.module(payload, entry, &wanted, self, outer, needs_interface)?;
            Unit::Module(Rc::new(keep_lines(provider, loaded)))
        } else {
            let loaded = loader.script(payload, entry, &wanted, self, outer)?;
            Unit::Script(Rc::new(keep_lines(provider, loaded)))
        })
    }
}
