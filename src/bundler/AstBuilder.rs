//! Utility to construct `Ast`s intended for generated code, such as the
//! boundary modules when dealing with server components. This is a saner
//! alternative to building a string, then sending it through `js_parser`
//!
//! For in-depth details on the fields, most of these are documented
//! inside of `js_parser`

use core::mem::MaybeUninit;

use bumpalo::collections::Vec as BumpVec;
use bumpalo::Bump;

use bun_alloc::AllocError as OOM;
use bun_collections::BabyList;
use bun_core::Output;
use bun_logger as logger;
use bun_logger::{Loc, Log, Range, Source};
use bun_options_types::{ImportKind, ImportRecord};
use bun_str::strings;

use bun_js_parser as js_ast;
use bun_js_parser::{
    self as js_parser, Binding, ClauseItem, DeclaredSymbol, Expr, Part, Scope, Stmt, Symbol, E, S,
};

use crate::options;

// TODO(port): `bun.fs.Path` / `bun.fs.PathName` — confirm crate path in Phase B
use bun_fs::{Path as FsPath, PathName};

pub struct AstBuilder<'a, 'bump> {
    pub bump: &'bump Bump,
    pub source: &'a Source,
    pub source_index: u32, // Zig: u31
    pub stmts: BumpVec<'bump, Stmt>,
    pub scopes: BumpVec<'bump, *mut Scope>,
    pub symbols: BumpVec<'bump, Symbol>,
    pub import_records: BumpVec<'bump, ImportRecord>,
    pub named_imports: js_ast::ast::NamedImports,
    pub named_exports: js_ast::ast::NamedExports,
    pub import_records_for_current_part: BumpVec<'bump, u32>,
    pub export_star_import_records: BumpVec<'bump, u32>,
    pub current_scope: *mut Scope,
    pub log: Log,
    pub module_ref: Ref,
    pub declared_symbols: js_ast::declared_symbol::List,
    /// When set, codegen is altered
    pub hot_reloading: bool,
    pub hmr_api_ref: Ref,
}

// stub fields for ImportScanner duck typing
//
// Zig used `comptime` zero-sized fields (`options`, `import_items_for_namespace`)
// and a `parser_features` decl so `ImportScanner.scan` could duck-type over both
// the real parser and `AstBuilder`. In Rust this becomes a trait that both impl.
// TODO(port): define `ImportScannerHost` trait in `bun_js_parser` and impl it here.
pub mod parser_features {
    pub const TYPESCRIPT: bool = false;
}

impl<'a, 'bump> AstBuilder<'a, 'bump> {
    // stub for ImportScanner duck typing — Zig: `comptime options: js_parser.Parser.Options = .{ .jsx = .{}, .bundle = true }`
    // TODO(port): expose as trait assoc const once `ImportScannerHost` exists
    pub fn options(&self) -> js_parser::parser::Options {
        js_parser::parser::Options {
            jsx: Default::default(),
            bundle: true,
            ..Default::default()
        }
    }

    // stub for ImportScanner duck typing — Zig: `comptime import_items_for_namespace: struct { fn get(_, _) ?Map { return null; } }`
    pub fn import_items_for_namespace_get(
        &self,
        _ref: Ref,
    ) -> Option<js_parser::ImportItemForNamespaceMap> {
        None
    }

    pub fn init(
        bump: &'bump Bump,
        source: &'a Source,
        hot_reloading: bool,
    ) -> Result<Self, OOM> {
        let scope: *mut Scope = bump.alloc(Scope {
            kind: Scope::Kind::Entry,
            label_ref: None,
            parent: core::ptr::null_mut(),
            generated: Default::default(),
            ..Default::default()
        });
        let mut ab = AstBuilder {
            bump,
            current_scope: scope,
            source,
            source_index: u32::try_from(source.index.get()).unwrap(),
            stmts: BumpVec::new_in(bump),
            scopes: BumpVec::new_in(bump),
            symbols: BumpVec::new_in(bump),
            import_records: BumpVec::new_in(bump),
            import_records_for_current_part: BumpVec::new_in(bump),
            named_imports: Default::default(),
            named_exports: Default::default(),
            log: Log::init(),
            export_star_import_records: BumpVec::new_in(bump),
            declared_symbols: Default::default(),
            hot_reloading,
            module_ref: Ref::NONE, // overwritten below (Zig: undefined)
            hmr_api_ref: Ref::NONE, // overwritten below (Zig: undefined)
        };
        ab.module_ref = ab.new_symbol(Symbol::Kind::Other, b"module")?;
        ab.hmr_api_ref = ab.new_symbol(Symbol::Kind::Other, b"hmr")?;
        Ok(ab)
    }

    // PORT NOTE: Zig signature lacks `!` but body uses `try` — porting as fallible.
    pub fn push_scope(&mut self, kind: Scope::Kind) -> Result<*mut Scope, OOM> {
        self.scopes.reserve(1);
        // SAFETY: current_scope is always a live arena allocation (set in init/push_scope)
        unsafe { &mut *self.current_scope }.children.reserve(1);
        let scope: *mut Scope = self.bump.alloc(Scope {
            kind,
            label_ref: None,
            parent: self.current_scope,
            generated: Default::default(),
            ..Default::default()
        });
        // SAFETY: current_scope is always a live arena allocation
        unsafe { &mut *self.current_scope }.children.push(scope);
        // PERF(port): was appendAssumeCapacity — profile in Phase B
        self.scopes.push(self.current_scope);
        // PERF(port): was appendAssumeCapacity — profile in Phase B
        self.current_scope = scope;
        Ok(scope)
    }

    pub fn pop_scope(&mut self) {
        self.current_scope = self.scopes.pop().unwrap();
    }

    pub fn new_symbol(&mut self, kind: Symbol::Kind, identifier: &[u8]) -> Result<Ref, OOM> {
        let inner_index: Ref::Int = Ref::Int::try_from(self.symbols.len()).unwrap();
        self.symbols.push(Symbol {
            kind,
            original_name: identifier,
            ..Default::default()
        });
        let ref_ = Ref {
            inner_index,
            source_index: self.source_index,
            tag: Ref::Tag::Symbol,
        };
        // SAFETY: current_scope is always a live arena allocation
        unsafe { &mut *self.current_scope }
            .generated
            .push(self.bump, ref_)?;
        self.declared_symbols.push(DeclaredSymbol {
            ref_,
            is_top_level: self.scopes.is_empty()
                || core::ptr::eq(self.current_scope, self.scopes[0]),
        })?;
        Ok(ref_)
    }

    pub fn get_symbol(&mut self, ref_: Ref) -> &mut Symbol {
        debug_assert!(ref_.source_index == self.source.index.get());
        &mut self.symbols[ref_.inner_index as usize]
    }

    pub fn add_import_record(&mut self, path: &[u8], kind: ImportKind) -> Result<u32, OOM> {
        let index = self.import_records.len();
        self.import_records.push(ImportRecord {
            path: FsPath::init(path),
            kind,
            range: Range::default(),
            ..Default::default()
        });
        Ok(u32::try_from(index).unwrap())
    }

    pub fn add_import_stmt<const N: usize>(
        &mut self,
        path: &[u8],
        identifiers_to_import: [&[u8]; N],
    ) -> Result<[Expr; N], OOM> {
        let mut out: [MaybeUninit<Expr>; N] = [const { MaybeUninit::uninit() }; N];

        let record = self.add_import_record(path, ImportKind::Stmt)?;

        let path_name = PathName::init(path);
        let name = strings::append(
            self.bump,
            b"import_",
            path_name.non_unique_name_string(self.bump)?,
        )?;
        let namespace_ref = self.new_symbol(Symbol::Kind::Other, name)?;

        let clauses: &mut [ClauseItem] =
            self.bump.alloc_slice_fill_default(N);
        // TODO(port): bumpalo alloc_slice_* signature — confirm in Phase B

        // Zig: `inline for` — all elements are `[]const u8`, so a plain loop suffices.
        for ((import_id, out_ref), clause) in identifiers_to_import
            .iter()
            .zip(out.iter_mut())
            .zip(clauses.iter_mut())
        {
            let import_id: &[u8] = *import_id; // must be given '[N][]const u8'
            let ref_ = self.new_symbol(Symbol::Kind::Import, import_id)?;
            if self.hot_reloading {
                self.get_symbol(ref_).namespace_alias = Some(js_ast::NamespaceAlias {
                    namespace_ref,
                    alias: import_id,
                    import_record_index: record,
                    ..Default::default()
                });
            }
            out_ref.write(self.new_expr(E::ImportIdentifier { ref_ }));
            *clause = ClauseItem {
                name: js_ast::LocRef {
                    loc: Loc::EMPTY,
                    ref_,
                },
                original_name: import_id,
                alias: import_id,
            };
        }

        self.append_stmt(S::Import {
            namespace_ref,
            import_record_index: record,
            items: clauses,
            is_single_line: N < 1,
            ..Default::default()
        })?;

        // SAFETY: every element of `out` was written in the loop above (loop runs exactly N times)
        Ok(unsafe { core::mem::transmute_copy::<_, [Expr; N]>(&out) })
        // TODO(port): use `MaybeUninit::array_assume_init` once stable
    }

    pub fn append_stmt<T>(&mut self, data: T) -> Result<(), OOM> {
        self.stmts.reserve(1);
        self.stmts.push(self.new_stmt(data));
        // PERF(port): was appendAssumeCapacity — profile in Phase B
        Ok(())
    }

    pub fn new_stmt<T>(&self, data: T) -> Stmt {
        Stmt::alloc::<T>(data, Loc::EMPTY)
    }

    pub fn new_expr<T>(&self, data: T) -> Expr {
        Expr::init::<T>(data, Loc::EMPTY)
    }

    pub fn new_external_symbol(&mut self, name: &[u8]) -> Result<Ref, OOM> {
        let ref_ = self.new_symbol(Symbol::Kind::Other, name)?;
        let sym = self.get_symbol(ref_);
        sym.must_not_be_renamed = true;
        Ok(ref_)
    }

    pub fn to_bundled_ast(&mut self, target: options::Target) -> Result<js_ast::BundledAst, OOM> {
        // TODO: missing import scanner
        debug_assert!(self.scopes.is_empty());
        let module_scope = self.current_scope;

        let mut parts = Part::List::with_capacity(2)?;
        parts.len = 2;
        *parts.mut_(0) = Part::default();
        *parts.mut_(1) = Part {
            stmts: self.stmts.as_slice(),
            can_be_removed_if_unused: false,

            // pretend that every symbol was used
            symbol_uses: 'uses: {
                let mut map = Part::SymbolUseMap::default();
                map.reserve(self.symbols.len())?;
                for i in 0..self.symbols.len() {
                    map.put_assume_capacity(
                        Ref {
                            tag: Ref::Tag::Symbol,
                            source_index: self.source_index,
                            inner_index: Ref::Int::try_from(i).unwrap(),
                        },
                        Part::SymbolUse { count_estimate: 1 },
                    );
                    // PERF(port): was putAssumeCapacity — profile in Phase B
                }
                break 'uses map;
            },
            ..Default::default()
        };

        let single_u32 = BabyList::<u32>::from_slice(&[1])?;

        let mut top_level_symbols_to_parts = js_ast::ast::TopLevelSymbolToParts::default();
        // SAFETY: module_scope is a live arena allocation (set in init, scopes stack is empty)
        let module_scope_ref = unsafe { &*module_scope };
        top_level_symbols_to_parts
            .entries
            .set_capacity(module_scope_ref.generated.len())?;
        top_level_symbols_to_parts.entries.len = module_scope_ref.generated.len();
        let slice = top_level_symbols_to_parts.entries.slice();
        // PORT NOTE: reshaped for borrowck — Zig iterated three slices in lockstep
        debug_assert_eq!(slice.keys().len(), module_scope_ref.generated.len());
        for ((k, v), ref_) in slice
            .keys_mut()
            .iter_mut()
            .zip(slice.values_mut().iter_mut())
            .zip(module_scope_ref.generated.slice().iter())
        {
            *k = *ref_;
            *v = single_u32.clone();
        }
        top_level_symbols_to_parts.re_index()?;

        // For more details on this section, look at js_parser.toAST
        // This is mimicking how it calls ImportScanner
        if self.hot_reloading {
            let mut hmr_transform_ctx = js_parser::ConvertESMExportsForHmr {
                last_part: parts
                    .last()
                    .unwrap_or_else(|| unreachable!()), // was definitely allocated
                is_in_node_modules: self.source.path.is_node_module(),
                ..Default::default()
            };
            hmr_transform_ctx.stmts.reserve('prealloc_count: {
                // get a estimate on how many statements there are going to be
                let count = self.stmts.len();
                break 'prealloc_count count + 2;
            });

            let _ = js_parser::ImportScanner::scan::<AstBuilder, true>(
                self,
                self.stmts.as_slice(),
                false,
                Some(&mut hmr_transform_ctx),
            )?;
            // TODO(port): ImportScanner::scan generic signature — Zig passes
            // `(comptime P: type, p: *P, stmts, comptime convert_exports, comptime hot_reloading, ctx)`.
            // Rust shape will depend on the `ImportScannerHost` trait; revisit in Phase B.

            hmr_transform_ctx.finalize(self, parts.slice())?;
            let new_parts = parts.slice();
            // preserve original capacity
            parts.len = u32::try_from(new_parts.len()).unwrap();
            debug_assert!(core::ptr::eq(new_parts.as_ptr(), parts.ptr));
        } else {
            let result = js_parser::ImportScanner::scan::<AstBuilder, false>(
                self,
                self.stmts.as_slice(),
                false,
                None,
            )?;
            parts.mut_(1).stmts = result.stmts;
        }

        parts.mut_(1).declared_symbols = core::mem::take(&mut self.declared_symbols);
        parts.mut_(1).scopes = self.scopes.as_slice();
        parts.mut_(1).import_record_indices =
            BabyList::<u32>::move_from_list(&mut self.import_records_for_current_part);

        Ok(js_ast::BundledAst {
            parts,
            // SAFETY: module_scope is a live arena allocation
            module_scope: unsafe { (*module_scope).clone() },
            symbols: js_ast::Symbol::List::move_from_list(&mut self.symbols),
            exports_ref: Ref::NONE,
            wrapper_ref: Ref::NONE,
            module_ref: self.module_ref,
            import_records: ImportRecord::List::move_from_list(&mut self.import_records),
            export_star_import_records: &[],
            approximate_newline_count: 1,
            exports_kind: js_ast::ExportsKind::Esm,
            named_imports: core::mem::take(&mut self.named_imports),
            named_exports: core::mem::take(&mut self.named_exports),
            top_level_symbols_to_parts,
            char_freq: Default::default(),
            flags: Default::default(),
            target,
            top_level_await_keyword: Range::NONE,
            // .nested_scope_slot_counts = if (p.options.features.minify_identifiers)
            //     renamer.assignNestedScopeSlots(p.allocator, p.scopes.items[0], p.symbols.items)
            // else
            //     js_ast.SlotCounts{},
            ..Default::default()
        })
    }

    // stub methods for ImportScanner duck typing

    pub fn generate_temp_ref(&mut self, name: Option<&[u8]>) -> Ref {
        self.new_symbol(Symbol::Kind::Other, name.unwrap_or(b"temp"))
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
                js_ast::NamedExport {
                    alias_loc: Loc::EMPTY,
                    ref_,
                },
            )?;
        }
        Ok(())
    }

    pub fn record_exported_binding(&mut self, binding: Binding) {
        match binding.data {
            js_ast::B::Missing => {}
            js_ast::B::Identifier(ident) => {
                // PORT NOTE: reshaped for borrowck — capture original_name before calling &mut self method
                let original_name =
                    self.symbols[ident.ref_.inner_index() as usize].original_name;
                self.record_export(binding.loc, original_name, ident.ref_)
                    .expect("unreachable");
            }
            js_ast::B::Array(array) => {
                for prop in array.items {
                    self.record_exported_binding(prop.binding);
                }
            }
            js_ast::B::Object(obj) => {
                for prop in obj.properties {
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
            }),
        })
    }
}

pub use bun_js_parser::Ref;

pub use bun_js_parser::Index;

pub use bun_bundler::DeferredBatchTask;
pub use bun_bundler::ParseTask;
pub use bun_bundler::ThreadPool;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/AstBuilder.zig (375 lines)
//   confidence: medium
//   todos:      4
//   notes:      ImportScanner duck-typing (comptime stub fields) needs a Rust trait; arena/BumpVec ↔ BabyList::move_from_list interop and MultiArrayList slice iteration will need reshaping in Phase B.
// ──────────────────────────────────────────────────────────────────────────
