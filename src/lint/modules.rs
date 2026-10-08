//! What a rule that is about several files sees of the others: which module imports which.
//!
//! A file is parsed, linted and freed before the next, so no rule can look into another file. What it can ask is in [`Modules`],
//! which whoever lints the files provides: [`File::modules`]. It is made in two steps, so that no file is parsed twice for it:
//! 1. While the files are linted, [`Modules::is_complete`] is false. The rule has nothing to report yet. It
//!    [records](Modules::record) what the file imports, which is resolved there and then, on the thread that lints the file.
//! 2. When all files are linted, the files that they import and that are not linted themselves are read, and the strongly
//!    connected components are computed. Then the files that the rule may have something to say about, which are few, are linted
//!    again with only such rules, and [`Modules::is_complete`] is true.
//!
//! The model is `ExportMap.imports` of eslint-plugin-import.

use crate::ast::{ExprKind, ExprTag, File, StmtKind};
use crate::options::Json;
use crate::utils::text::find_line_break;
use smallvec::SmallVec;

/// A file, among those that the files which are linted import, directly or not.
#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct ModuleId(pub u32);

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum RequestKind {
    /// `import .. from "m"`, `export .. from "m"`
    Static,
    /// `import("m")`
    Dynamic,
    /// Anything else that a rule wants resolved and read, like `require("m")`. The module does not count as imported.
    Other,
}

/// A place where a file names a module.
#[derive(Copy, Clone, Debug)]
pub struct Request<'a> {
    pub specifier: &'a [u8],
    /// The line that the specifier starts in, from 1.
    pub line: u32,
    pub kind: RequestKind,
    /// `import type`, `import { type A, type B }`, `export type * from`
    pub is_only_importing_types: bool,
}

/// A [`Request`] of a module that is known.
#[derive(Clone, Debug)]
pub struct Declaration {
    pub specifier: Box<[u8]>,
    pub line: u32,
    pub is_dynamic: bool,
    pub is_only_importing_types: bool,
}

/// All the places where a module imports another.
#[derive(Clone, Debug)]
pub struct Import {
    pub module: ModuleId,
    pub declarations: SmallVec<[Declaration; 1]>,
}

#[derive(Copy, Clone, Debug)]
pub struct Resolved {
    pub module: ModuleId,
    /// It was found in a `node_modules`, where it can be a symbolic link to somewhere else.
    pub is_external: bool,
}

pub trait Modules: Sync {
    /// Everything is known. Until then only [`Modules::record`] does something.
    fn is_complete(&self) -> bool;

    /// Takes note of what the file at `path` imports. The last time counts.
    ///
    /// `is_always_checked`: it is linted again whatever it imports. Otherwise only if it is in a cycle of modules that import
    /// values from each other.
    fn record(&self, path: &[u8], requests: &[Request], is_always_checked: bool);

    /// The file at `path`.
    fn find(&self, path: &[u8]) -> Option<ModuleId>;

    /// What `specifier` means in the file at `from`, as TypeScript resolves it. `None` if there is no such file.
    fn resolve(&self, from: &[u8], specifier: &[u8], is_require: bool) -> Option<Resolved>;

    /// Absolute, with symbolic links followed.
    fn path(&self, module: ModuleId) -> &[u8];

    /// What it imports, in the order of eslint-plugin-import: what is imported dynamically first. Nothing if it is not JavaScript or
    /// TypeScript, if it is in a `node_modules`, or if it cannot be read.
    fn imports(&self, module: ModuleId) -> &[Import];

    /// The same number for two modules of which each imports values from the other, directly or not.
    fn component(&self, module: ModuleId) -> u32;

    /// The `package.json` that is closest to the file at `path`, of those that are an object. It can be asked at any time.
    fn package_json(&self, path: &[u8]) -> Option<&Json>;
}

impl<'a> File<'a> {
    /// The other files. `None` where a file is linted alone: a rule that needs them has nothing to say.
    #[inline]
    pub fn modules(&self) -> Option<&'a dyn Modules> {
        self.modules.get()
    }

    pub fn set_modules(&self, modules: &'a dyn Modules) {
        self.modules.set(Some(modules));
    }
}

/// What eslint-plugin-import takes for the imports of a module, in its order: every `import("m")`, then the `import`s and the
/// `export .. from`s at the top level.
pub fn requests_of<'a>(file: &'a File<'a>) -> Vec<Request<'a>> {
    // With the offset in place of the line.
    let mut requests = Vec::new();
    for e in file.exprs_of_kind(ExprTag::ImportCall) {
        if let ExprKind::ImportCall { args } = e.kind()
            && let Some(source) = args.first()
            && let Some(specifier) = source.as_string()
        {
            requests.push(Request {
                specifier: specifier.bytes(),
                line: source.span().start,
                kind: RequestKind::Dynamic,
                is_only_importing_types: false,
            });
        }
    }
    requests.sort_unstable_by_key(|it| it.line);
    for stmt in file.body() {
        let (specifier, is_only_importing_types) = match stmt.kind() {
            StmtKind::Import(import) => {
                let has_values = import.default().is_some() || import.namespace().is_some();
                let named = import.named();
                let are_all_types = !has_values && !named.is_empty() && named.iter().all(|it| it.is_type_only());
                (Some(import.spec()), import.is_type_only() || are_all_types)
            }
            // eslint-plugin-import does not look at `exportKind` here.
            StmtKind::ExportNamed(export) => (export.spec(), false),
            StmtKind::ExportStar { spec, type_only, .. } => (spec, type_only),
            _ => continue,
        };
        if let (Some(specifier), Some(span)) = (specifier, stmt.module_specifier_span()) {
            requests.push(Request {
                specifier: specifier.bytes(),
                line: span.start,
                kind: RequestKind::Static,
                is_only_importing_types,
            });
        }
    }
    set_lines(file.text(), &mut requests);
    requests
}

/// Replaces the offset that is in [`Request::line`] by the line. It reads the text up to the last of them, which for most files is
/// a small part.
pub fn set_lines(text: &[u8], requests: &mut [Request]) {
    let mut order: SmallVec<[u32; 32]> = (0..requests.len() as u32).collect();
    order.sort_unstable_by_key(|&at| requests[at as usize].line);
    let (mut line, mut line_end) = (1, 0);
    for at in order {
        let offset = requests[at as usize].line as usize;
        // `line_end`: where the line break after `line` ends, once it is found.
        while let Some((start, len)) = text.get(line_end..offset).and_then(find_line_break) {
            line += 1;
            line_end += start + len;
        }
        requests[at as usize].line = line;
    }
}
