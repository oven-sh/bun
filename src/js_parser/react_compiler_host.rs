//! `bun_react_compiler::Host` adapter over `&mut P`, kept in this crate so
//! `bun_react_compiler` stays free of a `bun_js_parser` dependency.
//!
//! Constructed inline at each post-visit hook site (`visit_stmt.rs`) around the
//! single `maybe_compile_*` call, then dropped — it owns no state of its own.

use bun_ast as js_ast;
use bun_collections::VecExt;

use crate::JSXImport;
use crate::p::P;

/// What [`P::enter_react_compiler_candidate`] decided about a function.
#[derive(Clone, Copy)]
pub(crate) struct ReactCompilerCandidate {
    pub(crate) prev_may_replace_body: bool,
    /// The function is handed to the compiler once its body has been visited.
    pub(crate) is_taken: bool,
    /// The binding that names it: its own declaration, or the `A` in `const A = () => {}`.
    pub(crate) binding: Option<js_ast::Ref>,
    pub(crate) in_react_hoc: bool,
    pub(crate) is_top_level: bool,
}

pub struct ReactCompilerHost<'p, 'a, const TS: bool, const SCAN_ONLY: bool> {
    p: &'p mut P<'a, TS, SCAN_ONLY>,
}

impl<'p, 'a, const TS: bool, const SCAN_ONLY: bool> ReactCompilerHost<'p, 'a, TS, SCAN_ONLY> {
    #[inline]
    pub(crate) fn new(p: &'p mut P<'a, TS, SCAN_ONLY>) -> Self {
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
    fn is_module_level(&self, ref_: js_ast::Ref) -> bool {
        let Some(symbol) = self.p.symbols.get(ref_.inner_index() as usize) else {
            return false;
        };
        let name = symbol.original_name.slice();
        // `current_scope` is the body of the function being compiled, and its parent holds the arguments.
        let mut outer = self.p.current_scope().parent.and_then(|args| args.parent);
        while let Some(scope) = outer {
            if (scope.members.get(name)).is_some_and(|member| member.ref_ == ref_) {
                return true;
            }
            outer = scope.parent;
        }
        false
    }
    fn namespace_of_import_item(&self, item: js_ast::Ref) -> Option<js_ast::Ref> {
        let symbol = self.p.symbols.get(item.inner_index() as usize)?;
        let name = symbol.original_name.slice();
        let mut all = self.p.import_items_for_namespace.iter();
        all.find_map(|(namespace, items)| (items.get(name)?.ref_ == item).then_some(*namespace))
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

    fn is_jsx_classic(&self) -> bool {
        self.p.options.jsx.runtime != crate::parser::options::JSX::Runtime::Automatic
    }

    fn jsx_classic_factory(&mut self, loc: bun_ast::Loc) -> js_ast::Expr {
        self.p
            .jsx_classic_member_expression(loc, |jsx| &jsx.factory)
    }

    fn jsx_import_kind(&self, ref_: js_ast::Ref) -> Option<bun_react_compiler::JsxImportKind> {
        use bun_react_compiler::JsxImportKind as K;
        Some(match self.p.jsx_imports.tag_of(ref_)? {
            JSXImport::Jsx => K::Jsx,
            JSXImport::Jsxs => K::Jsxs,
            JSXImport::JsxDEV => K::JsxDEV,
            JSXImport::Fragment => K::Fragment,
            JSXImport::CreateElement => K::CreateElement,
        })
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

    fn new_local(&mut self, name: &[u8]) -> js_ast::Ref {
        let p = &mut *self.p;
        let name = p.arena.alloc_slice_copy(name);
        let ref_ = p.new_symbol(js_ast::symbol::Kind::Other, name);
        // current_scope is the FunctionBody of the function being compiled.
        VecExt::append(&mut p.current_scope_mut().generated, ref_);
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
    /// Drops the replaced body's symbols, or the renamer prints a new local `count` as `count2`.
    pub(crate) fn drop_symbols_of_replaced_function(&mut self, name: Option<js_ast::Ref>) {
        let mut body = self.current_scope;
        debug_assert!(body.kind == js_ast::scope::Kind::FunctionBody);
        body.members = js_ast::scope::Members::EMPTY;
        body.children.clear();
        if let Some(mut args) = body.parent {
            debug_assert!(args.kind == js_ast::scope::Kind::FunctionArgs);
            // Still printed: `arguments`, and `name` when a function expression declares it here.
            let mut kept = js_ast::scope::Members::EMPTY;
            for (key, member) in args.members.iter() {
                let kind = self.symbols[member.ref_.inner_index() as usize].kind;
                if kind == js_ast::symbol::Kind::Arguments || Some(member.ref_) == name {
                    // SAFETY: `put` stores `key` by reference, so it has to
                    // outlive `args`. It is already the key of a member of
                    // `args`, stored under the same contract.
                    unsafe { kept.put(key, *member) };
                }
            }
            args.members = kept;
            args.children.retain(|child| *child == body);
        }
    }

    /// Call this before visiting any part of a function. Upstream considers every function that isn't a method, isn't in a
    /// class, and isn't inside a function it already compiles. The surrounding statement only gives the function its name.
    ///
    /// Consumes `react_compiler_candidate_name`, so that a function in a default argument can't pick it up, and sets
    /// `react_compiler_may_replace_body` for the visit.
    pub(crate) fn enter_react_compiler_candidate(
        &mut self,
        is_method: bool,
        is_top_level: bool,
        has_react_hooks_suppression: bool,
        args: &[js_ast::G::Arg],
        has_rest_arg: bool,
        body: &[js_ast::Stmt],
    ) -> ReactCompilerCandidate {
        let prev_may_replace_body = self.react_compiler_may_replace_body;
        let binding = (self.react_compiler_candidate_name.take()).filter(|r| r.is_valid());
        let in_react_hoc = core::mem::take(&mut self.react_compiler_in_react_hoc);
        let mut is_taken = false;
        if !is_method
            && !prev_may_replace_body
            && self.enclosing_class_keyword.len == 0
            && let Some(rc) = self.react_compiler.take()
        {
            let name = binding.map(|r| self.load_name_from_ref(r));
            is_taken = rc.may_compile(
                &ReactCompilerHost::new(self),
                name,
                in_react_hoc,
                is_top_level,
                has_react_hooks_suppression,
                args,
                has_rest_arg,
                body,
            );
            self.react_compiler_may_replace_body = is_taken;
            self.react_compiler = Some(rc);
        }
        ReactCompilerCandidate {
            prev_may_replace_body,
            is_taken,
            binding,
            in_react_hoc,
            is_top_level,
        }
    }

    /// Whether `expr` is a function, or `memo(fn)` / `forwardRef(fn)`, in which case this returns `Some(true)`. Anything
    /// else returns `None`, so that a name can't reach an unrelated function somewhere inside `expr`.
    pub(crate) fn react_compiler_candidate_expr(&self, expr: &js_ast::Expr) -> Option<bool> {
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
