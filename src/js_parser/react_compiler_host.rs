//! `bun_react_compiler::Host` adapter over `&mut P`, kept in this crate so
//! `bun_react_compiler` stays free of a `bun_js_parser` dependency.
//!
//! Constructed inline at each post-visit hook site (`visit_stmt.rs`) around the
//! single `maybe_compile_*` call, then dropped — it owns no state of its own.

use bun_ast as js_ast;
use bun_ast::flags;
use bun_collections::VecExt;

use crate::JSXImport;
use crate::lexer::T;
use crate::p::P;
use crate::parse::parse_entry::end_of_binding_pattern;

/// What [`P::enter_react_compiler_candidate`] decided about a function.
#[derive(Clone, Copy)]
pub(crate) struct ReactCompilerCandidate {
    pub(crate) prev_may_replace_body: bool,
    pub(crate) taken: ReactCompilerTaken,
    /// The binding that names it: its own declaration, or the `A` in `const A = () => {}`.
    pub(crate) binding: Option<js_ast::Ref>,
    pub(crate) in_react_hoc: bool,
}

// A copy of this is in the frame of `visit_func` and of `e_arrow`, which recurse.
const _: () = assert!(core::mem::size_of::<ReactCompilerCandidate>() == 16);

/// Whether a function is handed to the compiler once its body has been visited. If it is, with the flags that the
/// host read from the source for it, which its node does not have: [`flags::Function::TsThisParamIsFirst`] and
/// [`flags::Function::HasPrimitivePropsType`].
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReactCompilerTaken {
    No,
    Yes {
        this_param_is_first: bool,
        has_primitive_props_type: bool,
    },
}

impl ReactCompilerTaken {
    /// For a function that is taken: the flags that the compiler gets on top of those of the node.
    #[inline]
    pub(crate) fn more_flags(self) -> Option<flags::FunctionSet> {
        let Self::Yes {
            this_param_is_first,
            has_primitive_props_type,
        } = self
        else {
            return None;
        };
        let mut more = flags::FUNCTION_NONE;
        if this_param_is_first {
            more |= flags::Function::TsThisParamIsFirst;
        }
        if has_primitive_props_type {
            more |= flags::Function::HasPrimitivePropsType;
        }
        Some(more)
    }
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
    ///
    /// `flags` is only called with the compiler on: an arrow has to put its flags together. `open_parens_loc` is read
    /// for a function that has a `this` parameter, which an arrow can't have.
    #[inline]
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn enter_react_compiler_candidate(
        &mut self,
        is_method: bool,
        is_top_level: bool,
        flags: impl FnOnce() -> flags::FunctionSet,
        open_parens_loc: bun_ast::Loc,
        args: &[js_ast::G::Arg],
        body_loc: bun_ast::Loc,
        body: &[js_ast::Stmt],
    ) -> ReactCompilerCandidate {
        // Without the compiler nothing sets the name, the `memo()` flag or `react_compiler_may_replace_body`.
        if self.react_compiler.is_none() {
            return ReactCompilerCandidate {
                prev_may_replace_body: false,
                taken: ReactCompilerTaken::No,
                binding: None,
                in_react_hoc: false,
            };
        }
        self.discover_react_compiler_candidate(
            is_method,
            is_top_level,
            flags(),
            open_parens_loc,
            args,
            body_loc,
            body,
        )
    }

    #[inline(never)]
    #[allow(clippy::too_many_arguments)]
    fn discover_react_compiler_candidate(
        &mut self,
        is_method: bool,
        is_top_level: bool,
        mut flags: flags::FunctionSet,
        open_parens_loc: bun_ast::Loc,
        args: &[js_ast::G::Arg],
        body_loc: bun_ast::Loc,
        body: &[js_ast::Stmt],
    ) -> ReactCompilerCandidate {
        let prev_may_replace_body = self.react_compiler_may_replace_body;
        let binding = (self.react_compiler_candidate_name.take()).filter(|r| r.is_valid());
        let in_react_hoc = core::mem::take(&mut self.react_compiler_in_react_hoc);
        let mut taken = ReactCompilerTaken::No;
        if !is_method
            && !prev_may_replace_body
            && self.enclosing_class_keyword.len == 0
            && let Some(rc) = self.react_compiler.take()
        {
            let name = binding.map(|r| self.load_name_from_ref(r));
            // Upstream asks where a `this` parameter is, and if the type of the first parameter is one that props
            // have. The parse pass kept neither.
            if TS
                && flags.contains(flags::Function::HasTsThisParam)
                && self.starts_with_this_param(open_parens_loc)
            {
                flags |= flags::Function::TsThisParamIsFirst;
            }
            let mut is_claimed = rc.may_compile(
                &ReactCompilerHost::new(self),
                name,
                in_react_hoc,
                is_top_level,
                flags,
                args,
                body,
            );
            // The type gives the compiler no function that it does not get without it, so it is read last, and
            // only for a function that is claimed without it.
            let mut is_readable = true;
            if TS
                && is_claimed
                && bun_react_compiler::reads_props_type(
                    &ReactCompilerHost::new(self),
                    name,
                    in_react_hoc,
                    args,
                    flags,
                )
            {
                match self.read_props_type_again(flags, open_parens_loc, args, body_loc) {
                    Some(true) => {
                        flags |= flags::Function::HasPrimitivePropsType;
                        is_claimed = rc.may_compile(
                            &ReactCompilerHost::new(self),
                            name,
                            in_react_hoc,
                            is_top_level,
                            flags,
                            args,
                            body,
                        );
                    }
                    Some(false) => {}
                    None => is_readable = false,
                }
            }
            self.react_compiler_may_replace_body = is_claimed;
            self.react_compiler = Some(rc);
            // A type that could not be read: if props have such a type, upstream compiles the function, and if not,
            // it asks about the functions inside it. Neither is done here, so that no function gets a memo cache
            // that upstream does not give it.
            if is_claimed && is_readable {
                taken = ReactCompilerTaken::Yes {
                    this_param_is_first: flags.contains(flags::Function::TsThisParamIsFirst),
                    has_primitive_props_type: flags
                        .contains(flags::Function::HasPrimitivePropsType),
                };
            }
        }
        ReactCompilerCandidate {
            prev_may_replace_body,
            taken,
            binding,
            in_react_hoc,
        }
    }

    /// Whether the parameters that start at `open_parens_loc` start with a `this` parameter.
    fn starts_with_this_param(&mut self, open_parens_loc: bun_ast::Loc) -> bool {
        let after_the_parse = self.lexer.snapshot();
        self.lexer.is_log_disabled = true;
        let is_first = self.put_lexer_at(open_parens_loc.start).is_ok()
            && self.lexer.token == T::TOpenParen
            && self.lexer.next().is_ok()
            && self.lexer.token == T::TThis;
        self.lexer.restore(&after_the_parse);
        is_first
    }

    /// [`flags::Function::HasPrimitivePropsType`] for a function of the file, read from the source: the type of the
    /// `this` parameter, which comes first in the parameters that Babel has, or else of the first argument. `None` if
    /// the lexer can't get to where that type is.
    #[cold]
    #[inline(never)]
    fn read_props_type_again(
        &mut self,
        flags: flags::FunctionSet,
        open_parens_loc: bun_ast::Loc,
        args: &[js_ast::G::Arg],
        body_loc: bun_ast::Loc,
    ) -> Option<bool> {
        let after_the_parse = self.lexer.snapshot();
        self.lexer.is_log_disabled = true;
        let is_primitive = self.skip_to_props_type_again(flags, open_parens_loc, args, body_loc);
        self.lexer.restore(&after_the_parse);
        is_primitive.ok()
    }

    fn skip_to_props_type_again(
        &mut self,
        flags: flags::FunctionSet,
        open_parens_loc: bun_ast::Loc,
        args: &[js_ast::G::Arg],
        body_loc: bun_ast::Loc,
    ) -> Result<bool, crate::Error> {
        use js_ast::binding::Data as B;
        if flags.contains(flags::Function::TsThisParamIsFirst) {
            self.put_lexer_at(open_parens_loc.start)?;
            self.lexer.expect(T::TOpenParen)?;
            self.lexer.expect(T::TThis)?;
        } else {
            // The parse pass went over the binding as a parameter or, for an arrow, as an expression, and kept where
            // an object pattern ends.
            let binding = &args.first().ok_or(crate::Error::Backtrack)?.binding;
            match &binding.data {
                B::BIdentifier(id) => {
                    self.put_lexer_at(binding.loc.start)?;
                    if self.lexer.token != T::TIdentifier
                        || self.lexer.identifier != self.load_name_from_ref(id.r#ref)
                    {
                        return Err(crate::Error::Backtrack);
                    }
                    self.lexer.next()?;
                }
                B::BObject(object) => {
                    self.put_lexer_at(object.close_brace_loc.start)?;
                    self.lexer.expect(T::TCloseBrace)?;
                }
                B::BArray(_) => {
                    self.put_lexer_at(binding.loc.start)?;
                    // The binding of a function type has no default value, no hole after an element and no computed
                    // key. An array pattern that has one of them is parsed once more, to where the body starts.
                    if self.lexer.token != T::TOpenBracket
                        || self.skip_type_script_binding().is_err()
                    {
                        let start = usize::try_from(binding.loc.start).ok();
                        let text = start
                            .zip(usize::try_from(body_loc.start).ok())
                            .and_then(|(start, end)| self.lexer.contents.get(start..end));
                        let end = text
                            .and_then(|text| {
                                end_of_binding_pattern(text, self.options.jsx.clone(), self.define)
                            })
                            .and_then(|end| i32::try_from(end).ok())
                            .ok_or(crate::Error::Backtrack)?;
                        self.put_lexer_at(binding.loc.start.saturating_add(end))?;
                    }
                }
                B::BMissing(_) => return Err(crate::Error::Backtrack),
            }
            // "function foo(a?: any) {}"
            if self.lexer.token == T::TQuestion {
                self.lexer.next()?;
            }
        }
        if self.lexer.token != T::TColon {
            return Ok(false);
        }
        self.lexer.next()?;
        self.skip_type_script_type_with_root()
    }

    /// Puts the lexer on the token that starts at the offset `start` of the source.
    fn put_lexer_at(&mut self, start: i32) -> Result<(), crate::Error> {
        self.lexer.current = usize::try_from(start).map_err(|_| crate::Error::Backtrack)?;
        self.lexer.step();
        Ok(self.lexer.next()?)
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
