//! `WebAssemblyCompileOptions`

use bun_engine_text::Atom;
use bun_engine_vm::{FastHashSet, for_each_in_iterable};
use bun_engine_wasm_format::{CompileOptions as Borrowed, Error};
use bun_engine_wasm_runtime::{CompileError, Module};

use crate::prelude::*;
use crate::source::name_in_module;

#[derive(Default)]
pub(crate) struct CompileOptions {
    imported_string_constants: Option<Vec<u8>>,
    string_builtins: bool,
    names_a_set_twice: bool,
}

impl CompileOptions {
    /// Those of a module that is imported like an ECMAScript module.
    pub(crate) fn for_imported() -> CompileOptions {
        CompileOptions {
            imported_string_constants: Some(b"wasm:js/string-constants".to_vec()),
            string_builtins: true,
            names_a_set_twice: false,
        }
    }

    pub(crate) fn read(cx: &mut Cx, object: Option<Gc<JsObject>>) -> JsResult<CompileOptions> {
        let mut options = CompileOptions::default();
        let Some(object) = object else {
            return Ok(options);
        };
        let constants = object.get(cx, names::importedStringConstants)?;
        if let Some(name) = constants.as_string() {
            options.imported_string_constants = name_in_module(cx, name.view(cx)?.text())?;
        } else if !constants.is_undefined() {
            let message = "importedStringConstants option value must be a string";
            return Err(cx.throw_type_error(message));
        }
        let builtins = object.get(cx, names::builtins)?;
        if builtins.is_object() {
            options.read_builtin_sets(cx, builtins)?;
        }
        Ok(options)
    }

    fn read_builtin_sets(&mut self, cx: &mut Cx, list: Value) -> JsResult<()> {
        let (mut seen, mut are_strings) = (FastHashSet::default(), true);
        for_each_in_iterable(cx, list, |cx, name| {
            let Some(name) = name.as_string() else {
                are_strings = false;
                return Ok(());
            };
            let name = name.resolve(cx)?;
            let name = cx.or_out_of_memory(Atom::try_from_string(&name))?;
            seen.try_reserve(1).map_err(|_| cx.throw_out_of_memory())?;
            self.string_builtins |= name.string().text().eq_ascii("js-string");
            self.names_a_set_twice |= !seen.insert(name);
            Ok(())
        })?;
        match are_strings {
            true => Ok(()),
            false => Err(cx.throw_type_error("builtins list option values must be strings")),
        }
    }

    /// To a module that has just been compiled.
    pub(crate) fn apply_to(&self, module: &Module) -> Result<(), CompileError> {
        if self.names_a_set_twice {
            return Err(Error::duplicate_builtin_sets().into());
        }
        let imported_string_constants = self.imported_string_constants.as_deref();
        if imported_string_constants.is_none() && !self.string_builtins {
            return Ok(());
        }
        Ok(module.apply_options(Borrowed {
            imported_string_constants,
            string_builtins: self.string_builtins,
        })?)
    }
}
