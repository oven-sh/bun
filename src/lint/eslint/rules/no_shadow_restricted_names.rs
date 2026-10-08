use bun_lint::prelude::*;

/// Disallow identifiers from shadowing restricted names.
pub struct NoShadowRestrictedNames {
    report_global_this: bool,
}

const SHADOWING_RESTRICTED_NAME: Message =
    Message::new("shadowingRestrictedName", "Shadowing of global property '{{name}}'.");

/// A variable named `undefined` that is never given a value is the same as the global.
fn safely_shadows_undefined(symbol: Symbol) -> bool {
    symbol.name().is("undefined")
        && symbol.declarations().all(|declaration| {
            matches!(declaration, Declaration::Var(_))
                && matches!(declaration.node(), Some(Node::VarDecl(decl))
                    if decl.init().is_none()
                        && matches!(decl.parent(), Node::Stmt(stmt) if stmt.tag() == StmtTag::Var))
        })
        && symbol.references().all(|reference| !reference.is_write())
}

impl NoShadowRestrictedNames {
    fn is_restricted(&self, name: Name) -> bool {
        match name.bytes() {
            b"undefined" | b"NaN" | b"Infinity" | b"arguments" | b"eval" => true,
            b"globalThis" => self.report_global_this,
            _ => false,
        }
    }

    fn report_once<'a>(at: Span, name: Name<'a>, cx: &mut Cx<'a, Self>) {
        if !cx.state.contains(&at.start) {
            cx.state.push(at.start);
            cx.report(at, SHADOWING_RESTRICTED_NAME).data("name", name);
        }
    }

    /// `at`: where a restricted `name` is declared. All the declarations of the variable are
    /// reported with it.
    fn report<'a>(at: Span, name: Name<'a>, symbol: Option<Symbol<'a>>, cx: &mut Cx<'a, Self>) {
        if symbol.is_some_and(safely_shadows_undefined) {
            return;
        }
        Self::report_once(at, name, cx);
        for declaration in symbol.into_iter().flat_map(Symbol::declarations) {
            if let Some(other) = declaration.name_span() {
                Self::report_once(other, name, cx);
            }
        }
    }

    fn check_pat<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        let Some(name) = pat.as_ident().filter(|name| self.is_restricted(*name)) else {
            return;
        };
        let owner = Node::Pat(pat).ancestors().find(|it| matches!(it, Node::VarDecl(_) | Node::Param(_)));
        // The parameters of a signature or of an overload are not those of a `:function`.
        if let Some(Node::Param(param)) = owner
            && !param.func().is_some_and(Func::has_body)
        {
            return;
        }
        Self::report(pat.span(), name, pat.symbol(), cx);
    }

    fn check_ident<'a>(&self, ident: Option<Ident<'a>>, symbol: Option<Symbol<'a>>, cx: &mut Cx<'a, Self>) {
        if let Some(ident) = ident
            && self.is_restricted(ident.name())
        {
            Self::report(ident.span(), ident.name(), symbol, cx);
        }
    }
}

impl Rule for NoShadowRestrictedNames {
    const META: Meta = Meta::eslint("no-shadow-restricted-names", Kind::Suggestion).recommended();
    /// Where the names that have been reported start.
    type State<'a> = Vec<u32>;

    fn new(options: &Options) -> Self {
        NoShadowRestrictedNames {
            report_global_this: options.object(0).bool_or("reportGlobalThis", true),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Vec<u32> {
        on.pats([PatTag::Ident], Self::check_pat);
        on.funcs(|rule, func, cx| {
            if func.has_body() {
                rule.check_ident(func.name(), func.symbol(), cx);
            }
        });
        on.classes(|rule, class, cx| rule.check_ident(class.name(), class.symbol(), cx));
        on.stmts([StmtTag::Import], |rule, stmt, cx| {
            if let StmtKind::Import(import) = stmt.kind() {
                rule.check_ident(import.default(), None, cx);
                rule.check_ident(import.namespace(), None, cx);
            }
        });
        on.import_specs(|rule, spec, cx| rule.check_ident(Some(spec.local()), None, cx));
        Vec::new()
    }
}
