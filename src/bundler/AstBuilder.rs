//! Utility to construct `Ast`s intended for generated code, such as the
//! boundary modules when dealing with server components. This is a saner
//! alternative to building a string, then sending it through `js_parser`
//!
//! For in-depth details on the fields, most of these are documented
//! inside of `js_parser`

use core::mem::MaybeUninit;
use core::ptr::NonNull;

use bun_alloc::Arena as Bump;

use bun_alloc::AllocError as OOM;
use bun_collections::BabyList;
use bun_core::Output;
use bun_logger as logger;
use bun_logger::{Loc, Log, Range, Source};
use bun_options_types::{import_record, ImportKind, ImportRecord};
use bun_string::{strings, MutableString};

use bun_js_parser as js_ast;
use bun_js_parser::ast::ast::{NamedExports, NamedImports, TopLevelSymbolToParts};
use bun_js_parser::ast::base::{RefInt, RefTag};
use bun_js_parser::ast::expr::IntoExprData;
use bun_js_parser::ast::scope::Kind as ScopeKind;
use bun_js_parser::ast::stmt::StatementData;
use bun_js_parser::ast::symbol::{self, Kind as SymbolKind};
use bun_js_parser::ast::{E, G, S};
use bun_js_parser::{
    self as js_parser, Binding, ClauseItem, DeclaredSymbol, DeclaredSymbolList, Expr, ExportsKind,
    LocRef, NamedExport, Part, PartList, PartSymbolUseMap, Scope, Stmt, Symbol, B,
};

use crate::options;

use bun_paths::fs::{Path as FsPath, PathName};

pub struct AstBuilder<'a, 'bump> {
    pub bump: &'bump Bump,
    pub source: &'a Source,
    pub source_index: u32, // Zig: u31
    pub stmts: Vec<Stmt>,
    pub scopes: Vec<*mut Scope>,
    pub symbols: Vec<Symbol>,
    pub import_records: Vec<ImportRecord>,
    pub named_imports: NamedImports,
    pub named_exports: NamedExports,
    pub import_records_for_current_part: Vec<u32>,
    pub export_star_import_records: Vec<u32>,
    pub current_scope: *mut Scope,
    pub log: Log,
    pub module_ref: Ref,
    pub declared_symbols: DeclaredSymbolList,
    /// When set, codegen is altered
    pub hot_reloading: bool,
    pub hmr_api_ref: Ref,
}

// stub fields for ImportScanner duck typing
//
// Zig used `comptime` zero-sized fields (`options`, `import_items_for_namespace`)
// and a `parser_features` decl so `ImportScanner.scan` could duck-type over both
// the real parser and `AstBuilder`. In Rust this becomes a trait that both impl.
// TODO(b2-ast-E): define `ImportScannerHost` trait in `bun_js_parser` and impl it here.
pub mod parser_features {
    pub const TYPESCRIPT: bool = false;
}

impl<'a, 'bump> AstBuilder<'a, 'bump> {
    // stub for ImportScanner duck typing — Zig: `comptime options: js_parser.Parser.Options = .{ .jsx = .{}, .bundle = true }`
    // TODO(b2-ast-E): expose as trait assoc const once `ImportScannerHost` exists
    pub fn options(&self) -> js_parser::ast::parser_entry::Options<'static> {
        js_parser::ast::parser_entry::Options {
            jsx: Default::default(),
            bundle: true,
            ..Default::default()
        }
    }

    // stub for ImportScanner duck typing — Zig: `comptime import_items_for_namespace: struct { fn get(_, _) ?Map { return null; } }`
    pub fn import_items_for_namespace_get(
        &self,
        _ref: Ref,
    ) -> Option<&js_parser::parser::ImportItemForNamespaceMap> {
        None
    }

    pub fn init(
        bump: &'bump Bump,
        source: &'a Source,
        hot_reloading: bool,
    ) -> Result<Self, OOM> {
        let scope: *mut Scope = bump.alloc(Scope {
            kind: ScopeKind::Entry,
            label_ref: None,
            parent: None,
            generated: Default::default(),
            ..Default::default()
        });
        let mut ab = AstBuilder {
            bump,
            current_scope: scope,
            source,
            source_index: source.index.0,
            stmts: Vec::new(),
            scopes: Vec::new(),
            symbols: Vec::new(),
            import_records: Vec::new(),
            import_records_for_current_part: Vec::new(),
            named_imports: Default::default(),
            named_exports: Default::default(),
            log: Log::init(),
            export_star_import_records: Vec::new(),
            declared_symbols: Default::default(),
            hot_reloading,
            module_ref: Ref::NONE, // overwritten below (Zig: undefined)
            hmr_api_ref: Ref::NONE, // overwritten below (Zig: undefined)
        };
        ab.module_ref = ab.new_symbol(SymbolKind::Other, b"module")?;
        ab.hmr_api_ref = ab.new_symbol(SymbolKind::Other, b"hmr")?;
        Ok(ab)
    }

    // PORT NOTE: Zig signature lacks `!` but body uses `try` — porting as fallible.
    pub fn push_scope(&mut self, kind: ScopeKind) -> Result<*mut Scope, OOM> {
        self.scopes.reserve(1);
        // SAFETY: `current_scope` is a live bump-arena allocation (set in `init`/`push_scope`)
        // and is uniquely accessed here — other copies of this pointer (in `self.scopes`
        // / child `parent` links) are raw and not dereferenced for the duration of this
        // temporary `&mut`.
        unsafe { &mut *self.current_scope }
            .children
            .ensure_unused_capacity(1)?;
        let scope: *mut Scope = self.bump.alloc(Scope {
            kind,
            label_ref: None,
            parent: NonNull::new(self.current_scope),
            generated: Default::default(),
            ..Default::default()
        });
        // SAFETY: `current_scope` is a live bump-arena allocation and uniquely accessed
        // here (the prior `&mut` temporary above has ended; `scope` points to a distinct
        // fresh allocation). `scope` came from `bump.alloc`, so it is non-null.
        unsafe { &mut *self.current_scope }
            .children
            .append_assume_capacity(unsafe { NonNull::new_unchecked(scope) });
        self.scopes.push(self.current_scope);
        // PERF(port): was appendAssumeCapacity — profile in Phase B
        self.current_scope = scope;
        Ok(scope)
    }

    pub fn pop_scope(&mut self) {
        self.current_scope = self.scopes.pop().unwrap();
    }

    pub fn new_symbol(&mut self, kind: SymbolKind, identifier: &[u8]) -> Result<Ref, OOM> {
        let inner_index: RefInt = RefInt::try_from(self.symbols.len()).unwrap();
        self.symbols.push(Symbol {
            kind,
            original_name: identifier as *const [u8],
            ..Default::default()
        });
        let ref_ = Ref::new(inner_index, self.source_index, RefTag::Symbol);
        // SAFETY: `current_scope` is a live bump-arena allocation (set in `init`/`push_scope`)
        // and uniquely accessed here — `self.symbols` / `self.declared_symbols` are
        // disjoint from the arena `Scope`, and no other `&`/`&mut` to this `Scope` is live.
        unsafe { &mut *self.current_scope }
            .generated
            .append(ref_)?;
        self.declared_symbols.append(DeclaredSymbol {
            ref_,
            is_top_level: self.scopes.is_empty()
                || core::ptr::eq(self.current_scope, self.scopes[0]),
        })?;
        Ok(ref_)
    }

    pub fn get_symbol(&mut self, ref_: Ref) -> &mut Symbol {
        debug_assert!(ref_.source_index() == self.source.index.0);
        &mut self.symbols[ref_.inner_index() as usize]
    }

    pub fn add_import_record(&mut self, path: &'static [u8], kind: ImportKind) -> Result<u32, OOM> {
        let index = self.import_records.len();
        self.import_records.push(ImportRecord {
            path: FsPath::init(path),
            kind,
            range: Range::default(),
            tag: Default::default(),
            loader: None,
            source_index: Default::default(),
            module_id: 0,
            original_path: b"",
            flags: Default::default(),
        });
        Ok(u32::try_from(index).unwrap())
    }

    pub fn add_import_stmt<const N: usize>(
        &mut self,
        path: &'static [u8],
        identifiers_to_import: [&'static [u8]; N],
    ) -> Result<[Expr; N], OOM> {
        let mut out: [MaybeUninit<Expr>; N] = [const { MaybeUninit::uninit() }; N];

        let record = self.add_import_record(path, ImportKind::Stmt)?;

        let path_name = PathName::init(path);
        let non_unique = MutableString::ensure_valid_identifier(
            path_name.non_unique_name_string_base(),
        )?;
        let name = strings::append(b"import_", &non_unique)?;
        // PORT NOTE: copy into the arena so the raw `*const [u8]` stored on the
        // Symbol outlives this stack frame (Zig used the parser arena allocator).
        let name: &[u8] = self.bump.alloc_slice_copy(&name);
        let namespace_ref = self.new_symbol(SymbolKind::Other, name)?;

        let clauses: &mut [ClauseItem] = self.bump.alloc_slice_fill_default(N);

        // Zig: `inline for` — all elements are `[]const u8`, so a plain loop suffices.
        for ((import_id, out_ref), clause) in identifiers_to_import
            .iter()
            .zip(out.iter_mut())
            .zip(clauses.iter_mut())
        {
            let import_id: &[u8] = *import_id; // must be given '[N][]const u8'
            let ref_ = self.new_symbol(SymbolKind::Import, import_id)?;
            if self.hot_reloading {
                self.get_symbol(ref_).namespace_alias = Some(G::NamespaceAlias {
                    namespace_ref,
                    alias: import_id as *const [u8],
                    import_record_index: record,
                    ..Default::default()
                });
            }
            out_ref.write(self.new_expr(E::ImportIdentifier {
                ref_,
                ..Default::default()
            }));
            *clause = ClauseItem {
                name: LocRef {
                    loc: Loc::EMPTY,
                    ref_: Some(ref_),
                },
                original_name: import_id as *const [u8],
                alias: import_id as *const [u8],
                alias_loc: Loc::EMPTY,
            };
        }

        self.append_stmt(S::Import {
            namespace_ref,
            import_record_index: record,
            items: clauses as *mut [ClauseItem],
            is_single_line: N < 1,
            ..Default::default()
        })?;

        // SAFETY: every element of `out` was written in the loop above (loop runs exactly N times)
        Ok(unsafe { core::mem::transmute_copy::<_, [Expr; N]>(&out) })
        // TODO(port): use `MaybeUninit::array_assume_init` once stable
    }

    pub fn append_stmt<T: StatementData>(&mut self, data: T) -> Result<(), OOM> {
        self.stmts.reserve(1);
        self.stmts.push(self.new_stmt(data));
        // PERF(port): was appendAssumeCapacity — profile in Phase B
        Ok(())
    }

    pub fn new_stmt<T: StatementData>(&self, data: T) -> Stmt {
        Stmt::alloc::<T>(data, Loc::EMPTY)
    }

    pub fn new_expr<T: IntoExprData>(&self, data: T) -> Expr {
        Expr::init::<T>(data, Loc::EMPTY)
    }

    pub fn new_external_symbol(&mut self, name: &[u8]) -> Result<Ref, OOM> {
        let ref_ = self.new_symbol(SymbolKind::Other, name)?;
        let sym = self.get_symbol(ref_);
        sym.must_not_be_renamed = true;
        Ok(ref_)
    }

    pub fn to_bundled_ast(&mut self, target: options::Target) -> Result<js_ast::BundledAst<'_>, OOM> {
        // TODO: missing import scanner
        debug_assert!(self.scopes.is_empty());
        let module_scope = self.current_scope;

        let mut parts = PartList::init_capacity(2)?;
        parts.len = 2;
        *parts.mut_(0) = Part::default();
        *parts.mut_(1) = Part {
            stmts: self.stmts.as_mut_slice() as *mut [Stmt],
            can_be_removed_if_unused: false,

            // pretend that every symbol was used
            symbol_uses: 'uses: {
                let mut map = PartSymbolUseMap::default();
                map.ensure_total_capacity(self.symbols.len())?;
                for i in 0..self.symbols.len() {
                    map.put_assume_capacity(
                        Ref::new(
                            RefInt::try_from(i).unwrap(),
                            self.source_index,
                            RefTag::Symbol,
                        ),
                        symbol::Use { count_estimate: 1 },
                    );
                }
                break 'uses map;
            },
            ..Default::default()
        };

        let mut top_level_symbols_to_parts = TopLevelSymbolToParts::default();
        // SAFETY: module_scope is a live arena allocation (set in init, scopes stack is empty)
        let module_scope_ref = unsafe { &*module_scope };
        let generated_len = module_scope_ref.generated.len as usize;
        top_level_symbols_to_parts.ensure_total_capacity(generated_len)?;
        // PORT NOTE: reshaped — Zig grew `entries` then wrote keys/values columns
        // in lockstep + `reIndex`. Rust `ArrayHashMap` keeps keys/values in private
        // `Vec`s and rebuilds hashes on every `put_assume_capacity`, so a plain
        // pre-reserved insert loop is equivalent (and `re_index` is a no-op here).
        // Zig shallow-copied a single `BabyList(u32){1}`; `BabyList` is move-only
        // in Rust, so allocate a fresh one per key.
        for &ref_ in module_scope_ref.generated.slice() {
            top_level_symbols_to_parts
                .put_assume_capacity(ref_, BabyList::<u32>::from_slice(&[1])?);
        }
        top_level_symbols_to_parts.re_index()?;

        // For more details on this section, look at js_parser.toAST
        // This is mimicking how it calls ImportScanner
        //
        // TODO(b2-ast-E): `ImportScanner::scan` / `ConvertESMExportsForHmr` are
        // currently monomorphized over the concrete `P<'_, TS, J, SCAN>` parser
        // (see ImportScanner.rs:30). The Zig accepted `AstBuilder` via `anytype`
        // duck-typing; Rust needs a `ParserLike` trait first. Until that lands,
        // bypass the scan and use `self.stmts` directly — matches the
        // "TODO: missing import scanner" intent above.
        if self.hot_reloading {
            // get a estimate on how many statements there are going to be
            let _prealloc_count = self.stmts.len() + 2;
            // PORT NOTE: HMR transform deferred until ImportScanner accepts AstBuilder.
            parts.mut_(1).stmts = self.stmts.as_mut_slice() as *mut [Stmt];
        } else {
            parts.mut_(1).stmts = self.stmts.as_mut_slice() as *mut [Stmt];
        }

        parts.mut_(1).declared_symbols = core::mem::take(&mut self.declared_symbols);
        parts.mut_(1).scopes = self.scopes.as_mut_slice() as *mut [*mut Scope];
        parts.mut_(1).import_record_indices = BabyList::<u32>::move_from_list(
            core::mem::take(&mut self.import_records_for_current_part),
        );

        // SAFETY: module_scope is a live arena allocation. `Scope` is no-Drop
        // arena POD; Zig bitwise-copied it (`module_scope.*`).
        let module_scope_value: Scope = unsafe { core::ptr::read(module_scope) };

        Ok(js_ast::BundledAst {
            parts,
            module_scope: module_scope_value,
            symbols: symbol::List::move_from_list(core::mem::take(&mut self.symbols)),
            exports_ref: Ref::NONE,
            wrapper_ref: Ref::NONE,
            module_ref: self.module_ref,
            import_records: import_record::List::move_from_list(core::mem::take(
                &mut self.import_records,
            )),
            export_star_import_records: Box::default(),
            approximate_newline_count: 1,
            exports_kind: ExportsKind::Esm,
            named_imports: core::mem::take(&mut self.named_imports),
            named_exports: core::mem::take(&mut self.named_exports),
            top_level_symbols_to_parts,
            char_freq: js_ast::ast::CharFreq { freqs: [0; 64] },
            flags: Default::default(),
            target,
            top_level_await_keyword: Range::NONE,
            // .nested_scope_slot_counts = if (p.options.features.minify_identifiers)
            //     renamer.assignNestedScopeSlots(p.allocator, p.scopes.items[0], p.symbols.items)
            // else
            //     js_ast.SlotCounts{},
            nested_scope_slot_counts: Default::default(),
            hashbang: b"",
            css: None,
            url_for_css: b"",
            require_ref: Ref::NONE,
            tla_check: Default::default(),
            commonjs_named_exports: Default::default(),
            redirect_import_record_index: u32::MAX,
            ts_enums: Default::default(),
        })
    }

    // stub methods for ImportScanner duck typing

    pub fn generate_temp_ref(&mut self, name: Option<&[u8]>) -> Ref {
        self.new_symbol(SymbolKind::Other, name.unwrap_or(b"temp"))
            .expect("OOM")
        // Zig: bun.handleOom — Rust aborts on OOM by default; explicit expect for clarity
    }

    pub fn record_export(&mut self, _loc: Loc, alias: &[u8], ref_: Ref) -> Result<(), OOM> {
        if self.named_exports.get(alias).is_some() {
            // Duplicate exports are an error
            Output::panic(format_args!(
                "In generated file, duplicate export \"{}\"",
                bstr::BStr::new(alias),
            ));
        } else {
            self.named_exports.put(
                alias,
                NamedExport {
                    alias_loc: Loc::EMPTY,
                    ref_,
                },
            )?;
        }
        Ok(())
    }

    pub fn record_exported_binding(&mut self, binding: Binding) {
        match binding.data {
            B::BMissing(_) => {}
            B::BIdentifier(ident) => {
                // SAFETY: arena-owned `*mut B::Identifier` (Phase-A raw ARENA ptr).
                let ident = unsafe { &*ident };
                // PORT NOTE: reshaped for borrowck — capture original_name before calling &mut self method
                let original_name = self.symbols[ident.r#ref.inner_index() as usize].original_name;
                // SAFETY: `original_name` is an arena/static slice stored as raw ptr in Phase A.
                let original_name = unsafe { &*original_name };
                self.record_export(binding.loc, original_name, ident.r#ref)
                    .expect("unreachable");
            }
            B::BArray(array) => {
                // SAFETY: arena-owned `*mut B::Array` (Phase-A raw ARENA ptr).
                let array = unsafe { &*array };
                // SAFETY: arena-owned slice.
                for prop in unsafe { &*array.items } {
                    self.record_exported_binding(prop.binding);
                }
            }
            B::BObject(obj) => {
                // SAFETY: arena-owned `*mut B::Object` (Phase-A raw ARENA ptr).
                let obj = unsafe { &*obj };
                // SAFETY: arena-owned slice.
                for prop in unsafe { &*obj.properties } {
                    self.record_exported_binding(prop.value);
                }
            }
        }
    }

    pub fn ignore_usage(&mut self, _ref: Ref) {}

    pub fn panic(&self, args: core::fmt::Arguments<'_>) -> ! {
        Output::panic(args);
    }

    /// Zig: `@"module.exports"` — Rust identifiers can't contain `.`
    pub fn module_exports(&self, loc: Loc) -> Expr {
        self.new_expr(E::Dot {
            name: b"exports",
            name_loc: loc,
            target: self.new_expr(E::Identifier {
                ref_: self.module_ref,
                ..Default::default()
            }),
            ..Default::default()
        })
    }
}

pub use bun_js_parser::Ref;

pub use bun_js_parser::Index;

pub use crate::DeferredBatchTask::DeferredBatchTask;
pub use crate::ParseTask;
pub use crate::ThreadPool;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/AstBuilder.zig (375 lines)
//   confidence: medium
//   todos:      3
//   notes:      ImportScanner duck-typing (comptime stub fields) needs a Rust trait;
//               `to_bundled_ast` skips scan/HMR-finalize until ImportScanner accepts AstBuilder.
// ──────────────────────────────────────────────────────────────────────────
