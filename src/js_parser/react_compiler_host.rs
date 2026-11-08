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

/// Where what the compiler outlines from a function is declared ([`P::react_compiler_place_of_outlined`]).
#[derive(Clone, Copy)]
pub(crate) enum OutlinedPlace {
    /// In the part that `bun_react_compiler::finish` makes, which declares each name at the top level of the module.
    ModuleEnd,
    /// At the end of the statement list of this scope.
    List(js_ast::StoreRef<js_ast::Scope>),
    /// In the body of the function itself.
    OwnBody,
}

pub struct ReactCompilerHost<'p, 'a, const TS: bool, const SCAN_ONLY: bool> {
    p: &'p mut P<'a, TS, SCAN_ONLY>,
    /// What is outlined from the function being compiled is declared in that function's own body.
    outlines_into_body: bool,
    /// The name that the function being compiled gives itself. A read of it is a local that nothing declares: it has
    /// to keep its spelling.
    own_name: Option<js_ast::Ref>,
}

impl<'p, 'a, const TS: bool, const SCAN_ONLY: bool> ReactCompilerHost<'p, 'a, TS, SCAN_ONLY> {
    #[inline]
    pub(crate) fn new(p: &'p mut P<'a, TS, SCAN_ONLY>) -> Self {
        Self {
            p,
            outlines_into_body: false,
            own_name: None,
        }
    }

    pub(crate) fn outlines_into_body_of(&mut self, own_name: Option<js_ast::Ref>) {
        self.outlines_into_body = true;
        self.own_name = own_name;
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
    fn import_records(&self) -> &[js_ast::ImportRecord<'_>] {
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
        let mut name: &[u8] = p.arena.alloc_slice_copy(name);
        // An outlined function that is declared in this body reads the names around the function from inside it.
        // Without a renamer a local of the same name would hide one of them.
        if self.outlines_into_body
            && !p.will_use_renamer()
            && self
                .own_name
                .is_none_or(|own| p.load_name_from_ref(own) != name)
            && p.is_declared_around_compiled_function(name)
        {
            name = p.temp_var_name(name);
        }
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
    /// The scope that holds the function being compiled. `current_scope` is the body of that function, and its parent
    /// holds the arguments.
    fn scope_around_compiled_function(&self) -> Option<js_ast::StoreRef<js_ast::Scope>> {
        self.current_scope().parent.and_then(|args| args.parent)
    }

    /// Where what is outlined from the function being compiled is declared. It is the statement list being visited, if
    /// that list is in the scope that holds the function, or if every scope between the two declares nothing (a label,
    /// the head of a `for` or the block of a `switch` with no `let`). The statement of a label is no list: a block
    /// around it would take the label from a loop, so the list around the label declares them. A name at the top
    /// level of the module has to be a declared symbol of a part, so the list of the module is the end of the module.
    /// A function in a head that has names of its own (a parameter list, a `catch` binding, a `for` that declares)
    /// has no list.
    pub(crate) fn react_compiler_place_of_outlined(&self, is_top_level: bool) -> OutlinedPlace {
        use js_ast::scope::Kind;
        if is_top_level {
            return OutlinedPlace::ModuleEnd;
        }
        let mut around = self.scope_around_compiled_function();
        let mut is_in_list = false;
        while let Some(scope) = around {
            is_in_list |= scope == self.react_compiler_list_scope;
            if is_in_list {
                if scope == self.module_scope {
                    return OutlinedPlace::ModuleEnd;
                }
                if scope.kind != Kind::Label {
                    return OutlinedPlace::List(scope);
                }
            } else if !matches!(scope.kind, Kind::Block | Kind::Label) || scope.members.count() > 0
            {
                break;
            }
            around = scope.parent;
        }
        OutlinedPlace::OwnBody
    }

    fn is_declared_around_compiled_function(&self, name: &[u8]) -> bool {
        let mut around = self.scope_around_compiled_function();
        while let Some(scope) = around {
            if scope.members.get(name).is_some() {
                return true;
            }
            around = scope.parent;
        }
        false
    }

    /// Declares what the compiler outlined, since it had `outlined_len` functions, from the nested function it just
    /// compiled. `place` is where that function can reach it, and where it can reach the variables around that
    /// function: a statement list, or else `body`, the function's own.
    #[cold]
    #[inline(never)]
    pub(crate) fn declare_outlined_from_nested(
        &mut self,
        rc: &mut bun_react_compiler::ReactCompilerState,
        outlined_len: usize,
        place: OutlinedPlace,
        body: &mut bun_alloc::ArenaVec<'a, js_ast::Stmt>,
    ) {
        let (is_in_list, mut declared_in) = match place {
            OutlinedPlace::ModuleEnd => return,
            OutlinedPlace::List(scope) => (true, scope),
            OutlinedPlace::OwnBody => (false, self.current_scope),
        };
        for stmt in rc.take_outlined_from(outlined_len) {
            if let js_ast::StmtData::SFunction(function) = stmt.data
                && let Some(name) = function.func.name
            {
                // `Host::new_generated` listed the name in the module scope. The renamer numbers a name with the scope
                // that lists it, and no part declares this one at the top level.
                let in_module_scope = &mut self.module_scope_mut().generated;
                if let Some(at) = in_module_scope
                    .iter()
                    .rposition(|listed| *listed == name.ref_)
                {
                    in_module_scope.remove(at);
                }
                VecExt::append(&mut declared_in.generated, name.ref_);
            }
            if is_in_list {
                self.react_compiler_outlined_from_nested.push(stmt);
            } else {
                body.push(stmt);
            }
        }
    }

    /// Moves what [`Self::declare_outlined_from_nested`] left since `start` into the statement list that was visited:
    /// to the end of `visited`, or into `before` for a block, where `visit_stmts` makes a `let` of each like of the
    /// block's own function declarations. The statement of a label leaves them to the list around the label.
    #[cold]
    #[inline(never)]
    pub(crate) fn append_outlined_from_nested(
        &mut self,
        start: usize,
        visited: &mut bun_alloc::ArenaVec<'a, js_ast::Stmt>,
        before: &mut bun_alloc::ArenaVec<'a, js_ast::Stmt>,
    ) {
        let scope = self.current_scope();
        if scope.kind == js_ast::scope::Kind::Label {
            return;
        }
        let list = if scope.kind_stops_hoisting() {
            visited
        } else {
            before
        };
        list.extend(self.react_compiler_outlined_from_nested.drain(start..));
    }

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
