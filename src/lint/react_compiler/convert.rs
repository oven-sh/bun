//! One function of the file as the tree that Bun's parser would hand to the React Compiler, so that
//! the compiler's own lowering (`src/react_compiler/lowering`) reads it.
//!
//! What differs from the tree of the parser:
//! - Nothing has been folded, dropped or lowered: it is the source, without its types.
//! - A `Loc` is not an offset. It is an index into [`Converted::spans`], which has the range of the
//!   node. The indices grow in source order, which is all that the lowering asks of a `Loc`. What
//!   the compiler reports has the `Loc` it was given: [`Converted::span_of`].
//! - A `Ref` is an index into [`Converted::symbols`], which has the symbols that the function
//!   mentions, and no others.
//! - JSX is a call as the classic runtime has it, `createElement(tag, props, ...children)`, which
//!   keeps the attributes in their order. The lowering makes a `JsxExpression` of it again.

use crate::compile::Flavor;
use bun_alloc::{Arena, AstAlloc, AstVec};
use bun_ast::base::RefTag;
use bun_ast::{
    ArrayBinding, B, Binding, Case, Catch, E, Expr as JsExpr, Finally, G, Loc, LocRef, OpCode,
    OptionalChain, Range, Ref, S, Stmt as JsStmt, StoreSlice, StoreStr, Symbol as JsSymbol,
    SymbolKind, flags,
};
use bun_lint::ast::{
    BinOp, Call, Chain, Class, Expr, ExprKind, File, FnBody, FnKind, Func, Ident, Jsx, Key,
    KeyKind, List, Member, MemberKind, Name, Node, Param, Pat, PatKind, Prop, PropKind, Stmt,
    StmtKind, Template, UnOp, VarDecl, VarKind,
};
use bun_lint::semantic::{Declaration, Symbol};
use bun_lint::span::Span;
use bun_react_compiler::hir::VariableBinding;
use rustc_hash::FxHashMap;

/// How much stack the compiler can take for a level of the tree: twice what its lowering, which
/// takes the most, was seen to take. A build that is not optimized takes ten times as much. It calls itself
/// along the nesting of what it is given, and along chains such as `a + b + c`, which the parser reads in a loop.
const STACK_FOR_A_LEVEL: usize = if cfg!(any(debug_assertions, bun_asan)) {
    80 << 10
} else {
    8 << 10
};

/// Why there is no tree.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Refusal {
    /// The thread has not the stack for it.
    TooDeep,
    /// Upstream's lowering throws an error without a place for one, which the plugin for ESLint drops.
    ThisParameter,
    /// `using`, which oxlint's compiler leaves alone without a word.
    Using,
}

type Converts<T> = Result<T, Refusal>;

pub(crate) enum Root {
    Function(G::Fn),
    Arrow(E::Arrow),
}

pub(crate) struct Converted {
    pub(crate) root: Root,
    pub(crate) spans: Vec<Span>,
    pub(crate) symbols: Vec<JsSymbol>,
    /// For each of `symbols`: it is bound outside of the function, or nowhere.
    pub(crate) is_outside: Vec<bool>,
    pub(crate) import_bindings: Vec<(Ref, VariableBinding)>,
    /// The tag of `<>`.
    pub(crate) fragment: Ref,
    pub(crate) recorded: Vec<Recorded>,
    /// [`Host::type_casts`](bun_react_compiler::Host::type_casts)
    pub(crate) casts: Vec<(Loc, Loc)>,
    /// [`Host::targets_with_defaults`](bun_react_compiler::Host::targets_with_defaults)
    pub(crate) defaults: Vec<(Loc, Loc)>,
    /// Each `new Date()` and `Date()`, which is in the tree as `Date.now()`. In the order of the source.
    pub(crate) clock_reads: Vec<Span>,
}

/// What the lowering that the flavor has records, and Bun's does not.
#[derive(Copy, Clone)]
pub(crate) enum Recorded {
    /// The `arguments` of a function is read.
    ImplicitArguments(Span),
    /// The `import` of `import(..)`.
    DynamicImport(Span),
    /// JSX that is the default of a parameter or in a pattern. Bun's lowering sees a call, which can be evaluated earlier
    /// if its operands can.
    DefaultIsJsx { span: Span, is_fragment: bool },
}

impl Converted {
    /// The range of the node that had `Loc { start: index }`.
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

pub(crate) struct Converter<'a, 'x> {
    file: &'a File<'a>,
    arena: &'x Arena,
    flavor: Flavor,
    /// The range of the function that is compiled.
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
    clock_reads: Vec<Span>,
    depth: u32,
    /// How many levels the thread has the stack for.
    max_depth: u32,
    stack: bun_core::StackCheck,
}

/// `func` has a body. An AST allocator scope is entered, and lasts as long as what is returned.
pub(crate) fn convert<'a>(
    file: &'a File<'a>,
    arena: &Arena,
    func: Func<'a>,
    flavor: Flavor,
) -> Converts<Converted> {
    let stack = bun_core::StackCheck::init();
    let max_depth = (stack.remaining() / STACK_FOR_A_LEVEL) as u32;
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
        clock_reads: Vec::new(),
        depth: 0,
        max_depth,
        stack,
    };
    converter.create_element = converter.new_symbol(b"createElement", SymbolKind::Unbound, true);
    converter.fragment = converter.new_symbol(b"Fragment", SymbolKind::Unbound, true);
    let root = match func.is_arrow() {
        true => Root::Arrow(converter.arrow(func)?),
        false => Root::Function(converter.function(func)?),
    };
    // Of `(x as A) as B`, which is there twice, the outer one, which is the later one.
    let mut casts = converter.casts;
    casts.reverse();
    bun_lint::utils::sort::sort_by_key(&mut casts, |it| it.0.start);
    casts.dedup_by_key(|it| it.0.start);
    let mut defaults = converter.defaults;
    bun_lint::utils::sort::sort_by_key(&mut defaults, |it| it.0.start);
    Ok(Converted {
        root,
        casts,
        defaults,
        spans: converter.spans,
        symbols: converter.symbols,
        is_outside: converter.is_outside,
        import_bindings: converter.import_bindings,
        fragment: converter.fragment,
        recorded: converter.recorded,
        clock_reads: converter.clock_reads,
    })
}

fn leak<T>(list: AstVec<T>) -> StoreSlice<T> {
    StoreSlice::new_mut(list.leak())
}

impl<'a> Converter<'a, '_> {
    // ───────────────────────────── places ─────────────────────────────

    fn loc(&mut self, span: Span) -> Loc {
        let index = self.spans.len() as i32;
        self.spans.push(span);
        Loc { start: index }
    }

    /// Calls `then` one level further down.
    fn nested<T>(&mut self, then: impl FnOnce(&mut Self) -> Converts<T>) -> Converts<T> {
        if self.depth >= self.max_depth || !self.stack.is_safe_to_recurse() {
            return Err(Refusal::TooDeep);
        }
        self.depth += 1;
        let result = then(self);
        self.depth -= 1;
        result
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

    fn ref_of_symbol(&mut self, symbol: Symbol<'a>) -> Ref {
        if let Some(known) = self.by_symbol.get(&symbol.key()) {
            return *known;
        }
        let declaration = symbol.declarations().next();
        let is_outside = !self.root.contains(symbol.scope().span())
            || matches!(declaration, Some(Declaration::Fn(func)) if self.is_without_its_name(func));
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
                    // oxc's compiler knows that it is as incompatible as the other.
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
            // All that the lowering asks of it is that it is not a local.
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

    /// What the identifier `expr`, which is named `name`, refers to.
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

    /// The parameters, whether the last is a rest parameter, and what the body is to start with.
    fn args(&mut self, func: Func<'a>) -> Converts<(StoreSlice<G::Arg>, bool, AstVec<JsStmt>)> {
        // A `this` parameter is a type. oxc's lowering does not see it either.
        if self.flavor == Flavor::Eslint && func.this_param().is_some() {
            return Err(Refusal::ThisParameter);
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
        let mut binding = self.binding(param.pat())?;
        let default = self.default(&binding, param.pat(), param.default())?;
        // oxc's lowering takes a parameter apart as a declaration does, which can have a variable that a
        // function in it assigns. Upstream's does that for the `...rest` of an object, Bun's for nothing.
        let is_taken_apart_in_body = match (self.flavor, param.pat().kind()) {
            (Flavor::Oxlint, PatKind::Object(_) | PatKind::Array(_)) => is_assigned(param.pat()),
            (Flavor::Eslint, PatKind::Object(props)) => props
                .iter()
                .all(|it| it.is_rest() || !is_assigned(it.value())),
            _ => false,
        };
        if is_taken_apart_in_body && !param.is_rest() && is_assigned(param.pat()) {
            binding = self.declared_in_body(binding, SymbolKind::Hoisted, first);
        }
        Ok(G::Arg {
            binding,
            default,
            ..G::Arg::default()
        })
    }

    /// `({ a }) => ..` as `(t) => { let { a } = t; .. }`: the `t`. The declaration is added to `first`.
    fn declared_in_body(
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

    /// The body, after `first`, and whether it is an expression. The `Loc` of the body is what the
    /// lowering takes for that of the function.
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

    /// Upstream's compiler fails on a function expression that refers to itself by its name. oxc's does not: the
    /// name is as good as one from outside.
    fn is_without_its_name(&self, func: Func<'a>) -> bool {
        self.flavor == Flavor::Oxlint
            && func.kind() == FnKind::Expr
            && func.estree_span() != self.root
    }

    fn function(&mut self, func: Func<'a>) -> Converts<G::Fn> {
        self.nested(|this| {
            let loc = this.loc(func.estree_span());
            let name = match func.name() {
                Some(_) if this.is_without_its_name(func) => None,
                Some(name) => Some(LocRef {
                    loc: this.loc(name.span()),
                    ref_: this.declared(func.symbol(), name.name()),
                }),
                None => None,
            };
            let (args, has_rest, first) = this.args(func)?;
            let (body, _) = this.body(func, loc, first)?;
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
            let (args, has_rest_arg, first) = this.args(func)?;
            let (body, prefer_expr) = this.body(func, loc, first)?;
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

    /// A function expression, an arrow function, or the value of a method, at `span`.
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
        Ok(Some(self.expr(value)?))
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
                    let r#ref = this.declared(pat.symbol(), name);
                    Binding::alloc(this.arena, B::Identifier { r#ref }, loc)
                }
                PatKind::Array(elements) => {
                    let mut items: AstVec<ArrayBinding> =
                        AstAlloc::vec_with_capacity(elements.len());
                    let mut has_spread = false;
                    for element in elements {
                        has_spread = element.is_rest();
                        let (binding, default_value) = match element.pat() {
                            Some(pat) => {
                                let binding = this.binding(pat)?;
                                let default_value =
                                    this.default(&binding, pat, element.default())?;
                                (binding, default_value)
                            }
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
                        let value = this.binding(prop.value())?;
                        let default_value = this.default(&value, prop.value(), prop.default())?;
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

    /// `at`: the place to give a key that is not computed, in place of its own.
    fn key(&mut self, key: Key<'a>, at: Option<Span>) -> Converts<(JsExpr, flags::PropertySet)> {
        let span = at.unwrap_or_else(|| key.inner_span(self.file));
        let number = |name: Name<'a>| std::str::from_utf8(name.bytes()).ok()?.parse::<f64>().ok();
        let computed = flags::PropertySet::only(flags::Property::IsComputed);
        Ok(match key.kind() {
            KeyKind::Ident(name) | KeyKind::String(name) => {
                (self.string(name.bytes(), span)?, flags::PROPERTY_NONE)
            }
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
                let span = key.inner_span(self.file);
                (self.string(name.bytes(), span)?, computed)
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

    fn property(&mut self, prop: Prop<'a>) -> Converts<G::Property> {
        let kind = prop.kind();
        if kind == PropKind::Spread {
            return Ok(G::Property {
                kind: G::PropertyKind::Spread,
                value: prop.value().map(|it| self.expr(it)).transpose()?,
                ..G::Property::default()
            });
        }
        // Upstream has the whole of a method where the lowering has its key and its function.
        let is_function = matches!(kind, PropKind::Method | PropKind::Getter | PropKind::Setter);
        let (key, mut flags) = match prop.key() {
            Some(key) => {
                let (key, flags) = self.key(key, is_function.then(|| prop.span()))?;
                (Some(key), flags)
            }
            None => (None, flags::PROPERTY_NONE),
        };
        let value = match (is_function, prop.func()) {
            (true, Some(func)) => Some(self.function_expr(func, prop.span())?),
            _ => prop.value().map(|it| self.expr(it)).transpose()?,
        };
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

    fn properties(&mut self, props: List<'a, Prop<'a>>) -> Converts<G::PropertyList> {
        let mut properties: G::PropertyList = AstAlloc::vec_with_capacity(props.len());
        for prop in props {
            properties.push(self.property(prop)?);
        }
        Ok(properties)
    }

    // ───────────────────────────── classes ─────────────────────────────

    /// The compiler refuses a class. It looks into one for what it refers to.
    fn class(&mut self, class: Class<'a>) -> Converts<G::Class> {
        self.nested(|this| {
            let class_name = match class.name() {
                Some(name) => Some(LocRef {
                    loc: this.loc(name.span()),
                    ref_: this.declared(class.symbol(), name.name()),
                }),
                None => None,
            };
            let extends = class.extends().map(|it| this.expr(it)).transpose()?;
            let mut properties: AstVec<G::Property> =
                AstAlloc::vec_with_capacity(class.members().len());
            for member in class.members() {
                if let Some(property) = this.member(member)? {
                    properties.push(property);
                }
            }
            Ok(G::Class {
                class_name,
                extends,
                properties: leak(properties),
                ..G::Class::default()
            })
        })
    }

    /// `None`: it is there for the types alone.
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
        let mut converted: bun_ast::ExprNodeList = AstAlloc::vec_with_capacity(list.len());
        for expr in list {
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

    pub(crate) fn expr(&mut self, expr: Expr<'a>) -> Converts<JsExpr> {
        self.nested(|this| this.expr_at(expr, expr.span()))
    }

    fn expr_at(&mut self, expr: Expr<'a>, span: Span) -> Converts<JsExpr> {
        // What is only there for the types has no node in this tree.
        if let ExprKind::NonNull(inner) | ExprKind::Instantiation { expr: inner, .. } = expr.kind()
        {
            return self.expr(inner);
        }
        if let ExprKind::As { expr: inner, .. }
        | ExprKind::Satisfies { expr: inner, .. }
        | ExprKind::AsConst(inner) = expr.kind()
        {
            let cast = self.loc(span);
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
            // oxc's lowering has them. To the compiler one primitive is as good as another.
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
                    // oxc's lowering has the tag and the substitutions as operands, as a call has.
                    Some(ExprKind::Template(template))
                        if self.flavor == Flavor::Oxlint && !template.exprs().is_empty() =>
                    {
                        JsExpr::init(
                            E::Call {
                                target: tag,
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
                    items: self.exprs(items)?,
                    ..E::Array::default()
                },
                loc,
            ),
            ExprKind::Object(props) => JsExpr::init(
                E::Object {
                    properties: self.properties(props)?,
                    ..E::Object::default()
                },
                loc,
            ),
            ExprKind::Class(class) => JsExpr::init(self.class(class)?, loc),
            ExprKind::Dot { obj, name, chain } => self.dot(obj, name, chain, loc)?,
            ExprKind::Index { obj, index, chain } => JsExpr::init(
                E::Index {
                    target: self.expr(obj)?,
                    index: self.expr(index)?,
                    optional_chain: Self::chain(chain),
                    is_import_property_use: false,
                },
                loc,
            ),
            ExprKind::Call(call) | ExprKind::New(call)
                if self.flavor == Flavor::Oxlint && is_clock_read(call) =>
            {
                self.clock_reads.push(span);
                let target = self.expr(call.callee())?;
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
            ExprKind::Call(call) => JsExpr::init(
                E::Call {
                    target: self.expr(call.callee())?,
                    args: self.exprs(call.args())?,
                    optional_chain: Self::chain(call.chain()),
                    ..E::Call::default()
                },
                loc,
            ),
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
            ExprKind::Binary { op, left, right } => JsExpr::init(
                E::Binary {
                    left: self.expr(left)?,
                    right: self.expr(right)?,
                    op: binary_op(op),
                },
                loc,
            ),
            ExprKind::Assign { op, target, value } => {
                let recorded = self.recorded.len();
                let (left, right) = (self.expr(target)?, self.expr(value)?);
                // No lowering has these, and none looks into them.
                if matches!(op, Some(BinOp::And | BinOp::Or | BinOp::Nullish)) {
                    self.recorded.truncate(recorded);
                }
                let op = assign_op(op);
                JsExpr::init(E::Binary { left, right, op }, loc)
            }
            ExprKind::Cond { test, yes, no } => JsExpr::init(
                E::If {
                    test: self.expr(test)?,
                    yes: self.expr(yes)?,
                    no: self.expr(no)?,
                },
                loc,
            ),
            ExprKind::Spread(value) => JsExpr::init(
                E::Spread {
                    value: self.expr(value)?,
                },
                loc,
            ),
            ExprKind::Await(value) => JsExpr::init(
                E::Await {
                    value: self.expr(value)?,
                },
                loc,
            ),
            ExprKind::Yield { value, star } => JsExpr::init(
                E::Yield {
                    value: value.map(|it| self.expr(it)).transpose()?,
                    is_star: star,
                },
                loc,
            ),
            ExprKind::Jsx(jsx) => self.jsx(jsx, loc)?,
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
            // Returned above.
            ExprKind::Fn(_)
            | ExprKind::As { .. }
            | ExprKind::Satisfies { .. }
            | ExprKind::AsConst(_)
            | ExprKind::NonNull(_)
            | ExprKind::Instantiation { .. } => JsExpr::init(E::Missing {}, loc),
        })
    }

    fn dot(&mut self, obj: Expr<'a>, name: Ident<'a>, chain: Chain, loc: Loc) -> Converts<JsExpr> {
        let target = self.expr(obj)?;
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

    /// A tagged template has its text as it is written, unless that has an escape. Bun's lowering
    /// refuses the template then, by the `\`, and oxc's does not. The text, which is left out, plays
    /// no part in the analysis.
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
            tag,
            parts: leak(parts),
            head: contents(0),
        })
    }

    // ───────────────────────────── JSX ─────────────────────────────

    fn jsx_tag(&mut self, tag: Expr<'a>) -> Converts<JsExpr> {
        match tag.kind() {
            // A name that starts with a small letter is that of an element of the host.
            ExprKind::Ident(name) if !name.bytes().first().is_some_and(u8::is_ascii_uppercase) => {
                self.string(name.bytes(), tag.span())
            }
            _ => self.expr(tag),
        }
    }

    fn jsx(&mut self, jsx: Jsx<'a>, loc: Loc) -> Converts<JsExpr> {
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
                    let mut property = self.property(attr)?;
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

    fn label(&mut self, stmt: Stmt<'a>) -> Converts<Option<LocRef>> {
        Ok(match stmt.label() {
            Some(label) => Some(LocRef {
                loc: self.loc(label.span()),
                ref_: self.ref_of_name(Named::Label, label.name()),
            }),
            None => None,
        })
    }

    fn local(&mut self, decls: List<'a, VarDecl<'a>>, loc: Loc) -> Converts<JsStmt> {
        let kind = match decls.first().map(VarDecl::var_kind) {
            Some(VarKind::Var) | None => S::Kind::KVar,
            Some(VarKind::Let) => S::Kind::KLet,
            Some(VarKind::Const) => S::Kind::KConst,
            Some(VarKind::Using | VarKind::AwaitUsing) => return Err(Refusal::Using),
        };
        let mut converted: G::DeclList = AstAlloc::vec_with_capacity(decls.len());
        for decl in decls {
            converted.push(G::Decl {
                binding: self.binding(decl.pat())?,
                value: decl.init().map(|it| self.expr(it)).transpose()?,
            });
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
            StmtKind::Var(decls) => self.local(decls, loc)?,
            StmtKind::Fn(func) if func.has_body() => JsStmt::alloc(
                S::Function {
                    func: self.function(func)?,
                },
                loc,
            ),
            // What is there for the types alone.
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
            // The compiler looks at neither.
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
            StmtKind::If { test, yes, no } => JsStmt::alloc(
                S::If {
                    test: self.expr(test)?,
                    yes: self.stmt(yes)?,
                    no: no.map(|it| self.stmt(it)).transpose()?,
                },
                loc,
            ),
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => JsStmt::alloc(
                S::For {
                    init: init.map(|it| self.stmt(it)).transpose()?,
                    test: match (test, self.flavor) {
                        (Some(it), _) => Some(self.expr(it)?),
                        // Both lowerings go on as for `while (true)`. Upstream's records a Todo as well.
                        (None, Flavor::Oxlint) => {
                            Some(JsExpr::init(E::Boolean { value: true }, loc))
                        }
                        (None, Flavor::Eslint) => None,
                    },
                    update: update.map(|it| self.expr(it)).transpose()?,
                    body: self.stmt(body)?,
                },
                loc,
            ),
            StmtKind::ForIn { left, expr, body } => JsStmt::alloc(
                S::ForIn {
                    init: self.stmt(left)?,
                    value: self.expr(expr)?,
                    body: self.stmt(body)?,
                },
                loc,
            ),
            StmtKind::ForOf {
                left,
                expr,
                body,
                is_await,
            } => JsStmt::alloc(
                S::ForOf {
                    is_await,
                    init: self.stmt(left)?,
                    value: self.expr(expr)?,
                    body: self.stmt(body)?,
                },
                loc,
            ),
            StmtKind::While { test, body } => JsStmt::alloc(
                S::While {
                    test: self.expr(test)?,
                    body: self.stmt(body)?,
                },
                loc,
            ),
            StmtKind::DoWhile { body, test } => JsStmt::alloc(
                S::DoWhile {
                    body: self.stmt(body)?,
                    test: self.expr(test)?,
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
                let test = self.expr(expr)?;
                let mut converted: AstVec<Case> = AstAlloc::vec_with_capacity(cases.len());
                for case in cases {
                    converted.push(Case {
                        loc: self.loc(case.span()),
                        value: case.test().map(|it| self.expr(it)).transpose()?,
                        body: self.stmts(case.body())?,
                    });
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
                let body = self.block(block)?;
                let catch = match handler {
                    Some(handler) => {
                        let loc =
                            self.loc(stmt.catch_clause_span().unwrap_or_else(|| handler.span()));
                        let mut binding = param.map(|it| self.binding(it.pat())).transpose()?;
                        let mut first: AstVec<JsStmt> = AstAlloc::vec();
                        // Upstream's compiler fails on a parameter that a function refers to. oxc's does not.
                        if self.flavor == Flavor::Oxlint
                            && param.is_some_and(|it| is_captured_pattern(it.pat(), stmt))
                        {
                            let kind = SymbolKind::CatchIdentifier;
                            binding = binding.map(|it| self.declared_in_body(it, kind, &mut first));
                        }
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
                let finally = match finalizer {
                    Some(finalizer) => Some(Finally {
                        loc: self.loc(finalizer.span()),
                        stmts: self.block(finalizer)?,
                    }),
                    None => None,
                };
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
                    label: self.label(stmt)?,
                },
                loc,
            ),
            StmtKind::Continue(_) => JsStmt::alloc(
                S::Continue {
                    label: self.label(stmt)?,
                },
                loc,
            ),
            StmtKind::Labeled { label, body } => {
                let name = match self.label(stmt)? {
                    Some(name) => name,
                    None => LocRef {
                        loc,
                        ref_: self.ref_of_name(Named::Label, label),
                    },
                };
                JsStmt::alloc(
                    S::Label {
                        name,
                        stmt: self.stmt(body)?,
                    },
                    loc,
                )
            }
            // None of these can be in a function. The compiler says so of this one.
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

/// A pattern with a variable that is assigned somewhere.
fn is_assigned(pat: Pat<'_>) -> bool {
    let mut is_assigned = false;
    pat.for_each_binding(&mut |name| {
        is_assigned |= (name.symbol().into_iter())
            .flat_map(Symbol::references)
            .any(|it| it.is_write() && !it.is_init());
    });
    is_assigned
}

/// A pattern of `stmt` with a variable that a function in `stmt` refers to.
fn is_captured_pattern<'a>(pat: Pat<'a>, stmt: Stmt<'a>) -> bool {
    let around = Node::Stmt(stmt).enclosing_function().map(Func::span);
    let mut is_captured = false;
    pat.for_each_binding(&mut |name| {
        is_captured |= (name.symbol().into_iter())
            .flat_map(Symbol::references)
            .any(|it| it.node().enclosing_function().map(Func::span) != around);
    });
    is_captured
}

/// `new Date()`, `Date()`. To oxlint's compiler it is as impure as `Date.now()`, which is the one that Bun's knows.
fn is_clock_read(call: Call<'_>) -> bool {
    let callee = call.callee();
    call.args().is_empty()
        && call.chain() == Chain::No
        && callee.is_ident("Date")
        && callee.symbol().is_none()
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

/// `op`: that of `a op= b`.
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
        // No other operator can be written before a `=`.
        _ => OpCode::BinAssign,
    }
}
