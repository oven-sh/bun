//! `bun_react_compiler::Host` adapter over `&mut P`, kept in this crate so
//! `bun_react_compiler` stays free of a `bun_js_parser` dependency.
//!
//! Constructed inline around a call into the compiler, then dropped — it owns
//! no state of its own. The calls are the question at the entry of a function
//! (`P::enter_react_compiler_function`), the compile hook in `visit_stmts`, and
//! `finish`.

use bun_ast as js_ast;
use bun_collections::VecExt;
use bun_react_compiler::Discovery;
use bun_react_compiler::lowering::FunctionNode;

use crate::JSXImport;
use crate::p::P;

/// Where the visit pass is, for the React Compiler.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReactCompilerSearch {
    /// In no function that the compiler has taken: a function that is entered is asked about.
    Search,
    /// In a React function that stays as written, or in the decorators of a class. Upstream
    /// does not search these, so no function in here is asked about.
    Skip,
    /// In a function whose body the compiler replaces once it is visited, with its locals
    /// re-declared as new symbols. No function in here is asked about.
    Replace,
}

/// What [`P::enter_react_compiler_function`] found, for the frame that visits the function.
/// Two scalars, so that it is returned in registers.
#[derive(Clone, Copy)]
pub(crate) struct ReactCompilerEntered {
    pub(crate) found: Discovery,
    /// The binding that names a function that is compiled, or `Ref::NONE`.
    pub(crate) name: js_ast::Ref,
}

impl ReactCompilerEntered {
    const NOTHING: Self = Self {
        found: Discovery::Search,
        name: js_ast::Ref::NONE,
    };
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

    /// Visiting a function that the React Compiler compiles, which re-declares its locals as
    /// new symbols.
    #[inline]
    pub(crate) fn react_compiler_replaces_body(&self) -> bool {
        self.react_compiler_search == ReactCompilerSearch::Replace
    }

    /// The namespace import that `item` is a member of: the visit pass makes an import of its
    /// own of `ns.member`.
    fn namespace_of_import_item(&self, item: js_ast::Ref) -> Option<js_ast::Ref> {
        let symbol = self.symbols.get(item.inner_index() as usize)?;
        let name = symbol.original_name.slice();
        let mut all = self.import_items_for_namespace.iter();
        all.find_map(|(namespace, items)| (items.get(name)?.ref_ == item).then_some(*namespace))
    }

    /// Asks the React Compiler about a function that the visit pass enters, before anything of
    /// the function is visited: see `ReactCompilerState::enter_function`. A declaration has its
    /// own name for the compiler. The scope is the one around the function.
    #[inline]
    pub(crate) fn enter_react_compiler_function(
        &mut self,
        func: FunctionNode<'_>,
        is_declaration: bool,
    ) -> ReactCompilerEntered {
        if self.react_compiler.is_none() {
            return ReactCompilerEntered::NOTHING;
        }
        self.discover_react_function(func, is_declaration)
    }

    #[inline]
    pub(crate) fn leave_react_compiler_function(&mut self, entered: ReactCompilerEntered) {
        // A function is asked about in `Search` alone, so that is what it changed.
        if entered.found != Discovery::Search {
            self.react_compiler_search = ReactCompilerSearch::Search;
        }
    }

    /// For what upstream does not search: no function in it is asked about. Gives what to put
    /// back after it.
    pub(crate) fn skip_react_compiler_search(&mut self) -> ReactCompilerSearch {
        let outer = self.react_compiler_search;
        if outer == ReactCompilerSearch::Search {
            self.react_compiler_search = ReactCompilerSearch::Skip;
        }
        outer
    }

    #[inline(never)]
    fn discover_react_function(
        &mut self,
        func: FunctionNode<'_>,
        is_declaration: bool,
    ) -> ReactCompilerEntered {
        if self.react_compiler_search != ReactCompilerSearch::Search {
            return ReactCompilerEntered::NOTHING;
        }
        let declared_name = match func {
            // A method is no function to upstream: it is not asked about, and what is in it is.
            FunctionNode::Function(method)
                if method
                    .flags
                    .contains(js_ast::flags::Function::IsUniqueFormalParameters) =>
            {
                return ReactCompilerEntered::NOTHING;
            }
            FunctionNode::Function(declaration) if is_declaration => {
                declaration.name.and_then(|name| name.ref_.to_nullable())
            }
            _ => None,
        };
        let Some(mut rc) = self.react_compiler.take() else {
            return ReactCompilerEntered::NOTHING;
        };
        let is_in_class = self.enclosing_class_keyword.len > 0;
        let is_top_level = self.current_scope == self.module_scope;
        let (found, name) = rc.enter_function(
            &ReactCompilerHost::new(self),
            &func,
            declared_name,
            is_in_class,
            is_top_level,
        );
        self.react_compiler = Some(rc);
        self.react_compiler_search = match found {
            Discovery::Search => return ReactCompilerEntered::NOTHING,
            Discovery::Skip => ReactCompilerSearch::Skip,
            Discovery::Compile(_) => ReactCompilerSearch::Replace,
        };
        ReactCompilerEntered {
            found,
            name: name.unwrap_or(js_ast::Ref::NONE),
        }
    }

    /// Upstream takes a function that is an argument of `memo()`, `forwardRef()`, `React.memo()`
    /// or `React.forwardRef()` for a component. The target of `call` is visited, its arguments
    /// are not.
    #[inline(never)]
    pub(crate) fn note_react_wrapper_callbacks(&mut self, call: &js_ast::E::Call) {
        use js_ast::expr::Data;
        if self.react_compiler_search != ReactCompilerSearch::Search
            || self.is_revisit_for_substitution
            || call.optional_chain.is_some()
            || !self.is_react_wrapper(&call.target)
        {
            return;
        }
        let Some(rc) = self.react_compiler.as_deref_mut() else {
            return;
        };
        // The last argument first: the arguments are visited in order, and the compiler takes
        // the note that was added last first.
        for arg in call.args.slice().iter().rev() {
            match &arg.data {
                Data::EArrow(arrow) => rc.note_wrapper_callback(arrow.body.loc),
                Data::EFunction(function) => rc.note_wrapper_callback(function.func.body.loc),
                _ => {}
            }
        }
    }

    /// Upstream `isReactAPI`, for a callee that the visit pass has visited: `memo`,
    /// `forwardRef`, and either as a member of an object that is named `React`.
    fn is_react_wrapper(&self, target: &js_ast::Expr) -> bool {
        use js_ast::expr::Data;
        let is_react = |object: js_ast::Ref| self.load_name_from_ref(object) == b"React";
        let name: &[u8] = match &target.data {
            Data::EIdentifier(id) => self.load_name_from_ref(id.ref_),
            Data::EImportIdentifier(id) if id.was_originally_identifier() => {
                self.load_name_from_ref(id.ref_)
            }
            // `ns.memo`, for a namespace import `ns`.
            Data::EImportIdentifier(id) => {
                let name = self.load_name_from_ref(id.ref_);
                if name != b"forwardRef" && name != b"memo" {
                    return false;
                }
                return self.namespace_of_import_item(id.ref_).is_some_and(is_react);
            }
            Data::EDot(member) if member.optional_chain.is_none() => {
                let is_member_of_react = match &member.target.data {
                    Data::EIdentifier(object) => is_react(object.ref_),
                    Data::EImportIdentifier(object) => is_react(object.ref_),
                    _ => false,
                };
                if !is_member_of_react {
                    return false;
                }
                member.name.slice()
            }
            _ => return false,
        };
        name == b"forwardRef" || name == b"memo"
    }
}
