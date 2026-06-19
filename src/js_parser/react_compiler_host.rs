//! `bun_react_compiler::Host` adapter over `&mut P`, kept in this crate so
//! `bun_react_compiler` stays free of a `bun_js_parser` dependency.
//!
//! Constructed inline at each post-visit hook site (`visit_stmt.rs`) around the
//! single `maybe_compile_*` call, then dropped — it owns no state of its own.

use bun_ast as js_ast;
use bun_collections::VecExt;

use crate::JSXImport;
use crate::p::P;

pub struct ReactCompilerHost<'p, 'a, const TS: bool, const SCAN_ONLY: bool> {
    p: &'p mut P<'a, TS, SCAN_ONLY>,
}

impl<'p, 'a, const TS: bool, const SCAN_ONLY: bool> ReactCompilerHost<'p, 'a, TS, SCAN_ONLY> {
    #[inline]
    pub fn new(p: &'p mut P<'a, TS, SCAN_ONLY>) -> Self {
        Self { p }
    }
}

impl<'a, const TS: bool, const SCAN_ONLY: bool> bun_react_compiler::Host
    for ReactCompilerHost<'_, 'a, TS, SCAN_ONLY>
{
    fn symbols(&self) -> &[js_ast::Symbol] {
        self.p.symbols.as_slice()
    }
    fn module_scope(&self) -> &js_ast::Scope {
        &self.p.module_scope
    }
    fn import_records(&self) -> &[js_ast::ImportRecord] {
        self.p.import_records.items()
    }
    fn source(&self) -> &[u8] {
        &self.p.source.contents
    }
    fn arena(&self) -> &bun_alloc::Arena {
        self.p.arena
    }

    fn ref_name(&self, ref_: js_ast::Ref) -> &[u8] {
        self.p.load_name_from_ref(ref_)
    }

    fn scope_for_loc(&self, _loc: bun_ast::Loc) -> Option<&js_ast::Scope> {
        // Post-visit, identifier refs are already resolved; lowering's
        // inline name→symbol resolution is unused.
        None
    }

    fn is_jsx_dev(&self) -> bool {
        self.p.options.jsx.development
    }

    fn jsx_import(&mut self, kind: bun_react_compiler::JsxImportKind) -> js_ast::Ref {
        use bun_react_compiler::JsxImportKind as K;
        let kind = match kind {
            K::Jsx => JSXImport::Jsx,
            K::Jsxs => JSXImport::Jsxs,
            K::JsxDEV => JSXImport::JsxDEV,
            K::Fragment => JSXImport::Fragment,
            K::CreateElement => JSXImport::CreateElement,
        };
        let p = &mut *self.p;
        match p.jsx_imports.get_with_tag(kind) {
            Some(existing) => existing,
            None => {
                let new_ref = p
                    .declare_generated_symbol(js_ast::symbol::Kind::Other, kind.tag_name())
                    .expect("oom");
                let loc_ref = js_ast::LocRef {
                    loc: bun_ast::Loc::EMPTY,
                    ref_: Some(new_ref),
                };
                VecExt::append(&mut p.module_scope_mut().generated, new_ref);
                p.is_import_item.insert(new_ref, ());
                p.jsx_imports.set(kind, loc_ref);
                new_ref
            }
        }
    }

    fn new_generated(&mut self, name: &[u8]) -> js_ast::Ref {
        let p = &mut *self.p;
        let name = p.arena.alloc_slice_copy(name);
        let ref_ = p
            .new_symbol(js_ast::symbol::Kind::Other, name)
            .expect("oom");
        VecExt::append(&mut p.module_scope_mut().generated, ref_);
        ref_
    }

    fn record_usage(&mut self, ref_: js_ast::Ref) {
        self.p.record_usage(ref_);
    }

    fn add_import_record(&mut self, path: &[u8], kind: js_ast::ImportKind) -> (u32, js_ast::Ref) {
        let p = &mut *self.p;
        let path = p.arena.alloc_slice_copy(path);
        let index = p.add_import_record_by_range(kind, bun_ast::Range::NONE, path);
        let namespace_ref = p
            .new_symbol(js_ast::symbol::Kind::Other, path)
            .expect("oom");
        VecExt::append(&mut p.module_scope_mut().generated, namespace_ref);
        (index, namespace_ref)
    }
}
