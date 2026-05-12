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
use bun_ast::{ImportKind, ImportRecord, import_record};
use bun_ast::{Loc, Log, Range, Source};
use bun_collections::VecExt;
use bun_core::Output;
use bun_core::{MutableString, strings};

use bun_ast as js_ast;
use bun_ast::ast_result::{NamedExports, NamedImports, TopLevelSymbolToParts};
use bun_ast::b::B;
use bun_ast::base::{RefInt, RefTag};
use bun_ast::expr::IntoExprData;
use bun_ast::scope::Kind as ScopeKind;
use bun_ast::stmt::StatementData;
use bun_ast::symbol::{self, Kind as SymbolKind};
use bun_ast::{
    Binding, ClauseItem, DeclaredSymbol, DeclaredSymbolList, ExportsKind, Expr, LocRef,
    NamedExport, Part, PartList, PartSymbolUseMap, Scope, Stmt, Symbol,
};
use bun_ast::{E, G, S};
use bun_js_parser as js_parser;

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
    pub fn options(&self) -> js_parser::parse::parse_entry::Options<'static> {
        js_parser::parse::parse_entry::Options {
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

    pub fn init(bump: &'bump Bump, source: &'a Source, hot_reloading: bool) -> Result<Self, OOM> {
        let scope: *mut Scope = bump.alloc(Scope {
            kind: ScopeKind::Entry,
            label_ref: None,
            parent: None,
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
            module_ref: Ref::NONE,  // overwritten below (Zig: undefined)
            hmr_api_ref: Ref::NONE, // overwritten below (Zig: undefined)
        };
        ab.module_ref = ab.new_symbol(SymbolKind::Other, b"module")?;
        ab.hmr_api_ref = ab.new_symbol(SymbolKind::Other, b"hmr")?;
        Ok(ab)
    }

    /// Exclusive borrow of the bump-arena `Scope` that `current_scope` points
    /// at. Centralizes the `unsafe { &mut *self.current_scope }` deref so the
    /// invariant is stated once.
    ///
    /// SAFETY (encapsulated): `current_scope` is set to a live `bump.alloc`
    /// allocation in [`init`](Self::init) / [`push_scope`](Self::push_scope)
    /// and is never null afterwards. All other copies of this pointer (in
    /// `self.scopes` and child `Scope.parent` links) are stored as raw
    /// pointers / `StoreRef`s and are never dereferenced while a `&mut self`
    /// borrow is held, so the returned `&mut Scope` is unique for its lifetime.
    #[inline]
    pub fn current_scope_mut(&mut self) -> &mut Scope {
        debug_assert!(
            !self.current_scope.is_null(),
            "AstBuilder.current_scope read before init()"
        );
        // SAFETY: see fn doc — non-null bump-arena slot, exclusively borrowed
        // through `&mut self`.
        unsafe { &mut *self.current_scope }
    }

    // PORT NOTE: Zig signature lacks `!` but body uses `try` — porting as fallible.
    pub fn push_scope(&mut self, kind: ScopeKind) -> Result<*mut Scope, OOM> {
        self.scopes.reserve(1);
        self.current_scope_mut().children.ensure_unused_capacity(1);
        let scope: *mut Scope = self.bump.alloc(Scope {
            kind,
            label_ref: None,
            parent: NonNull::new(self.current_scope).map(bun_ast::StoreRef::from),
            ..Default::default()
        });
        // `scope` came from `bump.alloc`, so it is non-null and distinct from
        // `current_scope` (fresh allocation).
        self.current_scope_mut()
            .children
            .append_assume_capacity(NonNull::new(scope).expect("bump alloc non-null").into());
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
            original_name: bun_ast::StoreStr::new(identifier),
            ..Default::default()
        });
        let ref_ = Ref::new(inner_index, self.source_index, RefTag::Symbol);
        self.current_scope_mut().generated.push(ref_);
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
        Ok(u32::try_from(index).expect("int cast"))
    }

    pub fn add_import_stmt<const N: usize>(
        &mut self,
        path: &'static [u8],
        identifiers_to_import: [&'static [u8]; N],
    ) -> Result<[Expr; N], OOM> {
        let mut out: [MaybeUninit<Expr>; N] = [const { MaybeUninit::uninit() }; N];

        let record = self.add_import_record(path, ImportKind::Stmt)?;

        let path_name = PathName::init(path);
        let non_unique =
            MutableString::ensure_valid_identifier(path_name.non_unique_name_string_base())?;
        let name = strings::append(b"import_", &non_unique);
        // PORT NOTE: copy into the arena so the raw `*const [u8]` stored on the
        // Symbol outlives this stack frame (Zig used the parser arena arena).
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
                    alias: bun_ast::StoreStr::new(import_id),
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
                original_name: bun_ast::StoreStr::new(import_id),
                alias: bun_ast::StoreStr::new(import_id),
                alias_loc: Loc::EMPTY,
            };
        }

        self.append_stmt(S::Import {
            namespace_ref,
            import_record_index: record,
            items: bun_ast::StoreSlice::new_mut(clauses),
            is_single_line: N < 1,
            ..Default::default()
        })?;

        // SAFETY: every element of `out` was written in the loop above (loop
        // runs exactly N times). `Expr` is `Copy`, so by-value `assume_init`
        // per element is equivalent to `MaybeUninit::array_assume_init`.
        Ok(out.map(|e| unsafe { e.assume_init() }))
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

    // PORT NOTE: returns `BundledAst<'static>` (== `JSAst`) directly. The only
    // `'arena`-carrying field, `url_for_css`, is always set to `b""` here, and
    // every other field stores arena data via raw pointers / `StoreSlice`, so
    // nothing borrows `&mut self` past this call.
    pub fn to_bundled_ast(
        &mut self,
        target: options::Target,
    ) -> Result<crate::BundledAst<'static>, OOM> {
        // TODO: missing import scanner
        debug_assert!(self.scopes.is_empty());
        let module_scope = self.current_scope;

        let mut parts = PartList::init_capacity(2);
        // PORT NOTE: Zig grew len then wrote `parts.mut(i).* = ...`, which is a
        // bitwise store on the SoA slot. In Rust `*parts.mut_(i) = ...` first
        // *drops* the (uninitialized) prior `Part` — and `Part` carries Drop
        // fields (`Vec`/`HashMap`), so that drop frees garbage and corrupts the
        // heap (observed downstream as `printStmt` reading a junk `Stmt`
        // discriminant from an arena allocation that was clobbered). Append
        // into the reserved capacity instead so no drop runs.
        parts.append_assume_capacity(Part::default());
        parts.append_assume_capacity(Part {
            // overwritten below with the arena-backed copy (`stmts_in_bump`)
            stmts: bun_ast::StoreSlice::EMPTY,
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
        });

        let mut top_level_symbols_to_parts = TopLevelSymbolToParts::default();
        // SAFETY: module_scope is a live arena allocation (set in init, scopes stack is empty)
        let module_scope_ref = unsafe { &*module_scope };
        let generated_len = module_scope_ref.generated.len();
        top_level_symbols_to_parts.ensure_total_capacity(generated_len)?;
        // PORT NOTE: reshaped — Zig grew `entries` then wrote keys/values columns
        // in lockstep + `reIndex`. Rust `ArrayHashMap` keeps keys/values in private
        // `Vec`s and rebuilds hashes on every `put_assume_capacity`, so a plain
        // pre-reserved insert loop is equivalent (and `re_index` is a no-op here).
        // Zig shallow-copied a single `Vec(u32){1}`; `Vec` is move-only
        // in Rust, so allocate a fresh one per key.
        for &ref_ in module_scope_ref.generated.slice() {
            top_level_symbols_to_parts.put_assume_capacity(ref_, Vec::<u32>::from_slice(&[1]));
        }
        top_level_symbols_to_parts.re_index()?;

        // For more details on this section, look at js_parser.toAST
        // This is mimicking how it calls ImportScanner
        //
        // PORT NOTE: Zig duck-typed `ImportScanner.scan(AstBuilder, ...)` and
        // `ConvertESMExportsForHmr.{convertStmt,finalize}` over `AstBuilder`
        // via `anytype`. The Rust `ImportScanner` is currently monomorphized
        // over the concrete `P<'_, TS, J, SCAN>` parser only (see
        // ImportScanner.rs:30), so the equivalent transform is open-coded here
        // for the stmt shapes `AstBuilder` callers actually emit (`S.Import`,
        // `S.Local{is_export}`, `S.ExportDefault(expr)`). Without this, the
        // generated server-component proxy keeps raw `export` keywords inside
        // the HMR function wrapper and JSC rejects the chunk with
        // `SyntaxError: Unexpected keyword 'export'`.
        // TODO(b2-ast-E): replace with a `ParserLike` trait so the real
        // `ImportScanner`/`ConvertESMExportsForHmr` can accept `AstBuilder`.
        //
        // PORT NOTE: Zig assigned `p.stmts.items` directly — its
        // `ArrayListUnmanaged` storage is owned by `worker.allocator` and
        // outlives the `AstBuilder` stack value. Rust's `Vec<Stmt>` would
        // drop with `self`, leaving `parts[1].stmts` dangling once the
        // builder goes out of scope (UAF in the printer). Copy the `Copy`
        // `Stmt`s/`*mut Scope`s into the bump arena so the returned
        // `BundledAst` owns them with parser-arena lifetime.
        if self.hot_reloading {
            // get a estimate on how many statements there are going to be
            let prealloc_count = self.stmts.len() + 2;
            let mut hmr_stmts: Vec<Stmt> = Vec::with_capacity(prealloc_count);
            let mut export_props: Vec<G::Property> = Vec::new();

            // Walk the input stmts once, mirroring what `ImportScanner.scan`
            // (with `hot_module_reloading_transformations=true`) followed by
            // `ConvertESMExportsForHmr.convertStmt` would do for each shape.
            let in_stmts = core::mem::take(&mut self.stmts);
            for stmt in in_stmts.iter() {
                match stmt.data {
                    bun_ast::StmtData::SImport(st) => {
                        // ImportScanner: track the record + named_imports for
                        // each clause item so the linker can bind symbols.
                        self.import_records_for_current_part
                            .push(st.import_record_index);
                        for item in st.items.slice() {
                            let ref_ = item.name.ref_.expect("infallible: ref bound");
                            self.named_imports.put(
                                ref_,
                                bun_ast::NamedImport {
                                    alias: Some(item.alias),
                                    alias_loc: Some(item.alias_loc),
                                    namespace_ref: Some(st.namespace_ref),
                                    import_record_index: st.import_record_index,
                                    alias_is_star: false,
                                    is_exported: false,
                                    local_parts_with_uses: Default::default(),
                                },
                            )?;
                        }
                        // convertStmt: `deduplicatedImport` is a no-op for
                        // AstBuilder (each generated file emits at most one
                        // import per record), so just forward the stmt.
                        hmr_stmts.push(*stmt);
                    }
                    bun_ast::StmtData::SLocal(mut st) if st.is_export => {
                        // convertStmt: strip `export`, then visitBindingToExport
                        // for each decl. AstBuilder only emits `B.Identifier`
                        // bindings with `kind != .import` and
                        // `has_been_assigned_to == false`, so the simple
                        // `'abc,'` arm of visitRefToExport applies.
                        st.is_export = false;
                        for i in 0..st.decls.len_u32() as usize {
                            let binding = st.decls.slice()[i].binding;
                            if let B::BIdentifier(id) = binding.data {
                                let ref_ = id.r#ref;
                                let original_name =
                                    self.symbols[ref_.inner_index() as usize].original_name;
                                // ImportScanner.recordExportedBinding → recordExport
                                self.record_export(binding.loc, original_name.slice(), ref_)?;
                                export_props.push(G::Property {
                                    key: Some(Expr::init(
                                        E::String::init(original_name.slice()),
                                        binding.loc,
                                    )),
                                    value: Some(Expr::init_identifier(ref_, binding.loc)),
                                    ..Default::default()
                                });
                            }
                        }
                        hmr_stmts.push(*stmt);
                    }
                    bun_ast::StmtData::SExportDefault(st) => {
                        // ImportScanner: recordExport("default", default_name.ref)
                        let default_ref = st.default_name.ref_.expect("infallible: ref bound");
                        self.record_export(st.default_name.loc, b"default", default_ref)?;
                        // convertStmt: AstBuilder only emits the `.expr` arm
                        // (`registerClientReference(...)`), which is not
                        // `canBeMoved()` — generate a temp const binding and
                        // reference it from `export_props`.
                        // SAFETY: `StmtOrExpr` lives in the arena; bitwise read
                        // matches Zig's value copy (no Drop fields touched).
                        let value = unsafe { core::ptr::read(&raw const st.value) }.to_expr();
                        let temp_id = self.generate_temp_ref(Some(b"default_export"));
                        parts.mut_(1).declared_symbols.append(DeclaredSymbol {
                            ref_: temp_id,
                            is_top_level: true,
                        })?;
                        parts
                            .mut_(1)
                            .symbol_uses
                            .put(temp_id, symbol::Use { count_estimate: 1 })?;
                        VecExt::append(&mut self.current_scope_mut().generated, temp_id);
                        export_props.push(G::Property {
                            key: Some(Expr::init(E::String::init(b"default"), stmt.loc)),
                            value: Some(Expr::init_identifier(temp_id, stmt.loc)),
                            ..Default::default()
                        });
                        hmr_stmts.push(Stmt::alloc(
                            S::Local {
                                kind: S::Kind::KConst,
                                decls: G::DeclList::from_slice(&[G::Decl {
                                    binding: Binding::alloc(
                                        self.bump,
                                        bun_ast::b::Identifier { r#ref: temp_id },
                                        stmt.loc,
                                    ),
                                    value: Some(value),
                                }]),
                                ..Default::default()
                            },
                            stmt.loc,
                        ));
                    }
                    _ => hmr_stmts.push(*stmt),
                }
            }

            // ConvertESMExportsForHmr.finalize:
            if !export_props.is_empty() {
                // `hmr.exports = { ... };`
                hmr_stmts.push(Stmt::alloc(
                    S::SExpr {
                        value: Expr::assign(
                            Expr::init(
                                E::Dot {
                                    target: Expr::init_identifier(self.hmr_api_ref, Loc::EMPTY),
                                    name: b"exports".into(),
                                    name_loc: Loc::EMPTY,
                                    ..Default::default()
                                },
                                Loc::EMPTY,
                            ),
                            Expr::init(
                                E::Object {
                                    properties: G::PropertyList::move_from_list(export_props),
                                    ..Default::default()
                                },
                                Loc::EMPTY,
                            ),
                        ),
                        ..Default::default()
                    },
                    Loc::EMPTY,
                ));
                // mark a dependency on module_ref so it is renamed
                parts
                    .mut_(1)
                    .symbol_uses
                    .put(self.module_ref, symbol::Use { count_estimate: 1 })?;
                parts.mut_(1).declared_symbols.append(DeclaredSymbol {
                    ref_: self.module_ref,
                    is_top_level: true,
                })?;
            }
            // Head-part bookkeeping (only `parts[0]`, which is the empty
            // namespace-export part): mark dead and depend on `parts[1]`.
            parts.mut_(0).tag = bun_ast::PartTag::DeadDueToInlining;
            parts.mut_(0).dependencies.push(bun_ast::Dependency {
                part_index: 1,
                source_index: bun_ast::Index(self.source_index),
            });

            let stmts_in_bump: &mut [Stmt] = self.bump.alloc_slice_copy(hmr_stmts.as_slice());
            parts.mut_(1).stmts = bun_ast::StoreSlice::new_mut(stmts_in_bump);
        } else {
            // Non-HMR path: mirror `ImportScanner.scan(AstBuilder, p, stmts,
            // false, false, {})` for the stmt shapes AstBuilder callers emit
            // (`S.Import`, `S.Local{is_export}`, `S.ExportDefault`). The Zig
            // duck-typed scanner is what populates `named_exports` /
            // `named_imports` / `import_records_for_current_part`; without it
            // the linker can't bind imports against this generated module
            // (e.g. `import { ssrManifest } from "bun:bake/server"` →
            // "No matching export"). See PORT NOTE above re: monomorphization.
            let in_stmts = core::mem::take(&mut self.stmts);
            for stmt in in_stmts.iter() {
                match stmt.data {
                    bun_ast::StmtData::SImport(st) => {
                        self.import_records_for_current_part
                            .push(st.import_record_index);
                        for item in st.items.slice() {
                            let ref_ = item.name.ref_.expect("infallible: ref bound");
                            self.named_imports.put(
                                ref_,
                                bun_ast::NamedImport {
                                    alias: Some(item.alias),
                                    alias_loc: Some(item.name.loc),
                                    namespace_ref: Some(st.namespace_ref),
                                    import_record_index: st.import_record_index,
                                    alias_is_star: false,
                                    is_exported: false,
                                    local_parts_with_uses: Default::default(),
                                },
                            )?;
                        }
                    }
                    bun_ast::StmtData::SLocal(st) if st.is_export => {
                        for i in 0..st.decls.len_u32() as usize {
                            let binding = st.decls.slice()[i].binding;
                            self.record_exported_binding(binding);
                        }
                    }
                    bun_ast::StmtData::SExportDefault(st) => {
                        let default_ref = st.default_name.ref_.expect("infallible: ref bound");
                        self.record_export(st.default_name.loc, b"default", default_ref)?;
                    }
                    _ => {}
                }
            }
            let stmts_in_bump: &mut [Stmt] = self.bump.alloc_slice_copy(in_stmts.as_slice());
            parts.mut_(1).stmts = bun_ast::StoreSlice::new_mut(stmts_in_bump);
        }

        parts.mut_(1).declared_symbols = core::mem::take(&mut self.declared_symbols);
        parts.mut_(1).scopes =
            bun_ast::StoreSlice::new_mut(self.bump.alloc_slice_copy(self.scopes.as_slice()));
        parts.mut_(1).import_record_indices =
            Vec::<u32>::move_from_list(core::mem::take(&mut self.import_records_for_current_part));

        // SAFETY: module_scope is a live arena allocation. `Scope` is no-Drop
        // arena POD; Zig bitwise-copied it (`module_scope.*`).
        let module_scope_value: Scope = unsafe { core::ptr::read(module_scope) };

        Ok(crate::BundledAst {
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
            char_freq: bun_ast::CharFreq { freqs: [0; 64] },
            flags: Default::default(),
            target,
            top_level_await_keyword: Range::NONE,
            // .nested_scope_slot_counts = if (p.options.features.minify_identifiers)
            //     renamer.assignNestedScopeSlots(p.arena, p.scopes.items[0], p.symbols.items)
            // else
            //     js_ast.SlotCounts{},
            nested_scope_slot_counts: Default::default(),
            hashbang: b"".into(),
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
                // PORT NOTE: reshaped for borrowck — capture original_name before calling &mut self method
                let original_name = self.symbols[ident.r#ref.inner_index() as usize].original_name;
                self.record_export(binding.loc, original_name.slice(), ident.r#ref)
                    .expect("unreachable");
            }
            B::BArray(array) => {
                for prop in array.items() {
                    self.record_exported_binding(prop.binding);
                }
            }
            B::BObject(obj) => {
                for prop in obj.properties() {
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
            name: b"exports".into(),
            name_loc: loc,
            target: self.new_expr(E::Identifier {
                ref_: self.module_ref,
                ..Default::default()
            }),
            ..Default::default()
        })
    }
}

use bun_ast::Ref;

use bun_ast::Index;

pub use crate::DeferredBatchTask::DeferredBatchTask;
pub use crate::ParseTask;
pub use crate::ThreadPool;

// ported from: src/bundler/AstBuilder.zig
