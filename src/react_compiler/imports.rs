//! Port of `react_compiler/entrypoint/imports.rs` — see DESIGN.md.
/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

use crate::collections::{IndexMap, IndexSet};

use crate::diagnostics::{
    CompilerError, CompilerErrorDetail, ErrorCategory, Position, SourceLocation,
};
use bun_alloc::{AstAlloc, AstVec};
use bun_ast::{
    ClauseItem, ImportKind, ImportRecord, Loc, LocRef, S, Stmt, StoreSlice, StoreStr, Symbol,
};

use crate::hir::environment::OutputMode;
use crate::options::ReactCompilerOptions;
use crate::program::Host;

/// An import specifier tracked by ProgramContext.
/// Corresponds to NonLocalImportSpecifier in the TS compiler.
#[derive(Debug, Clone, Copy)]
pub(crate) struct NonLocalImportSpecifier {
    pub name_ref: bun_ast::Ref,
    pub imported: &'static str,
}

/// Context for the program being compiled.
/// Tracks compiled functions, generated names, and import requirements.
/// Equivalent to ProgramContext class in Imports.ts.
pub(crate) struct ProgramContext {
    pub opts: ReactCompilerOptions,
    pub filename: Option<String>,
    pub code: Option<String>,
    pub react_runtime_module: &'static str,
    pub output_mode: OutputMode,
    pub has_module_scope_opt_out: bool,

    // Pre-resolved import local names for codegen
    pub instrument_fn_name: Option<String>,
    pub instrument_gating_name: Option<String>,
    pub hook_guard_name: Option<String>,

    // Variable renames from lowering, to be applied back to the Babel AST
    pub renames: Vec<crate::hir::environment::BindingRename>,

    // Internal state
    known_referenced_names: IndexSet<String>,
    imports: IndexMap<&'static str, IndexMap<&'static str, NonLocalImportSpecifier>>,
}

impl ProgramContext {
    pub(crate) fn new(
        opts: ReactCompilerOptions,
        filename: Option<String>,
        code: Option<String>,
        has_module_scope_opt_out: bool,
    ) -> Self {
        let react_runtime_module = get_react_compiler_runtime_module(opts.target.as_deref());
        Self {
            opts,
            filename,
            code,
            react_runtime_module,
            output_mode: OutputMode::Client,
            has_module_scope_opt_out,
            instrument_fn_name: None,
            instrument_gating_name: None,
            hook_guard_name: None,
            renames: Vec::new(),
            known_referenced_names: IndexSet::new(),
            imports: IndexMap::new(),
        }
    }

    /// Initialize known referenced names from scope bindings.
    /// Call this after construction to seed conflict detection with program scope bindings.
    pub(crate) fn init_from_scope(&mut self, symbols: &[Symbol]) {
        // Register ALL bindings (not just program-scope) so that UID generation
        // avoids name conflicts with any binding in the file. This matches
        // Babel's generateUid() which checks all scopes.
        for binding in symbols {
            if let Ok(name) = core::str::from_utf8(binding.original_name.slice()) {
                self.known_referenced_names.insert(name.to_string());
            }
        }
    }

    /// Generate a unique identifier name that doesn't conflict with existing bindings.
    ///
    /// For hook names (use*), preserves the original name to avoid breaking
    /// hook-name-based type inference. For other names, prefixes with underscore
    /// similar to Babel's generateUid.
    pub(crate) fn new_uid(&mut self, name: &str) -> String {
        if is_hook_name(name) {
            // Don't prefix hooks with underscore, since InferTypes might
            // type HookKind based on callee naming convention.
            let mut uid = name.to_string();
            let mut i = 0;
            while self.known_referenced_names.contains(&uid) {
                uid = format!("{}_{}", name, i);
                i += 1;
            }
            self.known_referenced_names.insert(uid.clone());
            return uid;
        }
        let uid = name.to_string();
        if !self.known_referenced_names.contains(&uid) {
            self.known_referenced_names.insert(uid.clone());
            return uid;
        }
        // Generate unique name with underscore prefix (similar to Babel's generateUid).
        // Babel strips leading underscores before prefixing, so:
        //   generateUid("_c") → strips to "c" → generates "_c", "_c2", "_c3", ...
        //   generateUid("foo") → generates "_foo", "_foo2", "_foo3", ...
        let base = name.trim_start_matches('_');
        let mut uid = format!("_{}", base);
        let mut i = 2;
        while self.known_referenced_names.contains(&uid) {
            uid = format!("_{}{}", base, i);
            i += 1;
        }
        self.known_referenced_names.insert(uid.clone());
        uid
    }

    /// Add the memo cache import (the `c` function from the compiler runtime).
    pub(crate) fn add_memo_cache_import(&mut self, host: &mut dyn Host) -> NonLocalImportSpecifier {
        self.add_import_specifier(host, self.react_runtime_module, "c", Some("_c"))
    }

    /// Add an import specifier, reusing an existing one if it was already added.
    ///
    /// If `name_hint` is provided, it will be used as the basis for the local
    /// name; otherwise `specifier` is used.
    pub(crate) fn add_import_specifier(
        &mut self,
        host: &mut dyn Host,
        module: &'static str,
        specifier: &'static str,
        name_hint: Option<&str>,
    ) -> NonLocalImportSpecifier {
        // Check if already imported
        if let Some(module_imports) = self.imports.get(&module) {
            if let Some(existing) = module_imports.get(&specifier) {
                return *existing;
            }
        }

        let name = self.new_uid(name_hint.unwrap_or(specifier));
        let name_ref = host.new_import_item(name.as_bytes());
        let binding = NonLocalImportSpecifier {
            name_ref,
            imported: specifier,
        };

        self.imports
            .entry(module)
            .or_default()
            .insert(specifier, binding);

        binding
    }

    /// Register a name as referenced so future uid generation avoids it.
    pub(crate) fn add_new_reference(&mut self, name: String) {
        self.known_referenced_names.insert(name);
    }

    /// Get the set of known referenced names for seeding per-function Environment UID generation.
    pub(crate) fn known_referenced_names(&self) -> &IndexSet<String> {
        &self.known_referenced_names
    }

    /// Merge UID names generated during a function compilation back into the program context,
    /// so subsequent function compilations avoid collisions.
    pub(crate) fn merge_uid_known_names(&mut self, names: &IndexSet<String>) {
        self.known_referenced_names.extend(names.iter().cloned());
    }
}

/// Check for blocklisted import modules.
/// Returns a CompilerError if any blocklisted imports are found.
pub(crate) fn validate_restricted_imports(
    import_records: &[ImportRecord],
    blocklisted: &Option<Vec<String>>,
) -> Option<CompilerError> {
    let blocklisted = match blocklisted {
        Some(b) if !b.is_empty() => b,
        _ => return None,
    };
    let restricted: IndexSet<&[u8]> = blocklisted.iter().map(|s| s.as_bytes()).collect();
    let mut error = CompilerError::new();

    for import in import_records {
        // Upstream matches `Statement::ImportDeclaration` only; require()/import()/
        // parser-injected runtime records must not trip the blocklist.
        if import.kind != ImportKind::Stmt {
            continue;
        }
        if restricted.contains(&import.path.text) {
            let mut detail = CompilerErrorDetail::new(
                ErrorCategory::Todo,
                "Bailing out due to blocklisted import",
            )
            .with_description(format!(
                "Import from module {}",
                bun_core::BStr::new(import.path.text)
            ));
            detail.loc = convert_loc(import.range.loc);
            error.push_error_detail(detail);
        }
    }

    if error.has_any_errors() {
        Some(error)
    } else {
        None
    }
}

fn convert_loc(loc: Loc) -> Option<SourceLocation> {
    if loc.start < 0 {
        return None;
    }
    let pos = Position {
        line: 0,
        column: 0,
        index: Some(loc.start as u32),
    };
    Some(SourceLocation {
        start: pos,
        end: pos,
    })
}

/// Insert import declarations into the program body.
///
/// Upstream's merge-into-existing-import and `require()` branches are dropped:
/// each pending module becomes one new `S::Import` prepended to `stmts`, with
/// its `ImportRecord` registered via `host.add_import_record`. Emitting a second
/// import statement for an already-imported module is valid JS; the bundler's
/// linker (not the printer) merges import records when bundling.
pub(crate) fn add_imports_to_program(
    stmts: &mut Vec<Stmt>,
    host: &mut dyn Host,
    context: &ProgramContext,
) {
    if context.imports.is_empty() {
        return;
    }

    let mut new_stmts: Vec<Stmt> = Vec::new();
    let mut sorted_modules: Vec<_> = context.imports.iter().collect();
    sorted_modules.sort_unstable_by(|(a, _), (b, _)| {
        a.bytes()
            .map(|c| c.to_ascii_lowercase())
            .cmp(b.bytes().map(|c| c.to_ascii_lowercase()))
    });

    for (module_name, imports_map) in sorted_modules {
        let sorted_imports = {
            let mut sorted: Vec<_> = imports_map.values().collect();
            sorted.sort_unstable_by_key(|s| s.imported);
            sorted
        };

        let (import_record_index, namespace_ref) =
            host.add_import_record(module_name.as_bytes(), ImportKind::Stmt);

        let mut items: AstVec<ClauseItem> = AstAlloc::vec_with_capacity(sorted_imports.len());
        for spec in &sorted_imports {
            items.push(make_import_specifier(spec));
        }

        new_stmts.push(Stmt::alloc(
            S::Import {
                namespace_ref,
                default_name: None,
                items: StoreSlice::new_mut(items.leak()),
                star_name_loc: Loc::EMPTY,
                import_record_index,
                is_single_line: true,
                phase_defer: false,
            },
            Loc::EMPTY,
        ));
    }

    // Prepend new import statements to the program body
    if !new_stmts.is_empty() {
        new_stmts.append(stmts);
        *stmts = new_stmts;
    }
}

/// Create a `ClauseItem` AST node from a NonLocalImportSpecifier.
fn make_import_specifier(spec: &NonLocalImportSpecifier) -> ClauseItem {
    ClauseItem {
        alias: arena_str(spec.imported.as_bytes()),
        alias_loc: Loc::EMPTY,
        name: LocRef {
            loc: Loc::EMPTY,
            ref_: spec.name_ref,
        },
        original_name: StoreStr::EMPTY,
    }
}

fn arena_str(bytes: &[u8]) -> StoreStr {
    let mut v: AstVec<u8> = AstAlloc::vec_with_capacity(bytes.len());
    v.extend_from_slice(bytes);
    StoreStr::new(v.leak())
}

/// Check if a name follows the React hook naming convention (use[A-Z0-9]...).
fn is_hook_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    bytes.len() >= 4
        && bytes[0] == b'u'
        && bytes[1] == b's'
        && bytes[2] == b'e'
        && bytes
            .get(3)
            .is_some_and(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
}

/// Get the runtime module name based on the compiler target.
///
/// Upstream's `CompilerTarget::MetaInternal { runtime_module }` arm is
/// intentionally not ported — `ReactCompilerOptions.target` only accepts a
/// version string.
fn get_react_compiler_runtime_module(target: Option<&str>) -> &'static str {
    match target {
        Some("19") => "react/compiler-runtime",
        Some("17") | Some("18") => "react-compiler-runtime",
        // Default to React 19 runtime for unrecognized versions
        _ => "react/compiler-runtime",
    }
}
