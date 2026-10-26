//! `pkgUp` and `readPkgUp` from eslint-module-utils and `core/packagePath.js` from eslint-plugin-import, which find the
//! `package.json` a file belongs to. The paths they return are absolute and use `/` as the separator.

use bun_core::strings;
use bun_lint::linter::json_parse;
use bun_lint::modules::Modules;
use bun_lint::options::Json;
use bun_lint::paths;

/// `findUp(filename, cwd)`: looks in `cwd` itself, then in each directory above it.
fn find_up(modules: &dyn Modules, filename: &[u8], cwd: &[u8]) -> Option<Vec<u8>> {
    let dir = paths::resolve(modules.cwd(), cwd);
    paths::ancestors(&dir)
        .map(|it| paths::join(it, filename))
        .find(|it| modules.exists(it))
}

/// `pkgUp({ cwd: from })`. The rules pass a file path as `from`, and the search treats it like a directory.
pub(crate) fn pkg_up(modules: &dyn Modules, from: &[u8]) -> Option<Vec<u8>> {
    find_up(modules, b"package.json", from)
}

/// `readPkgUp({ cwd: from })`. Returns `pkg` and `path`. `None` is upstream's `{}`, which means there's no
/// `package.json` or the closest one isn't valid JSON.
pub(crate) fn read_pkg_up(modules: &dyn Modules, from: &[u8]) -> Option<(Json, Vec<u8>)> {
    let fp = pkg_up(modules, from)?;
    let content = modules.read(&fp)?;
    let pkg = json_parse(strings::without_utf8_bom(&content)).ok()?;
    Some((pkg, fp))
}

/// `getFilePackagePath(filePath)`, and `getContextPackagePath(context)` when called with the linted file's path. `None`
/// where upstream throws.
pub(crate) fn file_package_path(modules: &dyn Modules, file_path: &[u8]) -> Option<Vec<u8>> {
    let fp = pkg_up(modules, file_path)?;
    Some(paths::dirname(&fp).to_vec())
}

/// The result of `findNamedPackage` in `no-relative-packages`, if its `pkg` is truthy.
pub(crate) struct NamedPackage {
    /// `pkg.name`. `None` if it isn't a string.
    pub(crate) name: Option<Vec<u8>>,
    /// The path of its `package.json`.
    pub(crate) path: Vec<u8>,
}

/// Also returns `None` where upstream loops forever, which is when the `package.json` in the root directory has no
/// name.
pub(crate) fn find_named_package(modules: &dyn Modules, file_path: &[u8]) -> Option<NamedPackage> {
    let mut from = file_path.to_vec();
    loop {
        let (pkg, path) = read_pkg_up(modules, &from)?;
        if !pkg.is_truthy() {
            return None;
        }
        if let Some(name) = pkg.get(b"name").filter(|it| it.is_truthy()) {
            return Some(NamedPackage {
                name: name.as_str().map(<[u8]>::to_vec),
                path,
            });
        }
        let directory = paths::dirname(&path);
        let above = paths::dirname(directory);
        if above.len() == directory.len() {
            return None;
        }
        from = above.to_vec();
    }
}

/// `getFilePackageName(filePath)`. `None` for `null`, or for a name that isn't a string.
pub(crate) fn file_package_name(modules: &dyn Modules, file_path: &[u8]) -> Option<Vec<u8>> {
    find_named_package(modules, file_path)?.name
}
