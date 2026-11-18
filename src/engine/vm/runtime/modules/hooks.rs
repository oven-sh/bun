use std::rc::Rc;

use bun_engine_bytecode::ImportPhase;
use bun_engine_text::{Identifier, StringBuilder, StringRef};

use crate::{
    Cx, ErrorType, FetchParameters, Gc, JsObject, JsPromise, JsResult, JsString, ModuleLoader,
    ModuleNamespace, Shape, SourceCode, SourceProvider, SourceTextModuleRecord, SyntheticExports,
    Value,
};

/// What a name that is to be resolved stands for.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ModuleName {
    /// It is in the source of a module.
    Specifier,
    /// It names the module that a load starts with.
    Entry,
}

type Parameters = Option<Rc<FetchParameters>>;

/// What a loader asks of the embedder.
pub struct ModuleHooks {
    /// For `import()`, with the origin of the code that calls it.
    pub import: fn(
        &mut Cx,
        Gc<ModuleLoader>,
        Gc<JsString>,
        Parameters,
        Option<&SourceProvider>,
        ImportPhase,
    ) -> JsResult<Gc<JsPromise>>,
    /// From the name and the key of the referrer to a key. Either is undefined if it is not a string.
    pub resolve: fn(&mut Cx, Gc<ModuleLoader>, Value, Value, ModuleName) -> JsResult<Identifier>,
    /// From the key and that of the referrer to what `ModuleLoader::make_module` takes.
    pub fetch: fn(
        &mut Cx,
        Gc<ModuleLoader>,
        Value,
        Option<&StringRef>,
        Parameters,
    ) -> JsResult<Gc<JsPromise>>,
    pub create_import_meta:
        fn(&mut Cx, Gc<ModuleLoader>, Value, Gc<SourceTextModuleRecord>) -> JsResult<Gc<JsObject>>,
    /// Returns what `SourceTextModuleRecord::run_code` does, unless it throws first.
    pub evaluate:
        fn(&mut Cx, Gc<ModuleLoader>, Value, Gc<SourceTextModuleRecord>) -> JsResult<Value>,
    /// For `SourceType::Synthetic`.
    pub generate_exports:
        fn(&mut Cx, &SourceProvider, &Identifier, &mut SyntheticExports) -> JsResult<()>,
    /// For `SourceType::AnalyzedModule`. Settles the promise with the record.
    pub make_analyzed_module:
        fn(&mut Cx, Gc<ModuleLoader>, &Identifier, &SourceCode, Gc<JsPromise>) -> JsResult<()>,
    /// Whether `import` does the same for both.
    pub have_same_origin: fn(&SourceProvider, &SourceProvider) -> bool,
    pub create_namespace_shape: fn(&Cx) -> Gc<Shape>,
}

fn reject_naming(cx: &mut Cx, before: &str, name: Value) -> JsResult<Gc<JsPromise>> {
    let thrown = match name.to_string_view(cx) {
        Ok(name) => {
            let mut message = StringBuilder::new();
            message.push_ascii(before);
            message.push_text(name.text());
            message.push_ascii("'.");
            cx.throw_error(ErrorType::Error, message)
        }
        Err(thrown) => thrown,
    };
    JsPromise::rejected_with_caught(cx, thrown)
}

impl ModuleHooks {
    pub const DEFAULT: ModuleHooks = ModuleHooks {
        import: |cx, _, name, _, _, _| {
            reject_naming(cx, "Could not import the module '", name.into())
        },
        resolve: |cx, _, name, _, _| Ok(name.to_property_key(cx)?.to_identifier()),
        fetch: |cx, _, key, _, _| reject_naming(cx, "Could not open the module '", key),
        create_import_meta: |cx, _, _, _| Ok(cx.new_object_with_null_prototype()),
        evaluate: |cx, _, _, module| module.run_code(cx),
        generate_exports: |_, _, _, _| Ok(()),
        make_analyzed_module: |cx, loader, key, source, promise| {
            loader.make_source_text_module(cx, key, source, promise);
            Ok(())
        },
        have_same_origin: |a, b| a.origin().url() == b.origin().url(),
        create_namespace_shape: |cx| ModuleNamespace::create_shape(cx, Value::NULL),
    };
}
