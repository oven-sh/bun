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
                let new_ref =
                    p.declare_generated_symbol(js_ast::symbol::Kind::Other, kind.tag_name());
                let loc_ref = js_ast::LocRef {
                    loc: bun_ast::Loc::EMPTY,
                    ref_: new_ref,
                };
                p.is_import_item.insert(new_ref, ());
                p.jsx_imports.set(kind, loc_ref);
                new_ref
            }
        }
    }

    fn new_generated(&mut self, name: &[u8]) -> js_ast::Ref {
        let p = &mut *self.p;
        let name = p.arena.alloc_slice_copy(name);
        let ref_ = p.new_symbol(js_ast::symbol::Kind::Other, name);
        VecExt::append(&mut p.module_scope_mut().generated, ref_);
        ref_
    }

    fn new_import_item(&mut self, name: &[u8]) -> js_ast::Ref {
        let p = &mut *self.p;
        let name = p.arena.alloc_slice_copy(name);
        let ref_ = p.new_symbol(js_ast::symbol::Kind::Import, name);
        VecExt::append(&mut p.module_scope_mut().generated, ref_);
        p.is_import_item.insert(ref_, ());
        ref_
    }

    fn runtime_sentinel(&mut self, early: bool) -> js_ast::Ref {
        let p = &mut *self.p;
        let name: &'static [u8] = if early {
            b"__EARLY_RETURN_SENTINEL"
        } else {
            b"__MEMO_CACHE_SENTINEL"
        };
        p.runtime_identifier_ref(name)
    }

    fn global_ref(&mut self, name: &[u8]) -> js_ast::Ref {
        let p = &mut *self.p;
        let name = p.arena.alloc_slice_copy(name);
        // current_scope is the component's FunctionBody here; find_symbol walks
        // up to module scope.
        p.find_symbol(bun_ast::Loc::EMPTY, name).expect("oom").r#ref
    }

    fn record_usage(&mut self, ref_: js_ast::Ref) {
        self.p.record_usage(ref_);
    }

    fn add_import_record(&mut self, path: &[u8], kind: js_ast::ImportKind) -> (u32, js_ast::Ref) {
        let p = &mut *self.p;
        let path = p.arena.alloc_slice_copy(path);
        let index = p.add_import_record_by_range(kind, bun_ast::Range::NONE, path);
        let namespace_ref = p.new_symbol(js_ast::symbol::Kind::Other, path);
        VecExt::append(&mut p.module_scope_mut().generated, namespace_ref);
        (index, namespace_ref)
    }
}

impl<'a, const TS: bool, const SCAN_ONLY: bool> P<'a, TS, SCAN_ONLY> {
    /// Port of upstream `findFunctionDeclarationOrExpression` for the
    /// expression positions (decl init / `export default` / expression
    /// statement). Returns `Some(in_react_hoc)` only for the shapes the
    /// Babel plugin accepts, so `react_compiler_candidate_name` cannot leak
    /// into an unrelated nested arrow.
    pub fn react_compiler_candidate_expr(&self, expr: &js_ast::Expr) -> Option<bool> {
        use js_ast::expr::Data;
        match &expr.data {
            Data::EArrow(_) | Data::EFunction(_) => Some(false),
            Data::ECall(call)
                if !call.was_jsx_element && self.is_react_hoc_callee(&call.target) =>
            {
                matches!(
                    call.args.first().map(|a| &a.data),
                    Some(Data::EArrow(_) | Data::EFunction(_))
                )
                .then_some(true)
            }
            _ => None,
        }
    }

    fn is_react_hoc_callee(&self, target: &js_ast::Expr) -> bool {
        use js_ast::expr::Data;
        let name: &[u8] = match &target.data {
            Data::EIdentifier(id) => self.load_name_from_ref(id.ref_),
            Data::EImportIdentifier(id) => self.load_name_from_ref(id.ref_),
            Data::EDot(member) => {
                let obj = match &member.target.data {
                    Data::EIdentifier(o) => self.load_name_from_ref(o.ref_),
                    Data::EImportIdentifier(o) => self.load_name_from_ref(o.ref_),
                    _ => return false,
                };
                if obj != b"React" {
                    return false;
                }
                member.name.slice()
            }
            _ => return false,
        };
        name == b"forwardRef" || name == b"memo"
    }
}
