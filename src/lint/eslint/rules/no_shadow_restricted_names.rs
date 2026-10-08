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

/// ESLint's `def.name`: typescript-eslint has the type annotation as a part of the `Identifier`.
fn name_span(declaration: Declaration) -> Option<Span> {
    match declaration {
        Declaration::Var(pat) | Declaration::Param(pat) => Some(utils::estree_span(Node::Pat(pat))),
        _ => declaration.name_span(),
    }
}

pub struct State<'a> {
    restricted: [Name<'a>; 6],
    /// Where the names that have been reported start.
    reported: Vec<u32>,
}

impl NoShadowRestrictedNames {
    #[inline]
    fn is_restricted<'a>(name: Name<'a>, cx: &Cx<'a, Self>) -> bool {
        cx.state.restricted.contains(&name)
    }

    fn report_once<'a>(at: Span, name: Name<'a>, cx: &mut Cx<'a, Self>) {
        if !cx.state.reported.contains(&at.start) {
            cx.state.reported.push(at.start);
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
            if let Some(other) = name_span(declaration) {
                Self::report_once(other, name, cx);
            }
        }
    }

    fn check_pat<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        let Some(name) = pat.as_ident().filter(|name| Self::is_restricted(*name, cx)) else {
            return;
        };
        let owner = Node::Pat(pat).ancestors().find(|it| matches!(it, Node::VarDecl(_) | Node::Param(_)));
        // The parameters of a signature or of an overload are not those of a `:function`.
        if let Some(Node::Param(param)) = owner
            && !param.func().is_some_and(Func::has_body)
        {
            return;
        }
        Self::report(utils::estree_span(Node::Pat(pat)), name, pat.symbol(), cx);
    }
}

impl Rule for NoShadowRestrictedNames {
    const META: Meta = Meta::eslint("no-shadow-restricted-names", Kind::Suggestion).recommended();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        NoShadowRestrictedNames {
            report_global_this: options.object(0).bool_or("reportGlobalThis", true),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        on.pats([PatTag::Ident], Self::check_pat);
        on.funcs(|_, func, cx| {
            if let Some(name) = func.name()
                && Self::is_restricted(name.name(), cx)
                && func.has_body()
            {
                Self::report(name.span(), name.name(), func.symbol(), cx);
            }
        });
        on.classes(|_, class, cx| {
            if let Some(name) = class.name()
                && Self::is_restricted(name.name(), cx)
            {
                Self::report(name.span(), name.name(), class.symbol(), cx);
            }
        });
        on.stmts([StmtTag::Import], |_, stmt, cx| {
            let StmtKind::Import(import) = stmt.kind() else {
                return;
            };
            let named = import.named().iter().map(ImportSpec::local);
            for local in import.default().into_iter().chain(import.namespace()).chain(named) {
                if Self::is_restricted(local.name(), cx) {
                    let symbol = Node::Stmt(stmt).scope().get_name(local.name());
                    Self::report(local.span(), local.name(), symbol, cx);
                }
            }
        });
        let last = if self.report_global_this { "globalThis" } else { "eval" };
        State {
            restricted: ["undefined", "NaN", "Infinity", "arguments", "eval", last].map(|name| file.name_of(name)),
            reported: Vec::new(),
        }
    }
}
