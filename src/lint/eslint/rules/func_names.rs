use bun_lint::prelude::*;

/// Require or disallow named `function` expressions.
pub struct FuncNames {
    config: Config,
    generators: Option<Config>,
}

#[derive(Copy, Clone, PartialEq)]
enum Config {
    Always,
    AsNeeded,
    Never,
}

impl Config {
    fn parse(value: Option<&str>) -> Option<Config> {
        match value? {
            "always" => Some(Config::Always),
            "as-needed" => Some(Config::AsNeeded),
            "never" => Some(Config::Never),
            _ => None,
        }
    }
}

const UNNAMED: Message = Message::new("unnamed", "Unexpected unnamed {{name}}.");
const NAMED: Message = Message::new("named", "Unexpected named {{name}}.");

fn is_identifier(pat: Pat) -> bool {
    pat.tag() == PatTag::Ident
}

/// ESLint's `hasInferredName`, for a function expression that is not a method.
fn has_inferred_name(e: Expr) -> bool {
    match e.parent() {
        Node::VarDecl(it) => it.init() == Some(e) && is_identifier(it.pat()),
        Node::Prop(it) => it.value() == Some(e) && !it.is_jsx_attribute(),
        Node::Member(it) => it.init() == Some(e) && !it.flags().contains(Flags::ACCESSOR),
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Assign { target, value, .. } => {
                value == e && target.tag() == ExprTag::Ident
            }
            _ => false,
        },
        Node::Param(it) => it.default() == Some(e) && is_identifier(it.pat()),
        Node::PatProp(it) => it.default() == Some(e) && is_identifier(it.value()),
        Node::PatElem(it) => it.default() == Some(e) && it.pat().is_some_and(is_identifier),
        _ => false,
    }
}

impl FuncNames {
    fn check<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        // A method has no name of its own and never needs one.
        if !matches!(func.kind(), FnKind::Expr | FnKind::Decl) || !func.has_body() {
            return;
        }
        let config = match self.generators {
            Some(generators) if func.is_generator() => generators,
            _ => self.config,
        };
        let has_name = func.name().is_some();
        if has_name != (config == Config::Never) {
            return;
        }
        let message = match func.owner() {
            Node::Stmt(statement) if has_name || !statement.is_default_export() => return,
            Node::Stmt(_) => UNNAMED,
            // It may be recursive.
            Node::Expr(_) if has_name => match func.symbol() {
                Some(symbol) if symbol.references().next().is_some() => return,
                _ => NAMED,
            },
            Node::Expr(e) if config == Config::AsNeeded && has_inferred_name(e) => return,
            Node::Expr(_) => UNNAMED,
            _ => return,
        };
        let head = ast_utils::get_function_head_loc(func);
        // For oxlint it starts with the function, not with the member that the function is the value of.
        let start = if cx.language().is_oxlint { func.estree_span().start } else { head.start };
        cx.report(Span::new(start, head.end), message)
            .data("name", ast_utils::get_function_name_with_kind(func));
    }
}

impl Rule for FuncNames {
    const META: Meta = Meta::eslint("func-names", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        FuncNames {
            config: Config::parse(options.str(0)).unwrap_or(Config::Always),
            generators: Config::parse(options.object(1).str("generators")),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.funcs(Self::check);
    }
}
