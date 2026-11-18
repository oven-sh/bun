//! Modules are files, and their keys are `file:` URLs.

use std::rc::Rc;

use bun_engine_bytecode::ImportPhase;
use bun_engine_vm::{
    ErrorInstance, FetchParameters, JsPromise, JsSourceCode, ModuleHooks, ModuleLoader, ModuleName,
    ModuleType, SourceProvider, SourceTextModuleRecord, SourceType,
};

use crate::files;
use crate::prelude::*;

pub(crate) const HOOKS: ModuleHooks = ModuleHooks {
    import,
    resolve,
    fetch,
    create_import_meta,
    ..ModuleHooks::DEFAULT
};

fn rejected(cx: &Cx, message: &str) -> Gc<JsPromise> {
    let error = ErrorInstance::new(cx, ErrorType::Error, Some(StringRef::from_str(message)));
    JsPromise::rejected(cx, error.into())
}

fn import(
    cx: &mut Cx,
    loader: Gc<ModuleLoader>,
    specifier: Gc<JsString>,
    parameters: Option<Rc<FetchParameters>>,
    origin: Option<&SourceProvider>,
    phase: ImportPhase,
) -> JsResult<Gc<JsPromise>> {
    let specifier = specifier.to_identifier(cx)?;
    let referrer = origin.and_then(|it| it.url()).cloned().unwrap_or_default();
    if !files::is_file_url(&referrer.to_string()) {
        let message = format!(
            "Could not resolve the referrer's path '{referrer}', while trying to resolve module '{specifier}'."
        );
        return Ok(rejected(cx, &message));
    }
    let referrer = Identifier::new(referrer.text());
    let order = loader.async_evaluation_order(referrer.name());
    (loader.request_import(cx, &specifier, Some(&referrer), parameters, phase, order))
        .or_else(|thrown| JsPromise::rejected_with_caught(cx, thrown))
}

fn resolve(
    cx: &mut Cx,
    _: Gc<ModuleLoader>,
    name: Value,
    referrer: Value,
    _: ModuleName,
) -> JsResult<Identifier> {
    let name = name.to_string_view(cx)?.text().to_string();
    let base = match referrer.as_string() {
        Some(referrer) => referrer.view(cx)?.text().to_string(),
        None => files::url_of_working_directory(),
    };
    let url = if files::is_file_url(&name) {
        name
    } else if files::is_absolute(&name) {
        files::url_of_path(&name)
    } else if !files::is_dotted_relative(&name) {
        let base = files::path_of_url(&base);
        return Err(cx.throw_type_error(format_args!(
            "Module specifier, '{name}' is not absolute and does not start with \"./\" or \"../\". Referenced from: {base}"
        )));
    } else if files::is_file_url(&base) {
        files::resolve(&base, &name)
    } else {
        let message = format_args!("Could not resolve the referrer's path: {base}");
        return Err(cx.throw_error(ErrorType::Error, message));
    };
    Ok(Identifier::new(StringRef::from_str(&url).text()))
}

fn fetch(
    cx: &mut Cx,
    _: Gc<ModuleLoader>,
    key: Value,
    _: Option<&StringRef>,
    parameters: Option<Rc<FetchParameters>>,
) -> JsResult<Gc<JsPromise>> {
    let url = key.to_string_view(cx)?.text().to_string();
    let path = files::path_of_url(&url);
    let Ok(mut bytes) = std::fs::read(&path) else {
        return Ok(rejected(cx, &format!("Could not open file '{path}'.")));
    };
    let is_text = |it: &FetchParameters| {
        (it.host_defined_type()).is_some_and(|name| name.text().eq_ascii("text"))
    };
    let source_type = match parameters {
        Some(it) if it.module_type() == ModuleType::Json => SourceType::Json,
        Some(it) if is_text(&it) => SourceType::Text,
        Some(it) if it.module_type() == ModuleType::WebAssembly => SourceType::WebAssembly,
        _ if bytes.starts_with(b"\0asm") => SourceType::WebAssembly,
        _ => SourceType::Module,
    };
    let text = match source_type {
        SourceType::WebAssembly => StringRef::from_latin1(&bytes),
        SourceType::Module => {
            files::comment_out_hashbang(&mut bytes);
            files::decode(&bytes)
        }
        _ => files::decode(&bytes),
    };
    let source = files::source(text, Some(&files::origin(&url)), Some(&path), source_type);
    if source_type == SourceType::Module {
        crate::functions::use_disk_cache(cx, &source, &path);
    }
    Ok(JsPromise::fulfilled(
        cx,
        JsSourceCode::create(cx, source).into(),
    ))
}

fn create_import_meta(
    cx: &mut Cx,
    _: Gc<ModuleLoader>,
    key: Value,
    _: Gc<SourceTextModuleRecord>,
) -> JsResult<Gc<JsObject>> {
    let meta = cx.new_object_with_null_prototype();
    for name in ["filename", "url"] {
        let name = Identifier::from_literal(name);
        meta.put_direct(cx, name.name(), key, Attributes::NONE);
    }
    Ok(meta)
}
