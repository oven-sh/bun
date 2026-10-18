//! `bun_react_compiler::Host` adapter over `&mut P`, kept in this crate so
//! `bun_react_compiler` stays free of a `bun_js_parser` dependency.
//!
//! Constructed inline at the post-visit hook site (`visit_stmts`) around the
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
        self.p.namespace_of_import_item(item)
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

/// What `enter_react_compiler_candidate` returns for one function visit.
#[derive(Clone, Copy)]
pub(crate) struct ReactCompilerCandidate {
    /// The taken `react_compiler_candidate_name`. `None`: this function is not the candidate.
    statement_binding: Option<js_ast::Ref>,
    /// The function's own name when it has one, else `statement_binding`.
    binding: Option<js_ast::Ref>,
    in_react_hoc: bool,
    prev_may_replace_body: bool,
}

impl ReactCompilerCandidate {
    pub(crate) fn is_candidate(&self) -> bool {
        self.statement_binding.is_some()
    }

    /// For `react_compiler_pending`, right before the visit of the body: the first body visited takes it.
    pub(crate) fn pending(
        &self,
        args: js_ast::StoreSlice<js_ast::G::Arg>,
        flags: js_ast::flags::FunctionSet,
        body_loc: bun_ast::Loc,
        args_loc: bun_ast::Loc,
    ) -> bun_react_compiler::PendingCompile {
        debug_assert!(self.is_candidate());
        bun_react_compiler::PendingCompile {
            args,
            flags,
            body_loc,
            args_loc,
            binding: self.binding,
            in_react_hoc: self.in_react_hoc,
        }
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

    /// The candidate takes its name here, before its parameters are visited, so no function in them can.
    pub(crate) fn enter_react_compiler_candidate(
        &mut self,
        name: Option<js_ast::Ref>,
        has_react_hooks_suppression: bool,
        body: &[js_ast::Stmt],
    ) -> ReactCompilerCandidate {
        let prev_may_replace_body = self.react_compiler_may_replace_body;
        let statement_binding = self.react_compiler_candidate_name.take();
        let in_react_hoc =
            statement_binding.is_some() && core::mem::take(&mut self.react_compiler_in_react_hoc);
        let binding =
            statement_binding.map(|candidate| name.filter(|r| r.is_valid()).unwrap_or(candidate));
        if !prev_may_replace_body
            && let Some(binding) = binding
            && let Some(rc) = self.react_compiler.as_deref()
        {
            let name = Some(binding)
                .filter(|r| *r != js_ast::Ref::NONE)
                .map(|r| self.load_name_from_ref(r));
            self.react_compiler_may_replace_body =
                rc.may_compile(name, in_react_hoc, has_react_hooks_suppression, body);
        }
        ReactCompilerCandidate {
            statement_binding,
            binding,
            in_react_hoc,
            prev_may_replace_body,
        }
    }

    /// Returns the compiled parameters and flags when the compiler replaced the body.
    pub(crate) fn leave_react_compiler_candidate(
        &mut self,
        candidate: ReactCompilerCandidate,
    ) -> Option<bun_react_compiler::CompileResult> {
        self.react_compiler_pending = None;
        self.react_compiler_may_replace_body = candidate.prev_may_replace_body;
        let result = self.react_compiler_result.take()?;
        if let Some(binding) = candidate
            .statement_binding
            .filter(|r| *r != js_ast::Ref::NONE)
        {
            self.record_usage(binding);
        }
        Some(result)
    }

    /// `call` is a call whose callee has been visited, and `callee_as_written`
    /// is the tag that the callee had before its visit. True when the callee as
    /// written is `memo`, `forwardRef`, `React.memo` or `React.forwardRef` and
    /// the call is not optional: the calls that the Babel plugin's
    /// `isMemoCallback` and `isForwardRefCallback` accept around a function.
    pub(crate) fn is_react_hoc_call(
        &self,
        call: &js_ast::E::Call,
        callee_as_written: js_ast::expr::Tag,
    ) -> bool {
        use js_ast::expr::{Data, Tag};
        if call.was_jsx_element || call.optional_chain.is_some() {
            return false;
        }
        let visited = &call.target;
        let name: &[u8] = match (callee_as_written, visited.data) {
            (Tag::EIdentifier, Data::EIdentifier(id)) => self.load_name_from_ref(id.ref_),
            (Tag::EIdentifier, Data::EImportIdentifier(id)) => self.load_name_from_ref(id.ref_),
            (Tag::EDot, Data::EDot(dot)) => {
                let object = match dot.target.data {
                    Data::EIdentifier(object) => object.ref_,
                    Data::EImportIdentifier(object) => object.ref_,
                    _ => return false,
                };
                // The object of `ns.React.memo` does not begin where the access begins.
                if dot.target.loc != visited.loc
                    || dot.optional_chain.is_some()
                    || self.load_name_from_ref(object) != b"React"
                {
                    return false;
                }
                dot.name.slice()
            }
            // `import * as React`: the visit made the access an import item.
            (Tag::EDot, Data::EImportIdentifier(item)) => {
                let of_react = self
                    .namespace_of_import_item(item.ref_)
                    .is_some_and(|namespace| self.load_name_from_ref(namespace) == b"React");
                if !of_react {
                    return false;
                }
                self.load_name_from_ref(item.ref_)
            }
            _ => return false,
        };
        name == b"forwardRef" || name == b"memo"
    }

    /// The namespace that `item` is a property of, when `item` is the import item that the visit made of `ns.name`.
    pub(crate) fn namespace_of_import_item(&self, item: js_ast::Ref) -> Option<js_ast::Ref> {
        let symbol = self.symbols.get(item.inner_index() as usize)?;
        let name = symbol.original_name.slice();
        let mut all = self.import_items_for_namespace.iter();
        all.find_map(|(namespace, items)| (items.get(name)?.ref_ == item).then_some(*namespace))
    }
}
