//! Like Ast but slimmer and for bundling only.
//!
//! On Linux, the hottest function in the bundler is:
//! src.multi_array_list.MultiArrayList(src.js_ast.Ast).ensureTotalCapacity
//! https://share.firefox.dev/3NNlRKt
//!
//! So we make a slimmer version of Ast for bundling that doesn't allocate as much memory

use std::io::Write as _;

// TODO(b2-blocked): bun_css::BundlerStyleSheet — bun_css crate not a dep of js_parser (would back-edge T4→T4).
// Use opaque ptr; downstream bundler casts.
type BundlerStyleSheet = core::ffi::c_void;

use bun_logger as logger;
use bun_options_types::import_record;
use bun_string::strings;

use crate::ast::ast::{self, Ast};
use crate::ast::{CharFreq, ExportsKind, Ref, Scope, SlotCounts};
use crate::ast::{part, symbol};
use crate::TlaCheck;
// TODO(port): verify exact module paths for Ast/Part/Symbol associated `List` types in Phase B.

pub type CommonJSNamedExports = ast::CommonJSNamedExports;
pub type ConstValuesMap = ast::ConstValuesMap;
pub type NamedExports = ast::NamedExports;
pub type NamedImports = ast::NamedImports;
pub type TopLevelSymbolToParts = ast::TopLevelSymbolToParts;

// PORT NOTE: Zig stores `MultiArrayList(BundledAst)` on `Graph.ast` /
// `LinkerGraph.ast` and the bundler indexes columns via `.items(.field)`
// (see `linker_context/scanImportsAndExports.zig`, `LinkerContext.zig`).
// `#[derive(MultiArrayElement)]` generates the `BundledAstField` enum +
// `BundledAstSliceExt`/`BundledAstListExt` (`items_named_imports()`,
// `items_named_exports()`, …) that those callers expect at
// `bun_js_parser::ast::bundled_ast::*`.
//
// 26 fields ≤ `multi_array_list::MAX_FIELDS` (32).
#[derive(bun_collections::MultiArrayElement)]
pub struct BundledAst<'arena> {
    pub approximate_newline_count: u32,
    pub nested_scope_slot_counts: SlotCounts,

    pub exports_kind: ExportsKind,

    /// These are stored at the AST level instead of on individual AST nodes so
    /// they can be manipulated efficiently without a full AST traversal
    pub import_records: import_record::List,

    // PORT NOTE: Ast.hashbang is `StoreStr`; mirror it here so init/to_ast can
    // round-trip.
    pub hashbang: crate::StoreStr,
    pub parts: part::List,
    // Zig: `?*bun.css.BundlerStyleSheet` (nullable mutable raw ptr). Downstream
    // bundler binds the SoA column as `&[Option<*mut css::BundlerStyleSheet>]`,
    // so this must be a raw `*mut`, not a `&'arena` borrow.
    pub css: Option<*mut BundlerStyleSheet>,
    pub url_for_css: &'arena [u8],
    pub symbols: symbol::List,
    pub module_scope: Scope,
    // TODO(port): Zig used `= undefined`; only valid when flags.HAS_CHAR_FREQ is set.
    pub char_freq: CharFreq,
    pub exports_ref: Ref,
    pub module_ref: Ref,
    pub wrapper_ref: Ref,
    pub require_ref: Ref,
    pub top_level_await_keyword: logger::Range,
    pub tla_check: TlaCheck,

    // These are used when bundling. They are filled in during the parser pass
    // since we already have to traverse the AST then anyway and the parser pass
    // is conveniently fully parallelized.
    pub named_imports: NamedImports,
    pub named_exports: NamedExports,
    // PORT NOTE: Ast owns Box<[u32]>; matching it here avoids the &'arena↔Box
    // re-alloc on init/to_ast (Zig's `[]u32` is a fat-ptr move either way).
    pub export_star_import_records: Box<[u32]>,

    pub top_level_symbols_to_parts: TopLevelSymbolToParts,

    pub commonjs_named_exports: CommonJSNamedExports,

    pub redirect_import_record_index: u32,

    /// Only populated when bundling. When --server-components is passed, this
    /// will be .browser when it is a client component, and the server's target
    /// on the server.
    pub target: bun_options_types::Target,

    // const_values: ConstValuesMap,
    pub ts_enums: ast::TsEnumsMap,

    pub flags: Flags,
}

bitflags::bitflags! {
    #[derive(Clone, Copy, Default, PartialEq, Eq)]
    pub struct Flags: u16 {
        // This is a list of CommonJS features. When a file uses CommonJS features,
        // it's not a candidate for "flat bundling" and must be wrapped in its own
        // closure.
        const USES_EXPORTS_REF = 1 << 0;
        const USES_MODULE_REF = 1 << 1;
        // const USES_REQUIRE_REF = 1 << 2; (commented out in Zig; bit positions still match field order)
        const USES_EXPORT_KEYWORD = 1 << 2;
        const HAS_CHAR_FREQ = 1 << 3;
        const FORCE_CJS_TO_ESM = 1 << 4;
        const HAS_LAZY_EXPORT = 1 << 5;
        const COMMONJS_MODULE_EXPORTS_ASSIGNED_DEOPTIMIZED = 1 << 6;
        const HAS_EXPLICIT_USE_STRICT_DIRECTIVE = 1 << 7;
        const HAS_IMPORT_META = 1 << 8;
        // _padding: u7 fills the rest
    }
}

impl<'arena> BundledAst<'arena> {
    // TODO(port): Zig `pub const empty = BundledAst.init(Ast.empty);` — cannot be a `const` in Rust
    // because `init` is not const-evaluable. Phase B: consider a `static` via `OnceLock` or make
    // `init`/`Ast::empty` const fn if feasible.
    pub fn empty() -> Self {
        Self::init(Ast::empty())
    }

    // PORT NOTE: Zig's `*const BundledAst` bitwise-copies every field; the Rust
    // collection types aren't Copy, so consume `self` to move them (toAST is a
    // one-shot conversion back to the fat Ast).
    pub fn to_ast(self) -> Ast {
        Ast {
            approximate_newline_count: self.approximate_newline_count as usize,
            nested_scope_slot_counts: self.nested_scope_slot_counts,

            exports_kind: self.exports_kind,

            import_records: self.import_records,

            hashbang: self.hashbang,
            parts: self.parts,
            // This list may be mutated later, so we should store the capacity
            symbols: self.symbols,
            module_scope: self.module_scope,
            char_freq: if self.flags.contains(Flags::HAS_CHAR_FREQ) {
                Some(self.char_freq)
            } else {
                None
            },
            exports_ref: self.exports_ref,
            module_ref: self.module_ref,
            wrapper_ref: self.wrapper_ref,
            require_ref: self.require_ref,
            top_level_await_keyword: self.top_level_await_keyword,

            // These are used when bundling. They are filled in during the parser pass
            // since we already have to traverse the AST then anyway and the parser pass
            // is conveniently fully parallelized.
            named_imports: self.named_imports,
            named_exports: self.named_exports,
            export_star_import_records: self.export_star_import_records,

            top_level_symbols_to_parts: self.top_level_symbols_to_parts,

            commonjs_named_exports: self.commonjs_named_exports,

            redirect_import_record_index: if self.redirect_import_record_index == u32::MAX {
                None
            } else {
                Some(self.redirect_import_record_index)
            },

            target: self.target,

            // const_values: self.const_values,
            ts_enums: self.ts_enums,

            uses_exports_ref: self.flags.contains(Flags::USES_EXPORTS_REF),
            uses_module_ref: self.flags.contains(Flags::USES_MODULE_REF),
            // uses_require_ref: ast.uses_require_ref,
            export_keyword: logger::Range {
                len: if self.flags.contains(Flags::USES_EXPORT_KEYWORD) { 1 } else { 0 },
                loc: logger::Loc::default(),
            },
            force_cjs_to_esm: self.flags.contains(Flags::FORCE_CJS_TO_ESM),
            has_lazy_export: self.flags.contains(Flags::HAS_LAZY_EXPORT),
            commonjs_module_exports_assigned_deoptimized: self
                .flags
                .contains(Flags::COMMONJS_MODULE_EXPORTS_ASSIGNED_DEOPTIMIZED),
            directive: if self.flags.contains(Flags::HAS_EXPLICIT_USE_STRICT_DIRECTIVE) {
                Some(crate::StoreStr::new(b"use strict"))
            } else {
                None
            },
            has_import_meta: self.flags.contains(Flags::HAS_IMPORT_META),
            // TODO(port): Ast has many more fields with defaults; Phase B should use
            // `..Ast::default()` or equivalent functional-update once Ast's Rust shape is fixed.
            ..Ast::default()
        }
    }

    pub fn init(ast: Ast) -> Self {
        let mut flags = Flags::empty();
        flags.set(Flags::USES_EXPORTS_REF, ast.uses_exports_ref);
        flags.set(Flags::USES_MODULE_REF, ast.uses_module_ref);
        // flags.set(Flags::USES_REQUIRE_REF, ast.uses_require_ref);
        flags.set(Flags::USES_EXPORT_KEYWORD, ast.export_keyword.len > 0);
        flags.set(Flags::HAS_CHAR_FREQ, ast.char_freq.is_some());
        flags.set(Flags::FORCE_CJS_TO_ESM, ast.force_cjs_to_esm);
        flags.set(Flags::HAS_LAZY_EXPORT, ast.has_lazy_export);
        flags.set(
            Flags::COMMONJS_MODULE_EXPORTS_ASSIGNED_DEOPTIMIZED,
            ast.commonjs_module_exports_assigned_deoptimized,
        );
        flags.set(
            Flags::HAS_EXPLICIT_USE_STRICT_DIRECTIVE,
            ast.directive.is_some_and(|d| d == b"use strict"),
        );
        flags.set(Flags::HAS_IMPORT_META, ast.has_import_meta);

        Self {
            approximate_newline_count: ast.approximate_newline_count as u32,
            nested_scope_slot_counts: ast.nested_scope_slot_counts,

            exports_kind: ast.exports_kind,

            import_records: ast.import_records,

            hashbang: ast.hashbang,
            parts: ast.parts,
            css: None,
            url_for_css: b"",
            // This list may be mutated later, so we should store the capacity
            symbols: ast.symbols,
            module_scope: ast.module_scope,
            // Only read when flags.HAS_CHAR_FREQ is set; Zig used `orelse undefined`.
            char_freq: ast.char_freq.unwrap_or_default(),
            exports_ref: ast.exports_ref,
            module_ref: ast.module_ref,
            wrapper_ref: ast.wrapper_ref,
            require_ref: ast.require_ref,
            top_level_await_keyword: ast.top_level_await_keyword,
            tla_check: TlaCheck::default(),
            // These are used when bundling. They are filled in during the parser pass
            // since we already have to traverse the AST then anyway and the parser pass
            // is conveniently fully parallelized.
            named_imports: ast.named_imports,
            named_exports: ast.named_exports,
            export_star_import_records: ast.export_star_import_records,

            // allocator: ast.allocator,
            top_level_symbols_to_parts: ast.top_level_symbols_to_parts,

            commonjs_named_exports: ast.commonjs_named_exports,

            redirect_import_record_index: ast.redirect_import_record_index.unwrap_or(u32::MAX),

            target: ast.target,

            // const_values: ast.const_values,
            ts_enums: ast.ts_enums,

            flags,
        }
    }

    /// TODO: Move this from being done on all parse tasks into the start of the linker. This currently allocates base64 encoding for every small file loaded thing.
    pub fn add_url_for_css(
        &mut self,
        bump: &'arena bun_alloc::Arena,
        source: &logger::Source,
        mime_type_: Option<&[u8]>,
        unique_key: Option<&[u8]>,
        force_inline: bool,
    ) {
        {
            // `by_extension` returns an owned MimeType whose `.value` is a Cow; bind it
            // so the borrow in the else-arm outlives the `mime_type` slice.
            let mime_type_owned;
            let mime_type: &[u8] = if let Some(m) = mime_type_ {
                m
            } else {
                mime_type_owned = bun_http_types::MimeType::by_extension(
                    strings::trim_leading_char(bun_paths::extension(source.path.text), b'.'),
                );
                &mime_type_owned.value
            };
            let contents: &[u8] = &source.contents;
            // TODO: make this configurable
            const COPY_THRESHOLD: usize = 128 * 1024; // 128kb
            let should_copy =
                !force_inline && contents.len() >= COPY_THRESHOLD && unique_key.is_some();
            if should_copy {
                return;
            }
            self.url_for_css = 'url_for_css: {
                // Encode as base64
                let encode_len = bun_base64::encode_len(contents);
                let data_url_prefix_len = b"data:".len() + mime_type.len() + b";base64,".len();
                let total_buffer_len = data_url_prefix_len + encode_len;
                // PERF(port): was arena alloc via `allocator.alloc(u8, n)`; using bumpalo here.
                let encoded: &mut [u8] = bump.alloc_slice_fill_copy(total_buffer_len, 0u8);
                {
                    let mut cursor = &mut encoded[0..data_url_prefix_len];
                    write!(
                        &mut cursor,
                        "data:{};base64,",
                        bstr::BStr::new(mime_type)
                    )
                    .expect("unreachable");
                }
                let len = bun_base64::encode(&mut encoded[data_url_prefix_len..], contents);
                break 'url_for_css &encoded[0..data_url_prefix_len + len];
            };
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/BundledAst.zig (235 lines)
//   confidence: medium
//   todos:      3
//   notes:      Struct carries <'arena> (css field per LIFETIMES.tsv); Ast field move/clone semantics and associated List type paths need Phase-B fixup; `empty` is a fn not const.
// ──────────────────────────────────────────────────────────────────────────
