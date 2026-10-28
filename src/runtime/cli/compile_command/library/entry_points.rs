use bun_ast::Expr;
use bun_paths::platform::Auto;
use bun_paths::resolve_path::join_abs_string_checked;

use super::is_inside;

const TYPESCRIPT_EXTENSIONS: [&[u8]; 3] = [b".ts", b".tsx", b".mts"];
const DECLARATION_EXTENSIONS: [&[u8]; 2] = [b".d.ts", b".d.mts"];
const TYPESCRIPT_INDEX_FILES: [&[u8]; 6] = [
    b"index.ts",
    b"index.tsx",
    b"index.mts",
    b"src/index.ts",
    b"src/index.tsx",
    b"src/index.mts",
];
const JAVASCRIPT_INDEX_FILES: [&[u8]; 4] =
    [b"index.js", b"index.mjs", b"src/index.js", b"src/index.mjs"];

pub(super) fn find_entry_points(
    directory: &[u8],
    package_json: Option<&Expr>,
    outdir: &[u8],
) -> Vec<Box<[u8]>> {
    let find_source =
        |written: &[u8]| find_file(directory, written).filter(|path| !is_inside(outdir, path));

    let mut targets = Vec::new();
    if let Some(exports) = package_json.and_then(|root| root.get(b"exports")) {
        collect_export_targets(&exports, &mut targets);
    }
    let mut exported: Vec<Box<[u8]>> = Vec::new();
    for target in targets.iter().filter(|target| is_typescript(target)) {
        if let Some(path) = find_source(target)
            && !exported.contains(&path)
        {
            exported.push(path);
        }
    }
    if !exported.is_empty() {
        return exported;
    }

    let string_member = |name: &[u8]| -> Option<Vec<u8>> {
        Some(package_json?.get(name)?.as_utf8_string_literal()?.to_vec())
    };
    let named: Vec<Vec<u8>> = [&b"module"[..], b"main"]
        .into_iter()
        .filter_map(string_member)
        .collect();
    let named = || named.iter().map(Vec::as_slice);
    let mut candidates = named()
        .filter(|written| is_typescript(written))
        .chain(TYPESCRIPT_INDEX_FILES)
        .chain(named().filter(|written| !is_typescript(written)))
        .chain(JAVASCRIPT_INDEX_FILES);
    candidates.find_map(find_source).into_iter().collect()
}

fn collect_export_targets(exports: &Expr, targets: &mut Vec<Vec<u8>>) {
    if let Some(target) = exports.as_utf8_string_literal() {
        targets.push(target.to_vec());
    } else if let Some(mut fallbacks) = exports.as_array() {
        while let Some(fallback) = fallbacks.next() {
            collect_export_targets(&fallback, targets);
        }
    } else {
        exports.for_each_property(|_, _, inner| collect_export_targets(&inner, targets));
    }
}

fn is_typescript(path: &[u8]) -> bool {
    let has_one_of = |extensions: &[&[u8]]| extensions.iter().any(|it| path.ends_with(it));
    has_one_of(&TYPESCRIPT_EXTENSIONS) && !has_one_of(&DECLARATION_EXTENSIONS)
}

fn find_file(directory: &[u8], written: &[u8]) -> Option<Box<[u8]>> {
    let absolute_path = join_abs_string_checked::<Auto>(directory, &[written])?;
    if bun_core::strings::contains_char(absolute_path, 0) {
        return None;
    }
    let absolute_path = bun_core::ZBox::from_bytes(absolute_path);
    match bun_sys::exists_at_type(bun_core::Fd::cwd(), &absolute_path) {
        Ok(bun_sys::ExistsAtType::File) => Some(absolute_path.as_bytes().into()),
        Ok(bun_sys::ExistsAtType::Directory) | Err(_) => None,
    }
}
