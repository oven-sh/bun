use bun_lint::prelude::*;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

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

/// ESLint's `def.name`: typescript-eslint has the type annotation as a part of the `Identifier`, oxlint has not.
fn name_span(declaration: Declaration) -> Option<Span> {
    match declaration {
        Declaration::Var(pat) | Declaration::Param(pat) if !pat.file().language().is_oxlint => {
            Some(utils::estree_span(Node::Pat(pat)))
        }
        _ => declaration.name_span(),
    }
}

pub struct State<'a> {
    /// Those of the restricted names that the file mentions.
    restricted: SmallVec<[Name<'a>; 6]>,
    /// Where the names that have been reported start.
    reported: FxHashSet<u32>,
    /// `safely_shadows_undefined`, for the variables with several declarations that have been looked
    /// at.
    seen: FxHashMap<Symbol<'a>, bool>,
}

impl NoShadowRestrictedNames {
    #[inline]
    fn is_restricted<'a>(name: Name<'a>, cx: &Cx<'a, Self>) -> bool {
        cx.state.restricted.contains(&name)
    }

    fn report_once<'a>(at: Span, name: Name<'a>, cx: &mut Cx<'a, Self>) {
        if cx.state.reported.insert(at.start) {
            cx.report(at, SHADOWING_RESTRICTED_NAME).data("name", name);
        }
    }

    /// `at`: where a restricted `name` is declared. All the declarations of the variable are
    /// reported with it.
    fn report<'a>(at: Span, name: Name<'a>, symbol: Option<Symbol<'a>>, cx: &mut Cx<'a, Self>) {
        let with_others = symbol.filter(|it| it.declaration_count() > 1);
        let seen = with_others.and_then(|it| cx.state.seen.get(&it).copied());
        let is_safe = seen.unwrap_or_else(|| symbol.is_some_and(safely_shadows_undefined));
        if seen.is_none() {
            cx.state.seen.extend(with_others.map(|it| (it, is_safe)));
        }
        if is_safe {
            return;
        }
        Self::report_once(at, name, cx);
        // The other declarations have been reported with the first.
        if seen.is_some() {
            return;
        }
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
        // The parameters of a signature or of an overload are not those of a `:function`. oxlint looks at them.
        if let Some(Node::Param(param)) = owner
            && !param.func().is_some_and(Func::has_body)
            && !cx.language().is_oxlint
        {
            return;
        }
        let place = if cx.language().is_oxlint { pat.span() } else { utils::estree_span(Node::Pat(pat)) };
        Self::report(place, name, pat.symbol(), cx);
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
        let last = if self.report_global_this { "globalThis" } else { "eval" };
        let names = ["undefined", "NaN", "Infinity", "arguments", "eval", last];
        let state = State {
            restricted: names.into_iter().filter(|name| file.mentions(name)).map(|name| file.name_of(name)).collect(),
            reported: FxHashSet::default(),
            seen: FxHashMap::default(),
        };
        if state.restricted.is_empty() {
            return state;
        }
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
        // `namespace globalThis {}`
        if file.language().is_oxlint {
            on.stmts([StmtTag::Module], |_, stmt, cx| {
                if let StmtKind::Module(module) = stmt.kind()
                    && let ModuleName::Ident(name) = module.name()
                    && Self::is_restricted(name.name(), cx)
                {
                    Self::report_once(name.span(), name.name(), cx);
                }
            });
        }
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
        state
    }
}
