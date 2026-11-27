//! Converts one function of the file to the tree that Bun's parser would hand to the React
//! Compiler, so that the compiler's own lowering (`src/react_compiler/lowering`) can read it.
//!
//! Differences from the parser's tree:
//! - Nothing has been folded, dropped or lowered. It's the source without its types.
//! - A `Loc` isn't an offset. It's an index into [`Converted::spans`], which has the node's range.
//!   The indices grow in source order, which is all the lowering needs from a `Loc`. The compiler's
//!   diagnostics carry the `Loc`s they were given, and [`Converted::span_of`] maps them back.
//! - A `Ref` is an index into [`Converted::symbols`], which has only the symbols that the function
//!   mentions.
//! - JSX is a classic-runtime call, `createElement(tag, props, ...children)`, which keeps the
//!   attributes in order. The lowering turns it back into a `JsxExpression`.

use crate::compile::Flavor;
use bun_alloc::{Arena, AstAlloc, AstVec};
use bun_ast::base::RefTag;
use bun_ast::{
    ArrayBinding, B, Binding, Case, Catch, E, Expr as JsExpr, Finally, G, Loc, LocRef, OpCode,
    OptionalChain, Range, Ref, S, Stmt as JsStmt, StoreSlice, StoreStr, Symbol as JsSymbol,
    SymbolKind, flags,
};
use bun_lint::ast::walk::{Visitor, walk_node};
use bun_lint::ast::{
    BinOp, Call, Chain, Class, Expr, ExprKind, ExprTag, File, Flags, FnBody, FnKind, Func, Ident,
    Jsx, Key, KeyKind, List, Member, MemberKind, Name, Node, Param, Pat, PatKind, Prop, PropKind,
    Stmt, StmtKind, Template, UnOp, VarDecl, VarKind,
};
use bun_lint::semantic::{Declaration, Reference, Symbol};
use bun_lint::span::Span;
use bun_react_compiler::hir::VariableBinding;
use rustc_hash::FxHashMap;

/// Why a function couldn't be converted.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum ConvertError {
    /// Not enough stack left on this thread.
    TooDeep,
    /// Upstream's lowering throws an error without a location for a `this` parameter, and the
    /// ESLint plugin drops it.
    ThisParameter,
    /// `using`, which oxlint's compiler silently skips.
    Using,
}

type Converts<T> = Result<T, ConvertError>;

pub(crate) enum Root {
    Function(G::Fn),
    Arrow(E::Arrow),
}

pub(crate) struct Converted {
    pub(crate) root: Root,
    pub(crate) spans: Vec<Span>,
    pub(crate) symbols: Vec<JsSymbol>,
    /// For each of `symbols`: true if it's bound outside the function, or not bound at all.
    pub(crate) is_outside: Vec<bool>,
    pub(crate) import_bindings: Vec<(Ref, VariableBinding)>,
    /// The tag of `<>`.
    pub(crate) fragment: Ref,
    pub(crate) recorded: Vec<Recorded>,
    /// [`Host::type_casts`](bun_react_compiler::Host::type_casts)
    pub(crate) casts: Vec<(Loc, Loc)>,
    /// [`Host::targets_with_defaults`](bun_react_compiler::Host::targets_with_defaults)
    pub(crate) defaults: Vec<(Loc, Loc)>,
    /// [`Host::parentheses`](bun_react_compiler::Host::parentheses)
    pub(crate) parentheses: Vec<(Loc, Loc)>,
    pub(crate) wrapped_defaults: Vec<WrappedDefault>,
    /// Each `new Date()` and `Date()` that the tree has as `Date.now()`. In source order.
    pub(crate) clock_reads: Vec<Span>,
    /// [`Host::is_tagged_template`](bun_react_compiler::Host::is_tagged_template)
    pub(crate) tagged_templates: Vec<Loc>,
    /// Each string key with a lone surrogate that the tree has no key for, in the order in which oxc's lowering would
    /// come to them. It gives up on the function at the first that it lowers, and Bun's records a `Todo` at each.
    pub(crate) lone_surrogate_keys: Vec<Span>,
}

/// A default value wrapped in parentheses or a cast. oxc's lowering names it after the outermost wrapper.
#[derive(Copy, Clone)]
pub(crate) struct WrappedDefault {
    /// The span that Bun's lowering reports, since it doesn't see the wrappers.
    pub(crate) inner: Span,
    pub(crate) whole: Span,
    pub(crate) kind: &'static str,
}

/// A diagnostic that the flavor's own lowering records and Bun's doesn't.
pub(crate) enum Recorded {
    /// A read of a function's implicit `arguments`.
    ImplicitArguments(Span),
    /// The `import` in `import(..)`.
    DynamicImport(Span),
    /// JSX as the default of a parameter or in a pattern. Bun's lowering sees a call, which can be
    /// evaluated earlier if its operands can.
    DefaultIsJsx { span: Span, is_fragment: bool },
    /// An `<fbt>` with more than one `<fbt:plural>` in it, at any depth. Bun's lowering sees JSX as
    /// a call and knows nothing about fbt.
    DuplicateFbtTags {
        /// `fbt` or `fbs`
        tag: &'static str,
        /// `enum`, `plural` or `pronoun`
        name: &'static str,
        tag_spans: Vec<Span>,
    },
}

const FBT_TAGS: [&str; 3] = ["enum", "plural", "pronoun"];

/// The `<fbt:enum>`, `<fbt:plural>` and `<fbt:pronoun>` in an `<fbt>`.
struct FbtTags<'a> {
    file: &'a File<'a>,
    tag: &'static str,
    /// Upstream searches for the name, which can also be an attribute's. oxc's fork only checks tags.
    also_attributes: bool,
    tag_spans: [Vec<Span>; 3],
}

impl FbtTags<'_> {
    fn name_at(&mut self, start: u32) {
        if let Some((namespace, name)) = self.file.jsx_namespace_and_name(start)
            && self.file.slice(namespace) == self.tag.as_bytes()
            && let Some(at) =
                (FBT_TAGS.iter()).position(|it| it.as_bytes() == self.file.slice(name))
        {
            self.tag_spans[at].push(Span::new(namespace.start, name.end));
        }
    }
}

impl<'a> Visitor<'a> for FbtTags<'a> {
    fn enter(&mut self, node: Node<'a>) {
        let Some(ExprKind::Jsx(jsx)) = node.as_expr().map(Expr::kind) else {
            return;
        };
        if let Some(tag) = jsx.tag() {
            self.name_at(tag.span().start);
        }
        if self.also_attributes {
            for attr in jsx.attrs() {
                self.name_at(attr.span().start);
            }
        }
    }
    fn exit(&mut self, _: Node<'a>) {}
}

impl Converted {
    /// The range of the node that was given `Loc { start: index }`.
    pub(crate) fn span_of(&self, index: u32) -> Option<Span> {
        self.spans.get(index as usize).copied()
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Named {
    Global,
    Label,
    Private,
}

/// The body that oxc's compiler takes the code being converted to be in. It reports a zero-argument `new Date()` in
/// the body of the function that it compiles, which has the bodies of the functions that it inlines there.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Body {
    /// The compiled function's, where a function that's called at once is inlined.
    Compiled,
    /// The compiled function's, in an operand that the lowering gives a block of its own. Nothing is inlined there.
    Operand,
    /// An inlined function's.
    Inlined,
    /// Any other function's.
    Nested,
}

pub(crate) struct Converter<'a, 'x> {
    file: &'a File<'a>,
    arena: &'x Arena,
    flavor: Flavor,
    /// The range of the function being compiled.
    root: Span,
    spans: Vec<Span>,
    symbols: Vec<JsSymbol>,
    is_outside: Vec<bool>,
    import_bindings: Vec<(Ref, VariableBinding)>,
    by_symbol: FxHashMap<usize, Ref>,
    by_name: FxHashMap<(Named, Name<'a>), Ref>,
    create_element: Ref,
    fragment: Ref,
    recorded: Vec<Recorded>,
    casts: Vec<(Loc, Loc)>,
    defaults: Vec<(Loc, Loc)>,
    parentheses: Vec<(Loc, Loc)>,
    wrapped_defaults: Vec<WrappedDefault>,
    clock_reads: Vec<Span>,
    tagged_templates: Vec<Loc>,
    body: Body,
    /// The function that oxc's compiler inlines into the compiled one, from when its call is converted until it is.
    inlined: Option<Span>,
    /// True if oxc's compiler has inlined a call earlier in the block of the lowering that the code being converted is
    /// in. It splits the block at the call, and comes to the rest of it after all the blocks that the lowering made.
    is_after_inlined_call: bool,
    /// How many `try` blocks with a `catch` the code being converted is in, within its function. The lowering gives
    /// each instruction there a block of its own.
    try_depth: u32,
    /// True for the target of an assignment, from before it's converted until it is. An assignment in a target is
    /// a default.
    is_target: bool,
    /// True in what oxc's lowering doesn't read: a class, a getter or setter, the operand of `yield`, a `catch`
    /// parameter.
    is_unread: bool,
    lone_surrogate_keys: Vec<Span>,
    stack: bun_core::StackCheck,
}

/// `func` must have a body. The caller must have entered an AST allocator scope that outlives the result.
pub(crate) fn convert<'a>(
    file: &'a File<'a>,
    arena: &Arena,
    func: Func<'a>,
    flavor: Flavor,
) -> Converts<Converted> {
    let stack = bun_core::StackCheck::init();
    let mut converter = Converter {
        file,
        arena,
        flavor,
        root: func.estree_span(),
        spans: Vec::with_capacity(256),
        symbols: Vec::with_capacity(32),
        is_outside: Vec::with_capacity(32),
        import_bindings: Vec::new(),
        by_symbol: FxHashMap::default(),
        by_name: FxHashMap::default(),
        create_element: Ref::NONE,
        fragment: Ref::NONE,
        recorded: Vec::new(),
        casts: Vec::new(),
        defaults: Vec::new(),
        parentheses: Vec::new(),
        wrapped_defaults: Vec::new(),
        clock_reads: Vec::new(),
        tagged_templates: Vec::new(),
        body: Body::Nested,
        inlined: None,
        is_after_inlined_call: false,
        try_depth: 0,
        is_target: false,
        is_unread: false,
        lone_surrogate_keys: Vec::new(),
        stack,
    };
    converter.create_element = converter.new_symbol(b"createElement", SymbolKind::Unbound, true);
    converter.fragment = converter.new_symbol(b"Fragment", SymbolKind::Unbound, true);
    let root = match func.is_arrow() {
        true => Root::Arrow(converter.arrow(func)?),
        false => Root::Function(converter.function(func)?),
    };
    // `(x as A) as B` is recorded twice with the same start. Keep the outer cast, which was pushed later.
    let mut casts = converter.casts;
    casts.reverse();
    bun_lint::utils::sort::sort_by_key(&mut casts, |it| it.0.start);
    casts.dedup_by_key(|it| it.0.start);
    let mut defaults = converter.defaults;
    bun_lint::utils::sort::sort_by_key(&mut defaults, |it| it.0.start);
    // Same for `((x) as A)`.
    let mut parentheses = converter.parentheses;
    parentheses.reverse();
    bun_lint::utils::sort::sort_by_key(&mut parentheses, |it| it.0.start);
    parentheses.dedup_by_key(|it| it.0.start);
    Ok(Converted {
        root,
        casts,
        defaults,
        parentheses,
        wrapped_defaults: converter.wrapped_defaults,
        spans: converter.spans,
        symbols: converter.symbols,
        is_outside: converter.is_outside,
        import_bindings: converter.import_bindings,
        fragment: converter.fragment,
        recorded: converter.recorded,
        clock_reads: converter.clock_reads,
        tagged_templates: converter.tagged_templates,
        lone_surrogate_keys: converter.lone_surrogate_keys,
    })
}

fn leak<T>(list: AstVec<T>) -> StoreSlice<T> {
    StoreSlice::new_mut(list.leak())
}

impl<'a> Converter<'a, '_> {
    // ──────────────────────────── locations ───────────────────────────

    fn loc(&mut self, span: Span) -> Loc {
        let index = self.spans.len() as i32;
        self.spans.push(span);
        Loc { start: index }
    }

    /// Calls `then` if there's enough stack left to recurse.
    fn nested<T>(&mut self, then: impl FnOnce(&mut Self) -> Converts<T>) -> Converts<T> {
        match self.stack.is_safe_to_recurse() {
            true => then(self),
            false => Err(ConvertError::TooDeep),
        }
    }

    /// Converts with `then` what the lowering gives a block of its own, if `is_operand`.
    fn in_operand<T>(
        &mut self,
        is_operand: bool,
        then: impl FnOnce(&mut Self) -> Converts<T>,
    ) -> Converts<T> {
        let outer = self.body;
        if is_operand && outer == Body::Compiled {
            self.body = Body::Operand;
        }
        let converted = then(self);
        self.body = outer;
        converted
    }

    fn operand(&mut self, expr: Expr<'a>) -> Converts<JsExpr> {
        self.in_operand(true, |this| this.expr(expr))
    }

    /// What's converted next is in another block of the lowering than what was converted last.
    fn block_ends(&mut self) {
        self.is_after_inlined_call = false;
    }

    /// How many keys with a lone surrogate have been found.
    fn keys(&self) -> usize {
        self.lone_surrogate_keys.len()
    }

    /// Of the keys found since there were `from`, those found since there were `mid` are first for the lowering.
    fn later_keys_first(&mut self, from: usize, mid: usize) {
        if let Some(keys) = self.lone_surrogate_keys.get_mut(from..)
            && let Some(earlier) = mid.checked_sub(from)
            && earlier <= keys.len()
        {
            keys.rotate_left(earlier);
        }
    }

    /// Converts with `then` what oxc's lowering doesn't read.
    fn unread<T>(&mut self, then: impl FnOnce(&mut Self) -> Converts<T>) -> Converts<T> {
        let outer = std::mem::replace(&mut self.is_unread, true);
        let converted = then(self);
        self.is_unread = outer;
        converted
    }

    // ───────────────────────────── symbols ─────────────────────────────

    fn new_symbol(&mut self, name: &[u8], kind: SymbolKind, is_outside: bool) -> Ref {
        let index = self.symbols.len() as u32;
        self.symbols.push(JsSymbol {
            original_name: StoreStr::new(name),
            kind,
            ..JsSymbol::default()
        });
        self.is_outside.push(is_outside);
        Ref::new(index, 0, RefTag::Symbol)
    }

    fn ref_of_name(&mut self, named: Named, name: Name<'a>) -> Ref {
        if let Some(known) = self.by_name.get(&(named, name)) {
            return *known;
        }
        let kind = match named {
            Named::Global => SymbolKind::Unbound,
            Named::Label => SymbolKind::Label,
            Named::Private => SymbolKind::PrivateField,
        };
        let made = self.new_symbol(name.bytes(), kind, true);
        self.by_name.insert((named, name), made);
        made
    }

    /// For oxc's lowering, what's declared with `declare` is a global, wherever the declaration is.
    fn is_global_to_oxc(&self, symbol: Symbol<'a>) -> bool {
        self.flavor == Flavor::Oxlint && !self.file.is_javascript() && is_ambient(symbol)
    }

    fn ref_of_symbol(&mut self, symbol: Symbol<'a>) -> Ref {
        if let Some(known) = self.by_symbol.get(&symbol.key()) {
            return *known;
        }
        if self.is_global_to_oxc(symbol) {
            let global = self.ref_of_name(Named::Global, symbol.name());
            self.by_symbol.insert(symbol.key(), global);
            return global;
        }
        let declaration = symbol.declarations().next();
        let is_outside = !self.root.contains(symbol.scope().span())
            || matches!(declaration, Some(Declaration::Fn(func)) if self.treats_own_name_as_outer(func));
        let name = StoreStr::new(symbol.name().bytes());
        let import = match declaration {
            Some(Declaration::ImportDefault(import)) => Some(VariableBinding::ImportDefault {
                name,
                module: StoreStr::new(import.spec().bytes()),
            }),
            Some(Declaration::ImportNamespace(import)) => Some(VariableBinding::ImportNamespace {
                name,
                module: StoreStr::new(import.spec().bytes()),
            }),
            Some(Declaration::ImportSpec(spec)) => {
                let module = StoreStr::new(spec.import().spec().bytes());
                let imported: &[u8] = match spec.imported().bytes() {
                    // oxc's compiler knows that this one is just as incompatible as `useVirtualizer`.
                    b"useWindowVirtualizer"
                        if self.flavor == Flavor::Oxlint
                            && spec.import().spec().is("@tanstack/react-virtual") =>
                    {
                        b"useVirtualizer"
                    }
                    imported => imported,
                };
                Some(match spec.imported().name().is("default") {
                    true => VariableBinding::ImportDefault { name, module },
                    false => VariableBinding::ImportSpecifier {
                        name,
                        module,
                        imported: StoreStr::new(imported),
                    },
                })
            }
            _ => None,
        };
        let kind = match declaration {
            _ if import.is_some() => SymbolKind::Import,
            // The lowering only needs to know that it isn't a local, and of `x ??= y` whether `x` is a constant.
            Some(declaration @ Declaration::Var(_))
                if is_outside
                    && self.flavor == Flavor::Oxlint
                    && !declaration.is_catch_parameter() =>
            {
                match declaration.node() {
                    Some(Node::VarDecl(it))
                        if !matches!(it.var_kind(), VarKind::Var | VarKind::Let) =>
                    {
                        SymbolKind::Constant
                    }
                    _ => SymbolKind::Other,
                }
            }
            _ if is_outside => SymbolKind::Other,
            Some(declaration @ Declaration::Var(_)) if declaration.is_catch_parameter() => {
                SymbolKind::CatchIdentifier
            }
            Some(declaration @ Declaration::Var(_)) => match declaration.node() {
                Some(Node::VarDecl(it)) => match it.var_kind() {
                    VarKind::Var => SymbolKind::Hoisted,
                    VarKind::Let => SymbolKind::Other,
                    VarKind::Const | VarKind::Using | VarKind::AwaitUsing => SymbolKind::Constant,
                },
                _ => SymbolKind::Other,
            },
            Some(Declaration::Param(_)) => SymbolKind::Hoisted,
            Some(Declaration::Fn(func)) if func.kind() == FnKind::Decl => {
                match func.is_async() || func.is_generator() {
                    true => SymbolKind::GeneratorOrAsyncFunction,
                    false => SymbolKind::HoistedFunction,
                }
            }
            Some(Declaration::Class(_)) => SymbolKind::Class,
            Some(Declaration::Enum(_)) => SymbolKind::TsEnum,
            Some(Declaration::Module(_)) => SymbolKind::TsNamespace,
            _ => SymbolKind::Other,
        };
        let made = self.new_symbol(symbol.name().bytes(), kind, is_outside);
        if let Some(import) = import {
            self.import_bindings.push((made, import));
        }
        self.by_symbol.insert(symbol.key(), made);
        made
    }

    /// Returns what the identifier `expr`, named `name`, refers to.
    fn ref_of_identifier(&mut self, expr: Expr<'a>, name: Name<'a>) -> Ref {
        match expr.symbol() {
            Some(symbol) => self.ref_of_symbol(symbol),
            None => {
                if name.is("arguments") && self.flavor == Flavor::Oxlint {
                    self.recorded.push(Recorded::ImplicitArguments(expr.span()));
                }
                self.ref_of_name(Named::Global, name)
            }
        }
    }

    fn declared(&mut self, symbol: Option<Symbol<'a>>, name: Name<'a>) -> Ref {
        match symbol {
            Some(symbol) => self.ref_of_symbol(symbol),
            // Nothing refers to it.
            None => self.new_symbol(name.bytes(), SymbolKind::Other, false),
        }
    }

    // ───────────────────────────── functions ─────────────────────────────

    /// The parameters, whether the last one is a rest parameter, and statements to put at the start
    /// of the body.
    fn args(&mut self, func: Func<'a>) -> Converts<(StoreSlice<G::Arg>, bool, AstVec<JsStmt>)> {
        // A `this` parameter is only a type, and oxc's lowering doesn't see it either. Upstream's rejects it.
        if self.flavor == Flavor::Eslint && func.this_param().is_some() {
            return Err(ConvertError::ThisParameter);
        }
        let params = func.params();
        let mut args: AstVec<G::Arg> = AstAlloc::vec_with_capacity(params.len());
        let mut has_rest = false;
        let mut first: AstVec<JsStmt> = AstAlloc::vec();
        for param in params {
            has_rest = param.is_rest();
            args.push(self.arg(param, &mut first)?);
        }
        Ok((leak(args), has_rest, first))
    }

    fn arg(&mut self, param: Param<'a>, first: &mut AstVec<JsStmt>) -> Converts<G::Arg> {
        let (mut binding, default) = self.binding_with_default(param.pat(), param.default())?;
        // oxc's lowering destructures a parameter like a declaration, which supports variables that
        // a nested function assigns. Upstream's only does that for an object's `...rest`, and Bun's
        // never does.
        let is_destructured_in_body = match (self.flavor, param.pat().kind()) {
            (Flavor::Oxlint, PatKind::Object(_) | PatKind::Array(_)) => is_assigned(param.pat()),
            (Flavor::Eslint, PatKind::Object(props)) => props
                .iter()
                .all(|it| it.is_rest() || !is_assigned(it.value())),
            _ => false,
        };
        if is_destructured_in_body && !param.is_rest() && is_assigned(param.pat()) {
            binding = self.destructure_in_body(binding, SymbolKind::Hoisted, first);
        }
        Ok(G::Arg {
            binding,
            default,
            ..G::Arg::default()
        })
    }

    /// Rewrites `({ a }) => ..` as `(t) => { let { a } = t; .. }`. Returns the `t` and adds the
    /// declaration to `first`. The read of `t` has the `Loc` of its declaration, which is how the compiler's
    /// `converted_patterns` knows that the source has no `t`.
    fn destructure_in_body(
        &mut self,
        binding: Binding,
        kind: SymbolKind,
        first: &mut AstVec<JsStmt>,
    ) -> Binding {
        let loc = binding.loc;
        let r#ref = self.new_symbol(b"t", kind, false);
        let mut decls: G::DeclList = AstAlloc::vec_with_capacity(1);
        decls.push(G::Decl {
            binding,
            value: Some(JsExpr::init_identifier(r#ref, loc)),
        });
        first.push(JsStmt::alloc(
            S::Local {
                kind: S::Kind::KLet,
                decls,
                ..S::Local::default()
            },
            loc,
        ));
        Binding::alloc(self.arena, B::Identifier { r#ref }, loc)
    }

    /// The body, with `first` in front, and whether it's an expression. The lowering uses the
    /// body's `Loc` as the function's.
    fn body(
        &mut self,
        func: Func<'a>,
        loc: Loc,
        first: AstVec<JsStmt>,
    ) -> Converts<(G::FnBody, bool)> {
        let is_expression = first.is_empty() && matches!(func.body(), FnBody::Expr(_));
        let stmts = match func.body() {
            FnBody::None => leak(first),
            FnBody::Block(statements) => self.stmts_after(first, statements)?,
            FnBody::Expr(value) => {
                let mut stmts = first;
                let value = self.expr(value)?;
                stmts.push(JsStmt::alloc(S::Return { value: Some(value) }, value.loc));
                leak(stmts)
            }
        };
        Ok((G::FnBody { loc, stmts }, is_expression))
    }

    /// [`Self::args`] and [`Self::body`] of `func`, whose `Loc` is `loc`: the parameters, whether the last one is a
    /// rest parameter, the body, and whether the body is an expression.
    fn args_and_body(
        &mut self,
        func: Func<'a>,
        loc: Loc,
    ) -> Converts<(StoreSlice<G::Arg>, bool, G::FnBody, bool)> {
        let span = func.estree_span();
        let outer = self.body;
        self.body = match outer {
            _ if span == self.root => Body::Compiled,
            Body::Compiled if self.inlined == Some(span) => Body::Inlined,
            _ => Body::Nested,
        };
        self.inlined = None;
        let is_after_inlined_call = std::mem::take(&mut self.is_after_inlined_call);
        let try_depth = std::mem::take(&mut self.try_depth);
        let (args, has_rest, first) = self.args(func)?;
        let (body, is_expression) = self.body(func, loc, first)?;
        self.body = outer;
        self.is_after_inlined_call = is_after_inlined_call;
        self.try_depth = try_depth;
        Ok((args, has_rest, body, is_expression))
    }

    /// Upstream's compiler fails on a function expression that refers to itself by name. oxc's
    /// doesn't: it treats the name like one from outside.
    fn treats_own_name_as_outer(&self, func: Func<'a>) -> bool {
        self.flavor == Flavor::Oxlint && func.kind() == FnKind::Expr
    }

    /// The function being compiled keeps its name, because the name determines what kind of
    /// function it is.
    fn drops_own_name(&self, func: Func<'a>) -> bool {
        self.treats_own_name_as_outer(func) && func.estree_span() != self.root
    }

    fn function(&mut self, func: Func<'a>) -> Converts<G::Fn> {
        self.nested(|this| {
            let loc = this.loc(func.estree_span());
            let name = match func.name() {
                Some(_) if this.drops_own_name(func) => None,
                Some(name) => Some(LocRef {
                    loc: this.loc(name.span()),
                    ref_: this.declared(func.symbol(), name.name()),
                }),
                None => None,
            };
            let (args, has_rest, body, _) = this.args_and_body(func, loc)?;
            let mut flags = flags::FUNCTION_NONE;
            if func.is_async() {
                flags |= flags::Function::IsAsync;
            }
            if func.is_generator() {
                flags |= flags::Function::IsGenerator;
            }
            if has_rest {
                flags |= flags::Function::HasRestArg;
            }
            Ok(G::Fn {
                name,
                open_parens_loc: loc,
                args,
                body,
                flags,
                ..G::Fn::default()
            })
        })
    }

    fn arrow(&mut self, func: Func<'a>) -> Converts<E::Arrow> {
        self.nested(|this| {
            let loc = this.loc(func.estree_span());
            let (args, has_rest_arg, body, prefer_expr) = this.args_and_body(func, loc)?;
            Ok(E::Arrow {
                args,
                body,
                is_async: func.is_async(),
                has_rest_arg,
                prefer_expr,
                has_react_hooks_suppression: false,
            })
        })
    }

    /// Converts a function expression, an arrow function, or a method's value, at `span`.
    fn function_expr(&mut self, func: Func<'a>, span: Span) -> Converts<JsExpr> {
        let loc = self.loc(span);
        Ok(match func.is_arrow() {
            true => JsExpr::init(self.arrow(func)?, loc),
            false => JsExpr::init(
                E::Function {
                    func: self.function(func)?,
                },
                loc,
            ),
        })
    }

    // ───────────────────────────── patterns ─────────────────────────────

    /// Converts a pattern and its default, which the lowering comes to first.
    fn binding_with_default(
        &mut self,
        pat: Pat<'a>,
        default: Option<Expr<'a>>,
    ) -> Converts<(Binding, Option<JsExpr>)> {
        let from = self.keys();
        let binding = self.binding(pat)?;
        let after_binding = self.keys();
        let default = self.default(&binding, pat, default)?;
        self.later_keys_first(from, after_binding);
        Ok((binding, default))
    }

    fn default(
        &mut self,
        binding: &Binding,
        target: Pat<'a>,
        value: Option<Expr<'a>>,
    ) -> Converts<Option<JsExpr>> {
        let Some(value) = value else {
            return Ok(None);
        };
        let whole = self.loc(Span::new(target.span().start, value.span().end));
        self.defaults.push((binding.loc, whole));
        if let ExprKind::Jsx(jsx) = value.skip_type_wrappers().kind() {
            self.recorded.push(Recorded::DefaultIsJsx {
                span: value.span(),
                is_fragment: jsx.is_fragment(),
            });
        }
        let converted = self.operand(value)?;
        self.block_ends();
        let kind = match value.kind() {
            _ if self.flavor != Flavor::Oxlint => None,
            _ if value.is_parenthesized() => Some("ParenthesizedExpression"),
            ExprKind::As { .. } | ExprKind::AsConst(_) if value.is_angle_bracket_assertion() => {
                Some("TSTypeAssertion")
            }
            ExprKind::As { .. } | ExprKind::AsConst(_) => Some("TSAsExpression"),
            ExprKind::Satisfies { .. } => Some("TSSatisfiesExpression"),
            ExprKind::NonNull(_) => Some("TSNonNullExpression"),
            ExprKind::Instantiation { .. } => Some("TSInstantiationExpression"),
            _ => None,
        };
        if let Some(kind) = kind
            && let Some(&inner) = usize::try_from(converted.loc.start)
                .ok()
                .and_then(|index| self.spans.get(index))
        {
            self.wrapped_defaults.push(WrappedDefault {
                inner,
                whole: value.outer_span(),
                kind,
            });
        }
        Ok(Some(converted))
    }

    fn binding(&mut self, pat: Pat<'a>) -> Converts<Binding> {
        self.nested(|this| {
            let loc = this.loc(pat.span());
            Ok(match pat.kind() {
                PatKind::Missing => Binding {
                    loc,
                    data: B::B::BMissing(B::Missing {}),
                },
                PatKind::Ident(name) => {
                    let r#ref = match pat.symbol() {
                        // oxc's lowering declares a local that nothing refers to: each reference is to the global.
                        Some(symbol) if this.is_global_to_oxc(symbol) => {
                            this.new_symbol(name.bytes(), SymbolKind::Other, false)
                        }
                        symbol => this.declared(symbol, name),
                    };
                    Binding::alloc(this.arena, B::Identifier { r#ref }, loc)
                }
                PatKind::Array(elements) => {
                    let mut items: AstVec<ArrayBinding> =
                        AstAlloc::vec_with_capacity(elements.len());
                    let mut has_spread = false;
                    for element in elements {
                        has_spread = element.is_rest();
                        let (binding, default_value) = match element.pat() {
                            Some(pat) => this.binding_with_default(pat, element.default())?,
                            None => {
                                let loc = this.loc(element.span());
                                let data = B::B::BMissing(B::Missing {});
                                (Binding { loc, data }, None)
                            }
                        };
                        items.push(ArrayBinding {
                            binding,
                            default_value,
                        });
                    }
                    let array = B::Array {
                        items: leak(items),
                        has_spread,
                        is_single_line: false,
                    };
                    Binding::alloc(this.arena, array, loc)
                }
                PatKind::Object(props) => {
                    let mut properties: AstVec<B::Property> =
                        AstAlloc::vec_with_capacity(props.len());
                    for prop in props {
                        let (key, mut flags) = match prop.key() {
                            Some(key) => this.key(key, None)?,
                            None => (JsExpr::EMPTY, flags::PROPERTY_NONE),
                        };
                        if prop.is_rest() {
                            flags |= flags::Property::IsSpread;
                        }
                        let (value, default_value) =
                            this.binding_with_default(prop.value(), prop.default())?;
                        properties.push(B::Property {
                            flags,
                            key,
                            value,
                            default_value,
                        });
                    }
                    let object = B::Object {
                        properties: leak(properties),
                        is_single_line: false,
                        close_brace_loc: Loc::EMPTY,
                    };
                    Binding::alloc(this.arena, object, loc)
                }
            })
        })
    }

    // ───────────────────────────── keys and properties ─────────────────────────────

    fn string(&mut self, value: &[u8], span: Span) -> Converts<JsExpr> {
        Ok(JsExpr::init(E::EString::init(value), self.loc(span)))
    }

    /// What the tree has for a string key named `name` with a lone surrogate, where oxc's lowering gives up on the
    /// function: no key, which Bun's lowering records where it would lower it. A template isn't such a key.
    fn lone_surrogate_key(&mut self, name: Name<'a>, key: Key<'a>) -> Option<JsExpr> {
        if self.flavor != Flavor::Oxlint
            || self.is_unread
            || !bun_core::strings::wtf8_has_surrogate(name.bytes())
        {
            return None;
        }
        let span = key.inner_span(self.file);
        if !matches!(self.file.slice(span).first(), Some(b'"' | b'\'')) {
            return None;
        }
        self.lone_surrogate_keys.push(span);
        Some(JsExpr::init(E::Missing {}, self.loc(span)))
    }

    /// `at` overrides the span of a key that isn't computed.
    fn key(&mut self, key: Key<'a>, at: Option<Span>) -> Converts<(JsExpr, flags::PropertySet)> {
        let span = at.unwrap_or_else(|| key.inner_span(self.file));
        let number = |name: Name<'a>| std::str::from_utf8(name.bytes()).ok()?.parse::<f64>().ok();
        let computed = flags::PropertySet::only(flags::Property::IsComputed);
        Ok(match key.kind() {
            KeyKind::Ident(name) => (self.string(name.bytes(), span)?, flags::PROPERTY_NONE),
            KeyKind::String(name) => match self.lone_surrogate_key(name, key) {
                Some(missing) => (missing, flags::PROPERTY_NONE),
                None => (self.string(name.bytes(), span)?, flags::PROPERTY_NONE),
            },
            KeyKind::Number(name) => match number(name) {
                Some(value) => (
                    JsExpr::init(E::Number::new(value), self.loc(span)),
                    flags::PROPERTY_NONE,
                ),
                None => (self.string(name.bytes(), span)?, flags::PROPERTY_NONE),
            },
            KeyKind::Private(name) => {
                let ref_ = self.ref_of_name(Named::Private, name);
                (
                    JsExpr::init(E::PrivateIdentifier { ref_ }, self.loc(span)),
                    flags::PROPERTY_NONE,
                )
            }
            KeyKind::ComputedString(name) => {
                if let Some(missing) = self.lone_surrogate_key(name, key) {
                    return Ok((missing, flags::PROPERTY_NONE));
                }
                let span = key.inner_span(self.file);
                let flags = match self.flavor {
                    // oxc's lowering treats it as a non-computed key. Upstream's can't destructure by it.
                    Flavor::Oxlint => flags::PROPERTY_NONE,
                    Flavor::Eslint => computed,
                };
                (self.string(name.bytes(), span)?, flags)
            }
            KeyKind::ComputedNumber(name) => {
                let span = key.inner_span(self.file);
                match number(name) {
                    Some(value) => (
                        JsExpr::init(E::Number::new(value), self.loc(span)),
                        computed,
                    ),
                    None => (self.string(name.bytes(), span)?, computed),
                }
            }
            KeyKind::Computed(expr) => (self.expr(expr)?, computed),
        })
    }

    /// `is_target`: the object is the target of an assignment.
    fn property(&mut self, prop: Prop<'a>, is_target: bool) -> Converts<G::Property> {
        let kind = prop.kind();
        if kind == PropKind::Spread {
            return Ok(G::Property {
                kind: G::PropertyKind::Spread,
                value: self.property_value(prop, is_target)?,
                ..G::Property::default()
            });
        }
        // Upstream uses the whole method's span where the lowering has the key's and the function's.
        let is_function = matches!(kind, PropKind::Method | PropKind::Getter | PropKind::Setter);
        let was_unread = self.is_unread;
        self.is_unread |= matches!(kind, PropKind::Getter | PropKind::Setter);
        let (key, mut flags) = match prop.key() {
            Some(key) => {
                let (key, flags) = self.key(key, is_function.then(|| prop.span()))?;
                (Some(key), flags)
            }
            None => (None, flags::PROPERTY_NONE),
        };
        let value = match (is_function, prop.func()) {
            (true, Some(func)) => Some(self.function_expr(func, prop.span())?),
            _ => self.property_value(prop, is_target)?,
        };
        self.is_unread = was_unread;
        match kind {
            PropKind::Method => flags |= flags::Property::IsMethod,
            PropKind::Shorthand => flags |= flags::Property::WasShorthand,
            _ => {}
        }
        Ok(G::Property {
            kind: match kind {
                PropKind::Getter => G::PropertyKind::Get,
                PropKind::Setter => G::PropertyKind::Set,
                _ => G::PropertyKind::Normal,
            },
            flags,
            key,
            value,
            ..G::Property::default()
        })
    }

    fn property_value(&mut self, prop: Prop<'a>, is_target: bool) -> Converts<Option<JsExpr>> {
        let Some(value) = prop.value() else {
            return Ok(None);
        };
        self.is_target = is_target;
        Ok(Some(self.expr(value)?))
    }

    fn properties(
        &mut self,
        props: List<'a, Prop<'a>>,
        is_target: bool,
    ) -> Converts<G::PropertyList> {
        let mut properties: G::PropertyList = AstAlloc::vec_with_capacity(props.len());
        for prop in props {
            properties.push(self.property(prop, is_target)?);
        }
        Ok(properties)
    }

    // ───────────────────────────── classes ─────────────────────────────

    /// The compiler rejects a class, but still looks inside for what it references.
    fn class(&mut self, class: Class<'a>) -> Converts<G::Class> {
        self.nested(|this| {
            let class_name = class.name().map(|name| LocRef {
                loc: this.loc(name.span()),
                ref_: this.declared(class.symbol(), name.name()),
            });
            let was_unread = std::mem::replace(&mut this.is_unread, true);
            let extends = class.extends().map(|it| this.expr(it)).transpose()?;
            let mut properties: AstVec<G::Property> =
                AstAlloc::vec_with_capacity(class.members().len());
            for member in class.members() {
                if let Some(property) = this.member(member)? {
                    properties.push(property);
                }
            }
            this.is_unread = was_unread;
            Ok(G::Class {
                class_name,
                extends,
                properties: leak(properties),
                ..G::Class::default()
            })
        })
    }

    /// `None` if the member only exists for types.
    fn member(&mut self, member: Member<'a>) -> Converts<Option<G::Property>> {
        if member.is_signature() {
            return Ok(None);
        }
        if member.kind() == MemberKind::StaticBlock {
            let Some(FnBody::Block(statements)) = member.func().map(Func::body) else {
                return Ok(None);
            };
            let loc = self.loc(member.span());
            let mut stmts: AstVec<JsStmt> = AstAlloc::vec_with_capacity(statements.len());
            for statement in statements {
                stmts.push(self.stmt(statement)?);
            }
            let block = self.arena.alloc(G::ClassStaticBlock { stmts, loc });
            return Ok(Some(G::Property {
                kind: G::PropertyKind::ClassStaticBlock,
                class_static_block: Some(bun_ast::StoreRef::from_bump(block)),
                ..G::Property::default()
            }));
        }
        let (key, mut flags) = match member.key() {
            Some(key) => {
                let (key, flags) = self.key(key, None)?;
                (Some(key), flags)
            }
            None => (
                Some(self.string(b"constructor", member.span())?),
                flags::PROPERTY_NONE,
            ),
        };
        if member.is_static() {
            flags |= flags::Property::IsStatic;
        }
        let mut property = G::Property {
            key,
            ..G::Property::default()
        };
        match member.func().filter(|func| func.has_body()) {
            Some(func) => {
                flags |= flags::Property::IsMethod;
                property.kind = match func.kind() {
                    FnKind::Getter => G::PropertyKind::Get,
                    FnKind::Setter => G::PropertyKind::Set,
                    _ => G::PropertyKind::Normal,
                };
                property.value = Some(self.function_expr(func, func.estree_span())?);
            }
            None => property.initializer = member.init().map(|it| self.expr(it)).transpose()?,
        }
        property.flags = flags;
        Ok(Some(property))
    }

    // ───────────────────────────── expressions ─────────────────────────────

    fn exprs(&mut self, list: List<'a, Expr<'a>>) -> Converts<bun_ast::ExprNodeList> {
        self.exprs_in(list, false)
    }

    /// `is_target`: the array is the target of an assignment.
    fn exprs_in(
        &mut self,
        list: List<'a, Expr<'a>>,
        is_target: bool,
    ) -> Converts<bun_ast::ExprNodeList> {
        let mut converted: bun_ast::ExprNodeList = AstAlloc::vec_with_capacity(list.len());
        for expr in list {
            self.is_target = is_target;
            converted.push(self.expr(expr)?);
        }
        Ok(converted)
    }

    fn chain(chain: Chain) -> Option<OptionalChain> {
        match chain {
            Chain::No => None,
            Chain::Start => Some(OptionalChain::Start),
            Chain::Continue => Some(OptionalChain::Continuation),
        }
    }

    /// The function that oxc's compiler inlines where `call` is: one that's called at once, or the callback of a
    /// `useMemo`. It has no parameters and is neither async nor a generator.
    fn inlined_at(&mut self, call: Call<'a>) -> Option<Span> {
        if self.flavor != Flavor::Oxlint || self.body != Body::Compiled || call.chain() != Chain::No
        {
            return None;
        }
        let args = call.args();
        let func = match args.first() {
            None => as_function(call.callee())?,
            Some(callback) => {
                let func = as_function(callback)?;
                let has_dependency_list = args.get(1).is_none_or(is_dependency_list);
                if !has_dependency_list || !self.is_use_memo(call.callee()) {
                    return None;
                }
                // The call is then in a later block than the callback, and the compiler comes to it first.
                if self.is_after_inlined_call && args.iter().skip(1).any(ends_block) {
                    return None;
                }
                func
            }
        };
        let is_inlined = func.params().is_empty() && !func.is_async() && !func.is_generator();
        is_inlined.then(|| func.estree_span())
    }

    /// True if the compiler takes `callee` for React's `useMemo`: a global or an import from React of that name, or
    /// that property of anything named `React` that isn't a local.
    fn is_use_memo(&mut self, callee: Expr<'a>) -> bool {
        match callee.kind() {
            ExprKind::Ident(name) => match callee.symbol() {
                Some(symbol) => {
                    let r#ref = self.ref_of_symbol(symbol);
                    (self.global_name(r#ref)).is_some_and(|it| it == b"useMemo")
                }
                None => name.is("useMemo"),
            },
            ExprKind::Dot {
                obj,
                name,
                chain: Chain::No,
            } => {
                name.name().is("useMemo")
                    && obj.is_ident("React")
                    && obj.symbol().is_none_or(|symbol| {
                        let r#ref = self.ref_of_symbol(symbol);
                        let is_outside = self.is_outside.get(r#ref.inner_index() as usize);
                        is_outside.copied().unwrap_or(true)
                    })
            }
            _ => false,
        }
    }

    /// The name that the compiler looks `ref` up by, if it's a global or an import from React.
    fn global_name(&self, r#ref: Ref) -> Option<&[u8]> {
        let symbol = self.symbols.get(r#ref.inner_index() as usize)?;
        match symbol.kind {
            SymbolKind::Unbound => Some(symbol.original_name.slice()),
            SymbolKind::Import => {
                let (_, binding) = self.import_bindings.iter().find(|it| it.0 == r#ref)?;
                match binding {
                    VariableBinding::ImportSpecifier {
                        module, imported, ..
                    } if is_react_module(module.slice()) => Some(imported.slice()),
                    VariableBinding::ImportDefault { name, module }
                    | VariableBinding::ImportNamespace { name, module }
                        if is_react_module(module.slice()) =>
                    {
                        Some(name.slice())
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }

    /// `new Date()` or `Date()`, also `new globalThis.Date()` and `new globalThis["Date"]()`. oxlint's compiler treats
    /// it as impure like `Date.now()`, which is the only one Bun's knows. It says the same of `globalThis.Date()`,
    /// which stays what Bun's compiler reports too: a call of a capitalized method.
    fn is_clock_read(&self, call: Call<'a>, is_new: bool) -> bool {
        if !call.args().is_empty() || call.chain() != Chain::No {
            return false;
        }
        let is_global = |it: Expr<'a>, name: &str| {
            it.is_ident(name) && (it.symbol()).is_none_or(|symbol| self.is_global_to_oxc(symbol))
        };
        let callee = call.callee();
        if !is_new {
            return is_global(callee, "Date");
        }
        let obj = match callee.kind() {
            ExprKind::Dot {
                obj,
                name,
                chain: Chain::No,
            } if name.name().is("Date") => obj,
            ExprKind::Index {
                obj,
                index,
                chain: Chain::No,
            } if matches!(index.kind(), ExprKind::String(text) if text.is("Date")) => obj,
            _ => return is_global(callee, "Date"),
        };
        is_global(obj, "globalThis") || is_global(obj, "global")
    }

    pub(crate) fn expr(&mut self, expr: Expr<'a>) -> Converts<JsExpr> {
        let converted = self.nested(|this| this.expr_at(expr, expr.span()))?;
        if self.flavor == Flavor::Oxlint && expr.is_parenthesized() {
            let whole = self.loc(expr.outer_span());
            self.parentheses.push((converted.loc, whole));
        }
        Ok(converted)
    }

    fn expr_at(&mut self, expr: Expr<'a>, span: Span) -> Converts<JsExpr> {
        let is_target = std::mem::take(&mut self.is_target);
        // Type-only syntax has no node in this tree.
        if let ExprKind::NonNull(inner) | ExprKind::Instantiation { expr: inner, .. } = expr.kind()
        {
            self.is_target = is_target;
            return self.expr(inner);
        }
        if let ExprKind::As { expr: inner, .. }
        | ExprKind::Satisfies { expr: inner, .. }
        | ExprKind::AsConst(inner) = expr.kind()
        {
            let cast = self.loc(span);
            self.is_target = is_target;
            let operand = self.expr(inner)?;
            self.casts.push((operand.loc, cast));
            return Ok(operand);
        }
        if let ExprKind::Fn(func) = expr.kind() {
            return self.function_expr(func, span);
        }
        let loc = self.loc(span);
        Ok(match expr.kind() {
            ExprKind::Missing => JsExpr::init(E::Missing {}, loc),
            ExprKind::Ident(name) => {
                JsExpr::init_identifier(self.ref_of_identifier(expr, name), loc)
            }
            ExprKind::PrivateIdentifier(name) => {
                let ref_ = self.ref_of_name(Named::Private, name);
                JsExpr::init(E::PrivateIdentifier { ref_ }, loc)
            }
            ExprKind::This => JsExpr::init(E::This {}, loc),
            ExprKind::Super => JsExpr::init(E::Super {}, loc),
            ExprKind::Null => JsExpr::init(E::Null {}, loc),
            ExprKind::True => JsExpr::init(E::Boolean { value: true }, loc),
            ExprKind::False => JsExpr::init(E::Boolean { value: false }, loc),
            ExprKind::Number(value) => JsExpr::init(E::Number::new(value), loc),
            ExprKind::String(value) => JsExpr::init(E::EString::init(value.bytes()), loc),
            // oxc's lowering supports them. The compiler treats all primitives alike, so a number will do.
            ExprKind::BigInt(_) if self.flavor == Flavor::Oxlint => {
                JsExpr::init(E::Number::new(0.0), loc)
            }
            ExprKind::BigInt(value) => JsExpr::init(
                E::BigInt {
                    value: StoreStr::new(value.bytes()),
                },
                loc,
            ),
            ExprKind::Regex(regex) => {
                let text = expr.text();
                let flags_offset = text.len().checked_sub(regex.flags().len());
                JsExpr::init(
                    E::RegExp {
                        value: StoreStr::new(text),
                        flags_offset: flags_offset
                            .filter(|_| !regex.flags().is_empty())
                            .and_then(|it| u16::try_from(it).ok()),
                    },
                    loc,
                )
            }
            ExprKind::Template(template) => JsExpr::init(self.template(template, None)?, loc),
            ExprKind::TaggedTemplate(call) => {
                let tag = self.expr(call.callee())?;
                match call.template().map(Expr::kind) {
                    // oxc's lowering treats the tag and the substitutions as operands, like a call's.
                    Some(ExprKind::Template(template))
                        if self.flavor == Flavor::Oxlint && !template.exprs().is_empty() =>
                    {
                        self.tagged_templates.push(loc);
                        JsExpr::init(
                            E::Call {
                                target: tag,
                                kind: E::CallKind::of(&tag),
                                args: self.exprs(template.exprs())?,
                                ..E::Call::default()
                            },
                            loc,
                        )
                    }
                    Some(ExprKind::Template(template)) => {
                        JsExpr::init(self.template(template, Some(tag))?, loc)
                    }
                    _ => JsExpr::init(E::Missing {}, loc),
                }
            }
            ExprKind::Array(items) => JsExpr::init(
                E::Array {
                    items: self.exprs_in(items, is_target)?,
                    ..E::Array::default()
                },
                loc,
            ),
            ExprKind::Object(props) => JsExpr::init(
                E::Object {
                    properties: self.properties(props, is_target)?,
                    ..E::Object::default()
                },
                loc,
            ),
            ExprKind::Class(class) => JsExpr::init(self.class(class)?, loc),
            ExprKind::Dot { obj, name, chain } => self.dot(obj, name, chain, loc)?,
            ExprKind::Index { obj, index, chain } => {
                let is_chained = chain != Chain::No;
                let target = self.in_operand(is_chained, |this| this.expr(obj))?;
                let index = self.in_operand(is_chained, |this| this.expr(index))?;
                if is_chained {
                    self.block_ends();
                }
                JsExpr::init(
                    E::Index {
                        target,
                        index,
                        optional_chain: Self::chain(chain),
                        is_import_property_use: false,
                    },
                    loc,
                )
            }
            ExprKind::Call(call) | ExprKind::New(call)
                if self.flavor == Flavor::Oxlint
                    && self.body != Body::Nested
                    && self.is_clock_read(call, expr.tag() == ExprTag::New) =>
            {
                self.clock_reads.push(span);
                let callee = call.callee();
                let target = match callee.kind() {
                    // `globalThis["Date"]`
                    ExprKind::Index { obj, index, .. } => {
                        let loc = self.loc(callee.span());
                        let date = E::Dot {
                            target: self.expr(obj)?,
                            name: StoreStr::new(b"Date"),
                            name_loc: self.loc(index.span()),
                            ..E::Dot::default()
                        };
                        JsExpr::init(date, loc)
                    }
                    _ => self.expr(callee)?,
                };
                let now = E::Dot {
                    target,
                    name: StoreStr::new(b"now"),
                    name_loc: target.loc,
                    ..E::Dot::default()
                };
                JsExpr::init(
                    E::Call {
                        target: JsExpr::init(now, target.loc),
                        ..E::Call::default()
                    },
                    loc,
                )
            }
            ExprKind::Call(call) => {
                let is_chained = call.chain() != Chain::No;
                let inlined = self.inlined_at(call);
                self.inlined = inlined;
                let target = self.in_operand(is_chained, |this| this.expr(call.callee()))?;
                let args = self.in_operand(is_chained, |this| this.exprs(call.args()))?;
                if is_chained {
                    self.block_ends();
                } else if inlined.is_some() && self.try_depth == 0 {
                    self.is_after_inlined_call = true;
                }
                JsExpr::init(
                    E::Call {
                        target,
                        kind: E::CallKind::of(&target),
                        args,
                        optional_chain: Self::chain(call.chain()),
                        ..E::Call::default()
                    },
                    loc,
                )
            }
            ExprKind::New(call) => JsExpr::init(
                E::New {
                    target: self.expr(call.callee())?,
                    args: self.exprs(call.args())?,
                    ..E::New::default()
                },
                loc,
            ),
            ExprKind::Unary { op, operand } => {
                let value = self.expr(operand)?;
                let flags = match (op, operand.skip_type_wrappers().kind()) {
                    (
                        UnOp::Delete,
                        ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. },
                    ) => E::UnaryFlags::WAS_ORIGINALLY_DELETE_OF_IDENTIFIER_OR_PROPERTY_ACCESS,
                    (UnOp::Typeof, ExprKind::Ident(_)) => {
                        E::UnaryFlags::WAS_ORIGINALLY_TYPEOF_IDENTIFIER
                    }
                    _ => E::UnaryFlags::empty(),
                };
                JsExpr::init(
                    E::Unary {
                        op: unary_op(op),
                        value,
                        flags,
                    },
                    loc,
                )
            }
            ExprKind::Binary { op, left, right } => {
                let is_operand =
                    matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma);
                let left = self.in_operand(is_operand, |this| this.expr(left))?;
                let right = self.in_operand(is_operand, |this| this.expr(right))?;
                if is_operand {
                    self.block_ends();
                }
                let op = binary_op(op);
                JsExpr::init(E::Binary { left, right, op }, loc)
            }
            ExprKind::Assign { op, target, value } => {
                let recorded = self.recorded.len();
                let is_logical = matches!(op, Some(BinOp::And | BinOp::Or | BinOp::Nullish));
                // The lowering gives a default a block of its own, as it does in a declaration.
                let is_default = is_target && op.is_none();
                let from = self.keys();
                self.is_target = op.is_none();
                let left = self.in_operand(is_logical, |this| this.expr(target))?;
                let after_target = self.keys();
                let right = self.in_operand(is_logical || is_default, |this| this.expr(value))?;
                if is_logical || is_default {
                    self.block_ends();
                }
                // The lowering comes to the value of `=` before the target.
                if op.is_none() {
                    self.later_keys_first(from, after_target);
                }
                // Upstream's lowering doesn't support these, and doesn't look inside them. oxc's lowers both sides.
                if is_logical && self.flavor != Flavor::Oxlint {
                    self.recorded.truncate(recorded);
                }
                let op = assign_op(op);
                JsExpr::init(E::Binary { left, right, op }, loc)
            }
            ExprKind::Cond { test, yes, no } => {
                let test = self.operand(test)?;
                let yes = self.operand(yes)?;
                let no = self.operand(no)?;
                self.block_ends();
                JsExpr::init(E::If { test, yes, no }, loc)
            }
            ExprKind::Spread(value) => {
                self.is_target = is_target;
                let value = self.expr(value)?;
                JsExpr::init(E::Spread { value }, loc)
            }
            ExprKind::Await(value) => JsExpr::init(
                E::Await {
                    value: self.expr(value)?,
                },
                loc,
            ),
            ExprKind::Yield { value, star } => JsExpr::init(
                E::Yield {
                    value: match value {
                        Some(value) => Some(self.unread(|this| this.expr(value))?),
                        None => None,
                    },
                    is_star: star,
                },
                loc,
            ),
            ExprKind::Jsx(jsx) => self.jsx(jsx, expr, loc)?,
            ExprKind::ImportCall { args } => {
                let keyword = Span::new(span.start, span.start + "import".len() as u32);
                self.recorded.push(Recorded::DynamicImport(keyword));
                let missing = JsExpr::init(E::Missing {}, loc);
                JsExpr::init(
                    E::Import {
                        expr: args.get(0).map_or(Ok(missing), |it| self.expr(it))?,
                        options: args.get(1).map_or(Ok(missing), |it| self.expr(it))?,
                        import_record_index: u32::MAX,
                        namespace_ref: Ref::NONE,
                    },
                    loc,
                )
            }
            ExprKind::ImportMeta => JsExpr::init(E::ImportMeta {}, loc),
            ExprKind::NewTarget => JsExpr::init(E::NewTarget { range: Range::NONE }, loc),
            // Handled above.
            ExprKind::Fn(_)
            | ExprKind::As { .. }
            | ExprKind::Satisfies { .. }
            | ExprKind::AsConst(_)
            | ExprKind::NonNull(_)
            | ExprKind::Instantiation { .. } => JsExpr::init(E::Missing {}, loc),
        })
    }

    fn dot(&mut self, obj: Expr<'a>, name: Ident<'a>, chain: Chain, loc: Loc) -> Converts<JsExpr> {
        let target = self.in_operand(chain != Chain::No, |this| this.expr(obj))?;
        if chain != Chain::No {
            self.block_ends();
        }
        let name_loc = self.loc(name.span());
        let optional_chain = Self::chain(chain);
        if name.bytes().starts_with(b"#") {
            let ref_ = self.ref_of_name(Named::Private, name.name());
            return Ok(JsExpr::init(
                E::Index {
                    target,
                    index: JsExpr::init(E::PrivateIdentifier { ref_ }, name_loc),
                    optional_chain,
                    is_import_property_use: false,
                },
                loc,
            ));
        }
        Ok(JsExpr::init(
            E::Dot {
                target,
                name: StoreStr::new(name.bytes()),
                name_loc,
                optional_chain,
                ..E::Dot::default()
            },
            loc,
        ))
    }

    /// A tagged template keeps its raw text, unless the text has an escape. Bun's lowering rejects
    /// a template when it sees the `\`, and oxc's doesn't, so for oxlint the text is dropped. It
    /// plays no part in the analysis.
    fn template(&mut self, template: Template<'a>, tag: Option<JsExpr>) -> Converts<E::Template> {
        let is_oxlint = self.flavor == Flavor::Oxlint;
        let contents = |i: usize| match (tag.is_some(), template.cooked(i)) {
            (false, Some(cooked)) => E::TemplateContents::Cooked(E::EString::init(cooked.bytes())),
            (true, _) if is_oxlint && bun_core::strings::contains_char(template.raw(i), b'\\') => {
                E::TemplateContents::Raw(StoreStr::new(b""))
            }
            _ => E::TemplateContents::Raw(StoreStr::new(template.raw(i))),
        };
        let mut parts: AstVec<E::TemplatePart> =
            AstAlloc::vec_with_capacity(template.exprs().len());
        for (i, value) in template.exprs().iter().enumerate() {
            parts.push(E::TemplatePart {
                value: self.expr(value)?,
                tail_loc: self.loc(template.quasi_span(i + 1)),
                tail: contents(i + 1),
            });
        }
        Ok(E::Template {
            tag: tag.map(E::TemplateTag::new),
            parts: leak(parts),
            head: contents(0),
        })
    }

    // ───────────────────────────── JSX ─────────────────────────────

    fn jsx_tag(&mut self, tag: Expr<'a>) -> Converts<JsExpr> {
        match tag.kind() {
            // A name that starts with a lowercase letter is a host element.
            ExprKind::Ident(name) if !name.bytes().first().is_some_and(u8::is_ascii_uppercase) => {
                self.string(name.bytes(), tag.span())
            }
            _ => self.expr(tag),
        }
    }

    fn jsx(&mut self, jsx: Jsx<'a>, whole: Expr<'a>, loc: Loc) -> Converts<JsExpr> {
        let name = jsx.tag().map(|tag| self.file.slice(tag.span()));
        let tag = ["fbt", "fbs"]
            .into_iter()
            .find(|it| Some(it.as_bytes()) == name);
        if let Some(tag) = tag {
            let mut found = FbtTags {
                file: self.file,
                tag,
                also_attributes: self.flavor == Flavor::Eslint,
                tag_spans: Default::default(),
            };
            walk_node(Node::Expr(whole), &mut found);
            let duplicate = (FBT_TAGS.into_iter().zip(found.tag_spans)).find(|it| it.1.len() > 1);
            if let Some((name, tag_spans)) = duplicate {
                self.recorded.push(Recorded::DuplicateFbtTags {
                    tag,
                    name,
                    tag_spans,
                });
            }
        }
        let children = jsx.children();
        let mut args: bun_ast::ExprNodeList = AstAlloc::vec_with_capacity(children.len() + 2);
        args.push(match jsx.tag() {
            Some(tag) => self.jsx_tag(tag)?,
            None => JsExpr::init_identifier(self.fragment, self.loc(jsx.opening_span())),
        });
        let attrs = jsx.attrs();
        let props_loc = self.loc(jsx.opening_span());
        args.push(match attrs.is_empty() {
            true => JsExpr::init(E::Null {}, props_loc),
            false => {
                let mut properties: G::PropertyList = AstAlloc::vec_with_capacity(attrs.len());
                for attr in attrs {
                    let mut property = self.property(attr, false)?;
                    if property.kind != G::PropertyKind::Spread && property.value.is_none() {
                        let loc = self.loc(attr.span());
                        property.value = Some(JsExpr::init(E::Boolean { value: true }, loc));
                    }
                    properties.push(property);
                }
                JsExpr::init(
                    E::Object {
                        properties,
                        ..E::Object::default()
                    },
                    props_loc,
                )
            }
        });
        for child in children {
            if !child.is_missing() {
                args.push(self.expr(child)?);
            }
        }
        let close_paren_loc = match jsx.closing_span() {
            Some(span) => self.loc(span),
            None => Loc::EMPTY,
        };
        Ok(JsExpr::init(
            E::Call {
                target: JsExpr::init_identifier(self.create_element, Loc::EMPTY),
                args,
                close_paren_loc,
                was_jsx_element: true,
                ..E::Call::default()
            },
            loc,
        ))
    }

    // ───────────────────────────── statements ─────────────────────────────

    fn stmts(&mut self, list: List<'a, Stmt<'a>>) -> Converts<StoreSlice<JsStmt>> {
        self.stmts_after(AstAlloc::vec(), list)
    }

    fn stmts_after(
        &mut self,
        first: AstVec<JsStmt>,
        list: List<'a, Stmt<'a>>,
    ) -> Converts<StoreSlice<JsStmt>> {
        let mut converted = first;
        converted.reserve(list.len());
        for stmt in list {
            converted.push(self.stmt(stmt)?);
        }
        Ok(leak(converted))
    }

    /// The statements of `stmt`, which is a block.
    fn block(&mut self, stmt: Stmt<'a>) -> Converts<StoreSlice<JsStmt>> {
        match stmt.as_block() {
            Some(statements) => self.stmts(statements),
            None => Ok(StoreSlice::EMPTY),
        }
    }

    /// Converts what the lowering gives a block of its own and follows with another: a branch, or the body of a loop.
    fn branch(&mut self, stmt: Stmt<'a>) -> Converts<JsStmt> {
        self.block_ends();
        let converted = self.stmt(stmt);
        self.block_ends();
        converted
    }

    /// Converts the `x` of `for (x of y)`. The lowering assigns to it in a block of the loop, after it has lowered `y`.
    fn loop_target(&mut self, left: Stmt<'a>) -> Converts<JsStmt> {
        let is_after_inlined_call = self.is_after_inlined_call;
        let converted = self.in_operand(true, |this| this.stmt(left));
        self.is_after_inlined_call = is_after_inlined_call;
        converted
    }

    /// Converts the target, the iterated value and the body of a `for-in` or `for-of`. The lowering comes to the body
    /// first and to the target last.
    fn loop_parts(
        &mut self,
        left: Stmt<'a>,
        expr: Expr<'a>,
        body: Stmt<'a>,
    ) -> Converts<(JsStmt, JsExpr, JsStmt)> {
        let from = self.keys();
        let target = self.loop_target(left)?;
        let after_target = self.keys();
        let value = self.expr(expr)?;
        let after_value = self.keys();
        let body = self.branch(body)?;
        self.later_keys_first(after_target, after_value);
        self.later_keys_first(from, after_target);
        Ok((target, value, body))
    }

    /// Makes Bun's compiler say of `pat`, the parameter of the `catch` of `stmt`, what oxc's says. Returns what to bind
    /// in place of `binding`, and adds to `first` what to put at the start of `handler`.
    fn catch_parameter(
        &mut self,
        mut binding: Binding,
        pat: Pat<'a>,
        stmt: Stmt<'a>,
        handler: Stmt<'a>,
        first: &mut AstVec<JsStmt>,
    ) -> Binding {
        let (Some(symbol), PatKind::Ident(name)) = (pat.symbol(), pat.kind()) else {
            return binding;
        };
        let captures = captures_of(symbol, stmt, redeclared_from(handler, name));
        match captures.first {
            // Both compilers fail on a parameter that a nested function refers to. If something assigns to it, oxc's
            // reports the parameter, and so does Bun's if the block starts by reading it. If not, oxc's reports the
            // first such reference, and upstream's the parameter.
            Some(_) if is_reassigned(symbol) => {
                let loc = self.loc(pat.span());
                let value = JsExpr::init_identifier(self.ref_of_symbol(symbol), loc);
                let read = S::SExpr {
                    value,
                    ..S::SExpr::default()
                };
                first.push(JsStmt::alloc(read, loc));
            }
            Some(captured) => binding.loc = self.loc(captured),
            // Bun's compiler would take those references for the parameter's.
            None if captures.has_others => {
                binding = self.destructure_in_body(binding, SymbolKind::CatchIdentifier, first);
            }
            None => {}
        }
        binding
    }

    fn label(&mut self, stmt: Stmt<'a>) -> Option<LocRef> {
        stmt.label().map(|label| LocRef {
            loc: self.loc(label.span()),
            ref_: self.ref_of_name(Named::Label, label.name()),
        })
    }

    fn local(&mut self, decls: List<'a, VarDecl<'a>>, loc: Loc) -> Converts<JsStmt> {
        let kind = match decls.first().map(VarDecl::var_kind) {
            Some(VarKind::Var) | None => S::Kind::KVar,
            Some(VarKind::Let) => S::Kind::KLet,
            Some(VarKind::Const) => S::Kind::KConst,
            Some(VarKind::Using | VarKind::AwaitUsing) => match self.flavor {
                // oxc 514fb9139: the rules see the function as if the resource were a `const`.
                Flavor::Oxlint => S::Kind::KConst,
                Flavor::Eslint => return Err(ConvertError::Using),
            },
        };
        let mut converted: G::DeclList = AstAlloc::vec_with_capacity(decls.len());
        for decl in decls {
            let from = self.keys();
            let binding = self.binding(decl.pat())?;
            let after_binding = self.keys();
            let value = decl.init().map(|it| self.expr(it)).transpose()?;
            // The lowering comes to the value first.
            self.later_keys_first(from, after_binding);
            converted.push(G::Decl { binding, value });
        }
        Ok(JsStmt::alloc(
            S::Local {
                kind,
                decls: converted,
                ..S::Local::default()
            },
            loc,
        ))
    }

    pub(crate) fn stmt(&mut self, stmt: Stmt<'a>) -> Converts<JsStmt> {
        self.nested(|this| this.stmt_here(stmt))
    }

    fn stmt_here(&mut self, stmt: Stmt<'a>) -> Converts<JsStmt> {
        let loc = self.loc(stmt.span());
        if let Some(value) = stmt.directive() {
            let value = StoreStr::new(value);
            return Ok(JsStmt::alloc(S::Directive { value }, loc));
        }
        Ok(match stmt.kind() {
            StmtKind::Empty => JsStmt::alloc(S::Empty {}, loc),
            StmtKind::Debugger => JsStmt::alloc(S::Debugger {}, loc),
            StmtKind::Expr(value) => JsStmt::alloc(
                S::SExpr {
                    value: self.expr(value)?,
                    ..S::SExpr::default()
                },
                loc,
            ),
            // oxc's lowering drops what's declared with `declare`.
            StmtKind::Var(_)
                if self.flavor == Flavor::Oxlint
                    && !self.file.is_javascript()
                    && stmt.flags().contains(Flags::AMBIENT) =>
            {
                JsStmt::alloc(S::TypeScript::default(), loc)
            }
            StmtKind::Var(decls) => self.local(decls, loc)?,
            StmtKind::Fn(func) if func.has_body() => JsStmt::alloc(
                S::Function {
                    func: self.function(func)?,
                },
                loc,
            ),
            // Type-only declarations.
            StmtKind::Fn(_) | StmtKind::Interface(_) | StmtKind::TypeAlias(_) => {
                JsStmt::alloc(S::TypeScript::default(), loc)
            }
            StmtKind::Class(class) => JsStmt::alloc(
                S::Class {
                    class: self.class(class)?,
                    is_export: false,
                },
                loc,
            ),
            // The compiler doesn't look at enums or namespaces.
            StmtKind::Enum(it) => JsStmt::alloc(
                S::Enum {
                    name: LocRef {
                        loc: self.loc(it.name().span()),
                        ref_: Ref::NONE,
                    },
                    arg: Ref::NONE,
                    values: StoreSlice::EMPTY,
                    is_export: false,
                },
                loc,
            ),
            StmtKind::Module(it) => JsStmt::alloc(
                S::Namespace {
                    name: LocRef {
                        loc: self.loc(it.name_span()),
                        ref_: Ref::NONE,
                    },
                    arg: Ref::NONE,
                    stmts: StoreSlice::EMPTY,
                    is_export: false,
                },
                loc,
            ),
            StmtKind::Return(value) => JsStmt::alloc(
                S::Return {
                    value: value.map(|it| self.expr(it)).transpose()?,
                },
                loc,
            ),
            StmtKind::If { test, yes, no } => {
                let from = self.keys();
                let test = self.expr(test)?;
                let after_test = self.keys();
                let yes = self.branch(yes)?;
                let no = no.map(|it| self.branch(it)).transpose()?;
                // The lowering comes to the test last.
                self.later_keys_first(from, after_test);
                JsStmt::alloc(
                    S::If {
                        test,
                        yes,
                        no,
                        else_loc: Loc::EMPTY,
                    },
                    loc,
                )
            }
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => {
                let init = match init {
                    Some(init) => Some(self.in_operand(true, |this| this.stmt(init))?),
                    None => None,
                };
                let from = self.keys();
                let test = match (test, self.flavor) {
                    (Some(it), _) => Some(self.operand(it)?),
                    // Both lowerings continue as for `while (true)`. Upstream's also records a Todo.
                    (None, Flavor::Oxlint) => Some(JsExpr::init(E::Boolean { value: true }, loc)),
                    (None, Flavor::Eslint) => None,
                };
                let after_test = self.keys();
                let update = update.map(|it| self.operand(it)).transpose()?;
                let body = self.branch(body)?;
                // The lowering comes to the test last.
                self.later_keys_first(from, after_test);
                JsStmt::alloc(
                    S::For {
                        init,
                        test,
                        update,
                        body,
                    },
                    loc,
                )
            }
            StmtKind::ForIn { left, expr, body } => {
                let (init, value, body) = self.loop_parts(left, expr, body)?;
                JsStmt::alloc(S::ForIn { init, value, body }, loc)
            }
            StmtKind::ForOf {
                left,
                expr,
                body,
                is_await,
            } => {
                let (init, value, body) = self.loop_parts(left, expr, body)?;
                JsStmt::alloc(
                    S::ForOf {
                        is_await,
                        init,
                        value,
                        body,
                    },
                    loc,
                )
            }
            StmtKind::While { test, body } => {
                let from = self.keys();
                let test = self.operand(test)?;
                let after_test = self.keys();
                let body = self.branch(body)?;
                // The lowering comes to the body first.
                self.later_keys_first(from, after_test);
                JsStmt::alloc(S::While { test, body }, loc)
            }
            StmtKind::DoWhile { body, test } => JsStmt::alloc(
                S::DoWhile {
                    body: self.branch(body)?,
                    test: self.operand(test)?,
                },
                loc,
            ),
            StmtKind::Block(statements) => JsStmt::alloc(
                S::Block {
                    stmts: self.stmts(statements)?,
                    ..S::Block::default()
                },
                loc,
            ),
            StmtKind::With { object, body } => JsStmt::alloc(
                S::With {
                    value: self.expr(object)?,
                    body: self.stmt(body)?,
                    body_loc: loc,
                },
                loc,
            ),
            StmtKind::Switch { expr, cases } => {
                let from = self.keys();
                let test = self.expr(expr)?;
                let mut converted: AstVec<Case> = AstAlloc::vec_with_capacity(cases.len());
                for case in cases {
                    let loc = self.loc(case.span());
                    let case_from = self.keys();
                    let value = case.test().map(|it| self.expr(it)).transpose()?;
                    let after_test = self.keys();
                    self.block_ends();
                    let body = self.stmts(case.body())?;
                    self.block_ends();
                    // The lowering starts with the last case, and comes to the body of each before its test.
                    self.later_keys_first(case_from, after_test);
                    self.later_keys_first(from, case_from);
                    converted.push(Case { loc, value, body });
                }
                JsStmt::alloc(
                    S::Switch {
                        test,
                        body_loc: loc,
                        cases: leak(converted),
                    },
                    loc,
                )
            }
            StmtKind::Try {
                block,
                param,
                handler,
                finalizer,
            } => {
                let body_loc = self.loc(block.span());
                self.block_ends();
                let in_try = u32::from(handler.is_some());
                let from = self.keys();
                self.try_depth += in_try;
                let body = self.block(block);
                self.try_depth -= in_try;
                let body = body?;
                let after_block = self.keys();
                let catch = match handler {
                    Some(handler) => {
                        let loc =
                            self.loc(stmt.catch_clause_span().unwrap_or_else(|| handler.span()));
                        let mut binding = match param {
                            Some(param) => Some(self.unread(|this| this.binding(param.pat()))?),
                            None => None,
                        };
                        let mut first: AstVec<JsStmt> = AstAlloc::vec();
                        if self.flavor == Flavor::Oxlint
                            && let Some(param) = param
                        {
                            binding = binding.map(|it| {
                                self.catch_parameter(it, param.pat(), stmt, handler, &mut first)
                            });
                        }
                        self.block_ends();
                        Some(Catch {
                            loc,
                            binding,
                            body_loc: self.loc(handler.span()),
                            body: match handler.as_block() {
                                Some(statements) => self.stmts_after(first, statements)?,
                                None => leak(first),
                            },
                        })
                    }
                    None => None,
                };
                // The lowering comes to the `catch` block first.
                self.later_keys_first(from, after_block);
                self.block_ends();
                let finally = match finalizer {
                    Some(finalizer) => {
                        let loc = self.loc(finalizer.span());
                        Some(Finally {
                            loc,
                            stmts: self.block(finalizer)?,
                            body_loc: loc,
                        })
                    }
                    None => None,
                };
                self.block_ends();
                JsStmt::alloc(
                    S::Try {
                        body_loc,
                        body,
                        catch,
                        finally,
                    },
                    loc,
                )
            }
            StmtKind::Throw(value) => JsStmt::alloc(
                S::Throw {
                    value: self.expr(value)?,
                },
                loc,
            ),
            StmtKind::Break(_) => JsStmt::alloc(
                S::Break {
                    label: self.label(stmt),
                },
                loc,
            ),
            StmtKind::Continue(_) => JsStmt::alloc(
                S::Continue {
                    label: self.label(stmt),
                },
                loc,
            ),
            StmtKind::Labeled { label, body } => {
                let name = match self.label(stmt) {
                    Some(name) => name,
                    None => LocRef {
                        loc,
                        ref_: self.ref_of_name(Named::Label, label),
                    },
                };
                JsStmt::alloc(
                    S::Label {
                        name,
                        stmt: self.branch(body)?,
                    },
                    loc,
                )
            }
            // None of these can appear in a function. The compiler reports that for an `ExportClause`.
            StmtKind::Import(_)
            | StmtKind::ImportEquals(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportDefault(_)
            | StmtKind::ExportAssign(_)
            | StmtKind::ExportAsNamespace(_) => JsStmt::alloc(S::ExportClause::default(), loc),
        })
    }
}

/// True if the pattern binds a variable that's reassigned somewhere.
fn is_assigned(pat: Pat<'_>) -> bool {
    let mut is_assigned = false;
    pat.for_each_binding(&mut |name| {
        is_assigned |= (name.symbol().into_iter())
            .flat_map(Symbol::references)
            .any(|it| it.is_write() && !it.is_init());
    });
    is_assigned
}

/// The references to a `catch` parameter from the functions nested in the function of its `try` statement.
struct Captures {
    /// The first that oxc's compiler takes for a reference to the parameter.
    first: Option<Span>,
    /// True if there are some that it doesn't.
    has_others: bool,
}

/// `redeclared_from`: where in the `catch` block the name starts to refer to a `var` of the block.
fn captures_of<'a>(symbol: Symbol<'a>, stmt: Stmt<'a>, redeclared_from: u32) -> Captures {
    let enclosing_fn_span = Node::Stmt(stmt).enclosing_function().map(Func::span);
    let mut captures = Captures {
        first: None,
        has_others: false,
    };
    for reference in symbol.references() {
        let node = reference.node();
        if node.enclosing_function().map(Func::span) == enclosing_fn_span {
            continue;
        }
        let span = reference.span();
        // oxc's compiler doesn't look into a class.
        let is_in_class =
            (node.enclosing_class()).is_some_and(|class| stmt.span().contains(class.span()));
        if is_in_class || span.start >= redeclared_from {
            captures.has_others = true;
        } else {
            captures.first = Some(captures.first.map_or(span, |first| first.min(span)));
        }
    }
    captures
}

/// Where the first `var` with a value that's a statement of `block` and declares `name` starts, or `u32::MAX`. For
/// oxc's compiler, what comes after it in the block of a `catch` with a parameter of that name refers to the `var`.
fn redeclared_from<'a>(block: Stmt<'a>, name: Name<'a>) -> u32 {
    let declares_name = |decl: VarDecl<'a>| {
        let mut is_declared = false;
        decl.pat().for_each_binding(&mut |pat| {
            is_declared |= matches!(pat.kind(), PatKind::Ident(it) if it == name);
        });
        is_declared && decl.init().is_some() && matches!(decl.var_kind(), VarKind::Var)
    };
    for statement in block.as_block().into_iter().flatten() {
        if let StmtKind::Var(decls) = statement.kind()
            && decls.iter().any(&declares_name)
        {
            return statement.span().start;
        }
    }
    u32::MAX
}

/// True if an assignment or an update writes to the variable. oxc's compiler doesn't count a `for-in` or `for-of` that
/// does.
fn is_reassigned(symbol: Symbol<'_>) -> bool {
    (symbol.references()).any(|it| it.is_write() && !it.is_init() && !is_loop_target(it))
}

/// True if `reference` is the `x` of `for (x of y)`, or in it as an element of a pattern.
fn is_loop_target(reference: Reference<'_>) -> bool {
    let mut child = reference.span();
    for ancestor in reference.node().ancestors() {
        match ancestor {
            Node::Prop(prop) => child = prop.span(),
            Node::Expr(expr) => {
                let is_pattern = match expr.kind() {
                    ExprKind::Array(_) | ExprKind::Object(_) | ExprKind::Spread(_) => true,
                    ExprKind::Assign {
                        op: None, target, ..
                    } => target.span() == child,
                    _ => false,
                };
                if !is_pattern {
                    return false;
                }
                child = expr.span();
            }
            Node::Stmt(stmt) => {
                return matches!(stmt.kind(), StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. }
                    if left.span().contains(child));
            }
            _ => return false,
        }
    }
    false
}

/// oxc's `SymbolFlags::Ambient`: one of the declarations has the `declare` modifier.
fn is_ambient(symbol: Symbol<'_>) -> bool {
    symbol.declarations().any(|declaration| {
        let statement = match declaration {
            Declaration::Var(_) => declaration.parent(),
            Declaration::Fn(func) => Some(Node::Func(func).parent()),
            Declaration::Class(class) => Some(Node::Class(class).parent()),
            Declaration::Interface(it) => Some(Node::Stmt(it.stmt())),
            Declaration::TypeAlias(it) => Some(Node::Stmt(it.stmt())),
            Declaration::Enum(it) => Some(Node::Stmt(it.stmt())),
            Declaration::Module(it) => Some(Node::Stmt(it.stmt())),
            _ => None,
        };
        matches!(statement, Some(Node::Stmt(it)) if it.flags().contains(Flags::AMBIENT))
    })
}

/// `expr` as a function. `!` has no node in the converted tree.
fn as_function(mut expr: Expr<'_>) -> Option<Func<'_>> {
    while expr.tag() == ExprTag::NonNull
        && let ExprKind::NonNull(inner) = expr.kind()
    {
        expr = inner;
    }
    expr.as_fn()
}

/// True if the compiler takes `expr` for a list of dependencies: an array without holes or spread elements.
fn is_dependency_list(expr: Expr<'_>) -> bool {
    let is_element = |it: Expr<'_>| !it.is_missing() && it.tag() != ExprTag::Spread;
    matches!(expr.kind(), ExprKind::Array(items) if items.iter().all(is_element))
}

/// Finds out whether the lowering ends the block that it's in when it lowers an expression.
struct EndsBlock {
    /// How many functions and classes the walk is in.
    depth: u32,
    is_found: bool,
}

impl<'a> Visitor<'a> for EndsBlock {
    fn enter(&mut self, node: Node<'a>) {
        match node {
            Node::Func(_) | Node::Class(_) => self.depth += 1,
            Node::Expr(expr) if self.depth == 0 => {
                self.is_found |= match expr.kind() {
                    ExprKind::Cond { .. } => true,
                    ExprKind::Binary { op, .. } => {
                        matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma)
                    }
                    ExprKind::Assign { op, .. } => {
                        matches!(op, Some(BinOp::And | BinOp::Or | BinOp::Nullish))
                    }
                    ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } => {
                        chain != Chain::No
                    }
                    ExprKind::Call(call) => call.chain() != Chain::No,
                    _ => false,
                };
            }
            _ => {}
        }
    }
    fn exit(&mut self, node: Node<'a>) {
        if matches!(node, Node::Func(_) | Node::Class(_)) {
            self.depth -= 1;
        }
    }
}

/// True if the lowering gives a part of `expr` a block of its own, so that what it lowers next is in a new block: it
/// has a `?.`, a conditional, or a logical or comma operator, outside of the functions in it.
fn ends_block(expr: Expr<'_>) -> bool {
    let mut found = EndsBlock {
        depth: 0,
        is_found: false,
    };
    walk_node(Node::Expr(expr), &mut found);
    found.is_found
}

fn is_react_module(module: &[u8]) -> bool {
    module.eq_ignore_ascii_case(b"react") || module.eq_ignore_ascii_case(b"react-dom")
}

fn unary_op(op: UnOp) -> OpCode {
    match op {
        UnOp::Plus => OpCode::UnPos,
        UnOp::Minus => OpCode::UnNeg,
        UnOp::BitNot => OpCode::UnCpl,
        UnOp::Not => OpCode::UnNot,
        UnOp::Typeof => OpCode::UnTypeof,
        UnOp::Void => OpCode::UnVoid,
        UnOp::Delete => OpCode::UnDelete,
        UnOp::PreInc => OpCode::UnPreInc,
        UnOp::PreDec => OpCode::UnPreDec,
        UnOp::PostInc => OpCode::UnPostInc,
        UnOp::PostDec => OpCode::UnPostDec,
    }
}

fn binary_op(op: BinOp) -> OpCode {
    match op {
        BinOp::Add => OpCode::BinAdd,
        BinOp::Sub => OpCode::BinSub,
        BinOp::Mul => OpCode::BinMul,
        BinOp::Div => OpCode::BinDiv,
        BinOp::Rem => OpCode::BinRem,
        BinOp::Pow => OpCode::BinPow,
        BinOp::Shl => OpCode::BinShl,
        BinOp::Shr => OpCode::BinShr,
        BinOp::UShr => OpCode::BinUShr,
        BinOp::BitAnd => OpCode::BinBitwiseAnd,
        BinOp::BitOr => OpCode::BinBitwiseOr,
        BinOp::BitXor => OpCode::BinBitwiseXor,
        BinOp::Lt => OpCode::BinLt,
        BinOp::Le => OpCode::BinLe,
        BinOp::Gt => OpCode::BinGt,
        BinOp::Ge => OpCode::BinGe,
        BinOp::EqEq => OpCode::BinLooseEq,
        BinOp::NotEq => OpCode::BinLooseNe,
        BinOp::EqEqEq => OpCode::BinStrictEq,
        BinOp::NotEqEq => OpCode::BinStrictNe,
        BinOp::In => OpCode::BinIn,
        BinOp::Instanceof => OpCode::BinInstanceof,
        BinOp::And => OpCode::BinLogicalAnd,
        BinOp::Or => OpCode::BinLogicalOr,
        BinOp::Nullish => OpCode::BinNullishCoalescing,
        BinOp::Comma => OpCode::BinComma,
    }
}

/// `op` is the operator in `a op= b`.
fn assign_op(op: Option<BinOp>) -> OpCode {
    match op {
        Some(BinOp::Add) => OpCode::BinAddAssign,
        Some(BinOp::Sub) => OpCode::BinSubAssign,
        Some(BinOp::Mul) => OpCode::BinMulAssign,
        Some(BinOp::Div) => OpCode::BinDivAssign,
        Some(BinOp::Rem) => OpCode::BinRemAssign,
        Some(BinOp::Pow) => OpCode::BinPowAssign,
        Some(BinOp::Shl) => OpCode::BinShlAssign,
        Some(BinOp::Shr) => OpCode::BinShrAssign,
        Some(BinOp::UShr) => OpCode::BinUShrAssign,
        Some(BinOp::BitAnd) => OpCode::BinBitwiseAndAssign,
        Some(BinOp::BitOr) => OpCode::BinBitwiseOrAssign,
        Some(BinOp::BitXor) => OpCode::BinBitwiseXorAssign,
        Some(BinOp::And) => OpCode::BinLogicalAndAssign,
        Some(BinOp::Or) => OpCode::BinLogicalOrAssign,
        Some(BinOp::Nullish) => OpCode::BinNullishCoalescingAssign,
        // No other operator can come before a `=`.
        _ => OpCode::BinAssign,
    }
}
