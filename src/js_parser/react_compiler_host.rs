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

/// What [`P::enter_react_compiler_candidate`] found for the function that is visited.
#[derive(Clone, Copy)]
pub(crate) struct ReactCompilerCandidate {
    /// `react_compiler_may_replace_body` around the function, to restore when it is left.
    pub(crate) prev_may_replace_body: bool,
    /// The binding that `visit_stmt` named, if this function is the candidate. `Ref::NONE`: it has none.
    pub(crate) binding: Option<js_ast::Ref>,
    pub(crate) in_react_hoc: bool,
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

    /// Takes the candidate that `visit_stmt` named for the function at `loc`, before its parameters are visited, so
    /// that a function among them is not taken for it. Sets `react_compiler_may_replace_body` for the visit.
    #[inline]
    pub(crate) fn enter_react_compiler_candidate(
        &mut self,
        name: Option<js_ast::Ref>,
        loc: bun_ast::Loc,
        body_loc: bun_ast::Loc,
        body: &[js_ast::Stmt],
    ) -> ReactCompilerCandidate {
        let prev_may_replace_body = self.react_compiler_may_replace_body;
        // Few functions are a candidate, and none is without the compiler: the rest is out of line.
        let Some(binding) = self.react_compiler_candidate_name.take() else {
            return ReactCompilerCandidate {
                prev_may_replace_body,
                binding: None,
                in_react_hoc: false,
            };
        };
        let in_react_hoc = self.decide_react_compiler_candidate(binding, name, loc, body_loc, body);
        ReactCompilerCandidate {
            prev_may_replace_body,
            binding: Some(binding),
            in_react_hoc,
        }
    }

    /// Sets `react_compiler_may_replace_body` for the candidate. Returns whether it is the argument of a `memo()`
    /// or `forwardRef()` call.
    #[inline(never)]
    fn decide_react_compiler_candidate(
        &mut self,
        binding: js_ast::Ref,
        name: Option<js_ast::Ref>,
        loc: bun_ast::Loc,
        body_loc: bun_ast::Loc,
        body: &[js_ast::Stmt],
    ) -> bool {
        let in_react_hoc = core::mem::take(&mut self.react_compiler_in_react_hoc);
        if !self.react_compiler_may_replace_body
            && let Some(rc) = self.react_compiler.as_deref()
        {
            let name = name
                .filter(|r| r.is_valid())
                .or(Some(binding))
                .filter(|r| *r != js_ast::Ref::NONE)
                .map(|r| self.load_name_from_ref(r));
            self.react_compiler_may_replace_body = rc.may_compile(
                name,
                in_react_hoc,
                self.has_react_hooks_suppression(loc, body_loc),
                body,
            );
        }
        in_react_hoc
    }

    /// Whether a comment keeps the React Compiler from the function at `loc` whose body is at `body_loc`: an
    /// `eslint-disable` for a rule of React hooks anywhere in the file, or an `eslint-disable-next-line` for one
    /// inside of the function. Upstream's `filterSuppressionsThatAffectFunction`, which also runs once the whole
    /// file is read. The parse pass cannot tell: it would go by the order in which the lexer met the comments.
    fn has_react_hooks_suppression(&self, loc: bun_ast::Loc, body_loc: bun_ast::Loc) -> bool {
        if self.lexer.has_react_hooks_block_suppression {
            return true;
        }
        // A function without its end on record was left before the lexer met the first of the comments.
        let Some(span) = self.react_compiler_fn_spans.get(&body_loc.start) else {
            return false;
        };
        let fn_start = span.start.to_nullable().unwrap_or(loc).start as u32;
        let comments = &self.lexer.react_hooks_next_line_suppressions;
        // A comment does not wrap a function. Of those that start in it, the first is inside if any is.
        let first = comments.partition_point(|comment| comment.loc.start as u32 <= fn_start);
        comments.get(first).is_some_and(|comment| {
            bun_react_compiler::suppression_affects_function(
                comment.loc.start as u32,
                Some((comment.loc.start + comment.len) as u32),
                fn_start,
                span.end as u32,
            )
        })
    }

    /// Port of upstream `findFunctionDeclarationOrExpression` for the
    /// expression positions (decl init / `export default` / expression
    /// statement). Returns `Some(in_react_hoc)` only for the shapes the
    /// Babel plugin accepts, so `react_compiler_candidate_name` cannot leak
    /// into an unrelated nested arrow.
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
