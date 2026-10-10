#![allow(dead_code)] // until every rule of the plugin is written
//! `pkgUp` and `readPkgUp` of eslint-module-utils, `core/packagePath.js` of eslint-plugin-import:
//! the `package.json` that a file belongs to. What they answer is absolute and separated by `/`.

use bun_core::strings;
use bun_lint::linter::json_parse;
use bun_lint::modules::Modules;
use bun_lint::options::Json;
use bun_lint::paths;

/// `findUp(filename, cwd)`: in `cwd` itself, then in each directory above it.
fn find_up(modules: &dyn Modules, filename: &[u8], cwd: &[u8]) -> Option<Vec<u8>> {
    let dir = paths::resolve(modules.cwd(), cwd);
    paths::ancestors(&dir)
        .map(|it| paths::join(it, filename))
        .find(|it| modules.exists(it))
}

/// `pkgUp({ cwd: from })`. The rules give it a file, which is looked into as a directory is.
pub(crate) fn pkg_up(modules: &dyn Modules, from: &[u8]) -> Option<Vec<u8>> {
    find_up(modules, b"package.json", from)
}

/// `readPkgUp({ cwd: from })`: `pkg` and `path`. `None` is its `{}`: there is none, or the closest
/// one is not JSON.
pub(crate) fn read_pkg_up(modules: &dyn Modules, from: &[u8]) -> Option<(Json, Vec<u8>)> {
    let fp = pkg_up(modules, from)?;
    let content = modules.read(&fp)?;
    let pkg = json_parse(strings::without_utf8_bom(&content)).ok()?;
    Some((pkg, fp))
}

/// `Boolean(value)`
pub(crate) fn is_truthy(value: &Json) -> bool {
    match value {
        Json::Null => false,
        Json::Bool(value) => *value,
        Json::Number(value) => *value != 0.0 && !value.is_nan(),
        Json::String(value) => !value.is_empty(),
        Json::Array(_) | Json::Object(_) => true,
    }
}

/// `getFilePackagePath(filePath)`, and `getContextPackagePath(context)` for the path of the file.
/// `None`: upstream throws.
pub(crate) fn file_package_path(modules: &dyn Modules, file_path: &[u8]) -> Option<Vec<u8>> {
    let fp = pkg_up(modules, file_path)?;
    Some(paths::dirname(&fp).to_vec())
}

/// `getFilePackageName(filePath)`. `None`: `null`, or a name that is no string, or upstream never
/// ends: the `package.json` in the root has no name.
pub(crate) fn file_package_name(modules: &dyn Modules, file_path: &[u8]) -> Option<Vec<u8>> {
    let mut from = file_path.to_vec();
    loop {
        let (pkg, path) = read_pkg_up(modules, &from)?;
        if !is_truthy(&pkg) {
            return None;
        }
        if let Some(name) = pkg.get(b"name").filter(|it| is_truthy(it)) {
            return name.as_str().map(<[u8]>::to_vec);
        }
        let directory = paths::dirname(&path);
        let above = paths::dirname(directory);
        if above.len() == directory.len() {
            return None;
        }
        from = above.to_vec();
    }
}
