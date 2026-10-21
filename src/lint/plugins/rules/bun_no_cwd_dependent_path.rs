use crate::bun::{CALLED, Each, bun_calls, module_calls, is_listed, list_option, static_prefix};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::eslint_utils::{ReferenceKind, Trace};
use bun_lint_oxlint::ast_util::callee_name;

/// Disallow a literal relative path where it's resolved against the process's working directory.
///
/// That's the case in the `node:fs` functions, `path.resolve()`, `Bun.file()` and `Bun.write()`.
pub struct NoCwdDependentPath {
    functions: Box<[Box<[u8]>]>,
}

const WORKING_DIRECTORY: Message = Message::new(
    "workingDirectory",
    "{{path}} is relative to the working directory of the process. Resolve it from `import.meta.dirname`.",
);

/// The `node:fs` functions whose second parameter is also a path.
const TWO_PATHS: [&str; 8] = ["copyFile", "copyFileSync", "cp", "cpSync", "link", "linkSync", "rename", "renameSync"];
/// The first parameter of these is relative to the second.
const SYMLINK: [&str; 2] = ["symlink", "symlinkSync"];

/// A trace map for `node:fs` that matches a call of any of its functions, including those in `promises`.
struct FileSystem;

impl<'m> Trace<'m> for FileSystem {
    fn info(&self, _: ReferenceKind) -> Option<u16> {
        None
    }

    fn member(&self, _: usize) -> Option<(&'m str, &'m dyn Trace<'m>)> {
        None
    }

    fn get(&self, name: &[u8]) -> Option<(&'m str, &'m dyn Trace<'m>)> {
        // The default export is the module itself. The tracker handles that as long as the map has no `default` entry.
        match name {
            // `glob` takes a pattern, not a path.
            b"default" | b"glob" | b"globSync" => return None,
            b"promises" => return Some(("promises", &FileSystem)),
            _ => {}
        }
        let known = TWO_PATHS.iter().chain(&SYMLINK).find(|it| it.as_bytes() == name);
        Some((known.copied().unwrap_or_default(), &CALLED))
    }
}

const FILE_SYSTEM: Each<'static> =
    Each { names: &["node:fs", "fs", "node:fs/promises", "fs/promises"], then: &FileSystem };
const PATH: Each<'static> = Each { names: &["node:path", "path"], then: &Each { names: &["resolve"], then: &CALLED } };

/// True if a path that starts with `start` is relative. False for `/a`, `\\a\b`, `C:\a` and `file:///a`.
fn is_relative(start: &[u8]) -> bool {
    let (colon, slash) = (strings::index_of_char(start, b':'), strings::index_of_char(start, b'/'));
    let has_scheme = colon.is_some_and(|colon| slash.is_none_or(|slash| colon < slash));
    !matches!(start, [] | [b'/' | b'\\', ..]) && !has_scheme
}

fn is_relative_path(e: Expr) -> bool {
    static_prefix(e).is_some_and(|it| is_relative(it.0))
}

impl Rule for NoCwdDependentPath {
    const META: Meta = Meta::plugin(Plugin::Bun, "no-cwd-dependent-path", Kind::Suggestion);
    const ON: On = On::new().finish();
    no_state!();

    fn new(options: &Options) -> Self {
        NoCwdDependentPath { functions: list_option(options, "functions", &[]) }
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let report = |path: Option<Expr<'a>>| {
            if let Some(path) = path.filter(|it| is_relative_path(*it)) {
                cx.report(path, WORKING_DIRECTORY).data("path", path.text());
            }
        };
        let arguments_of = |e: Expr<'a>| e.as_call().map(Call::args);
        if FILE_SYSTEM.names.iter().any(|it| file.mentions(it)) {
            for (e, name) in module_calls(file, &FILE_SYSTEM) {
                let Some(arguments) = arguments_of(e) else {
                    continue;
                };
                if !SYMLINK.contains(&name) {
                    report(arguments.first());
                }
                if !name.is_empty() {
                    report(arguments.get(1));
                }
            }
        }
        if PATH.names.iter().any(|it| file.mentions(it)) {
            // If any argument is absolute, `resolve()` starts from it instead of the working directory.
            for arguments in module_calls(file, &PATH).into_iter().filter_map(|it| arguments_of(it.0)) {
                if arguments.iter().all(is_relative_path) {
                    report(arguments.first());
                }
            }
        }
        for arguments in bun_calls(file, &["file", "write"]).into_iter().filter_map(|it| arguments_of(it.0)) {
            report(arguments.first());
        }
        if !self.functions.is_empty() {
            for call in file.exprs_of_kind(ExprTag::Call).filter_map(Expr::as_call) {
                if callee_name(call).is_some_and(|name| is_listed(&self.functions, name.bytes())) {
                    report(call.args().first());
                }
            }
        }
    }
}
