mod aot_condition;
mod computed_specifiers;
mod constant_specifiers;
mod host_defaults;

use super::CodeImportKind::Import;
use super::memory_host::MemoryHost;
use super::*;

const INSTALLED: &str = "/p/node_modules/pkg/index.js";
const MANIFEST: &str = "/p/node_modules/pkg/package.json";

fn empty_files(paths: &[&str]) -> MemoryHost {
    let files: Vec<(&str, &str)> = paths.iter().map(|&path| (path, "")).collect();
    MemoryHost::new(&files)
}

fn bun_run() -> CodeOptions {
    CodeOptions::bun_run(b"/p")
}

fn import_request<'a>(importer: &'a str, specifier: &'a str) -> CodeRequest<'a> {
    CodeRequest {
        specifier: specifier.as_bytes(),
        importer: importer.as_bytes(),
        directory: dirname::<Posix>(importer.as_bytes()),
        kind: Import,
        form: CodeImportForm::Static,
    }
}

fn with_resolver<T>(
    host: &MemoryHost,
    options: &CodeOptions,
    run: impl FnOnce(&Resolver<'_>) -> T,
) -> T {
    let session = Session::new();
    let type_options = Options::default();
    let resolver = Resolver::for_compile(&session, host, &type_options, options);
    run(&resolver)
}

fn text(bytes: &[u8]) -> String {
    bstr::BStr::new(bytes).to_string()
}

fn find_file<'h>(resolver: &Resolver<'h>, request: &CodeRequest<'_>) -> CodeFile<'h> {
    match resolver.resolve_code(request) {
        CodeResolution::File(file) => file,
        answer => panic!("{request:?} answers {answer:?}"),
    }
}
