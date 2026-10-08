//! A configuration file that is a program (`eslint.config.js`, `oxlint.config.ts`) is run by the
//! running executable, in a process of its own, which prints what the file exports as JSON.

use crate::configs::Loader;
use crate::paths;
use crate::run::{Fatal, Script};
use bun_core::strings;
use bun_lint::options::Json;

/// What precedes the JSON. The file itself can print, too.
const MARKER: &[u8] = b"\x1e--bun-lint-configuration--\x1e";

pub(crate) fn evaluate(loader: &Loader, path: &[u8], _is_oxlint: bool) -> Result<Json, Fatal> {
    let script = Script {
        source: include_str!("evaluate.js"),
        arguments: &[MARKER, path],
        cwd: paths::dirname(path),
    };
    let fail = |why: &[u8]| Fatal([b"Cannot load the configuration file ", path, b":\n", why.trim_ascii_end()].concat());
    let printed = (loader.environment().run_script)(&script).map_err(|error| fail(&error))?;
    let json = strings::last_index_of(&printed, MARKER).map(|at| &printed[at + MARKER.len()..]);
    json.and_then(bun_lint::json::parse).ok_or_else(|| fail(b"It could not be evaluated."))
}
