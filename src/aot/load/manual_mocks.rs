//! `vi.mock("./lib")` and `jest.mock("./lib")` without a factory. Where a file of the same name lies in the folder `__mocks__` beside the module, the test
//! runner loads that file in the module's place; for a package or a module of Bun's own, the file of that name in `__mocks__` where the run was started.
//! No import names the file. It is a source of the project like any other, so it is compiled with the program.
//! The rule is `findManualModuleMock()` in src/jsc/bindings/BunPlugin.cpp.

use bun_paths::platform::Posix;
use bun_paths::resolve_path::{basename, dirname};
use bun_sema::hir::ExprKind;
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier, is_module_call_of_plugin};
use bun_sema::resolve::{CodeResolution, ExternalKind, FinishedFile, SiteResolution};

use crate::load::is_in_node_modules;

// The order in which the resolver tries them for a path without one.
const EXTENSIONS: [&[u8]; 9] = [
    b".tsx", b".ts", b".jsx", b".cts", b".cjs", b".js", b".mjs", b".mts", b".json",
];

fn find_file_at(path: Vec<u8>, is_file: &dyn Fn(&[u8]) -> bool) -> Option<Vec<u8>> {
    if is_file(&path) {
        return Some(path);
    }
    let with = |middle: &[u8], extension: &[u8]| [&path[..], middle, extension].concat();
    let beside = EXTENSIONS.iter().map(|extension| with(b"", extension));
    let inside = EXTENSIONS
        .iter()
        .map(|extension| with(b"/index", extension));
    beside.chain(inside).find(|candidate| is_file(candidate))
}

pub(crate) fn find_manual_mocks(
    file: &FinishedFile<'_, '_>,
    working_directory: &[u8],
    is_file: &dyn Fn(&[u8]) -> bool,
) -> Vec<Vec<u8>> {
    let mut found = Vec::new();
    let sites = file.analysis.import_sites.iter();
    for (site, resolution) in sites.zip(file.resolutions) {
        let (ImportSiteKind::MockModule(call), ImportSpecifier::Constant(written)) =
            (site.kind, site.specifier)
        else {
            continue;
        };
        let ExprKind::Call(arguments) = file.hir[call].kind else {
            continue;
        };
        if file.hir[arguments].args.len() != 1
            || is_module_call_of_plugin(file.hir, file.bound, call)
        {
            continue;
        }
        let written = file.atoms.bytes(written);
        let beside =
            |path: &[u8]| [dirname::<Posix>(path), b"/__mocks__/", basename(path)].concat();
        let candidate = match *resolution {
            SiteResolution::Constant(CodeResolution::File(module))
                if module.host_module.is_none() && !is_in_node_modules(module.path) =>
            {
                beside(module.path)
            }
            // The module lies in a program below this one, and its name stands as it is written.
            SiteResolution::Constant(CodeResolution::External {
                specifier: [b'.' | b'/', ..],
                kind: ExternalKind::UncompiledCode,
            }) => beside(&bun_sema::resolve::join(
                dirname::<Posix>(file.path),
                written,
            )),
            _ if !written.starts_with(b".") && !written.starts_with(b"/") => {
                let name = written.strip_prefix(b"node:").unwrap_or(written);
                [working_directory, b"/__mocks__/", name].concat()
            }
            _ => continue,
        };
        found.extend(find_file_at(candidate, is_file));
    }
    found
}
