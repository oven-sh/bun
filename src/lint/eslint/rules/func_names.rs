use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint_oxlint::ast_util::static_property_name;

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
/// What oxlint suggests.
const REMOVE_NAME: Message = Message::new("removeName", "Remove the name.");

/// [`guess_function_name`], by what the function is in.
type GuessedNames<'a> = AncestorMemo<'a, Option<Name<'a>>>;

/// oxlint's `is_valid_identifier_name`.
fn is_valid_identifier_name(name: &[u8]) -> bool {
    const TAKEN: &[u8] = b"let static implements interface package private protected public await break case catch class \
        const continue debugger default delete do else enum export extends false finally for function if import in \
        instanceof new null return super switch this throw true try typeof var void while with yield Infinity NaN \
        globalThis undefined arguments eval constructor async";
    !strings::split(TAKEN, b" ").any(|it| it == name) && text::is_identifier_name(name)
}

/// oxlint's `guess_function_name`: that of the first assignment, declarator, property or field around the function,
/// however far out that is.
#[cold]
#[inline(never)]
fn guess_function_name<'a>(func: Func<'a>, known: &mut GuessedNames<'a>) -> Option<Name<'a>> {
    let found = known.find(func.into(), |_, parent| match parent {
        Node::Expr(e) => match e.kind() {
            ExprKind::Assign { target, .. } if !utils::is_assignment_target(e) => {
                Some(target.as_ident().or_else(|| static_property_name(target)))
            }
            _ => None,
        },
        Node::VarDecl(declarator) if matches!(declarator.parent(), Node::Stmt(it) if it.tag() == StmtTag::Var) => {
            Some(declarator.pat().as_ident())
        }
        Node::Prop(prop) if !prop.is_jsx_attribute() && prop.kind() != PropKind::Spread => {
            let is_in_target = matches!(prop.parent(), Node::Expr(object) if utils::is_assignment_target(object));
            (!is_in_target).then(|| prop.key().and_then(Key::name))
        }
        Node::Member(member)
            if member.kind() == MemberKind::Property
                && matches!(member.parent(), Node::Class(_))
                && !member.flags().contains(Flags::ACCESSOR) =>
        {
            Some(member.key().and_then(Key::name))
        }
        _ => None,
    });
    found.flatten().filter(|name| is_valid_identifier_name(name.bytes()))
}

/// oxlint's fix: the function gets the name, unless that means something in the function.
#[cold]
#[inline(never)]
fn add_name<'a>(fixer: Fixer<'a>, func: Func<'a>, known: &mut GuessedNames<'a>) -> Option<Fix> {
    let (name, scope) = (guess_function_name(func, known)?, func.scope()?);
    let is_used_in_function = |symbol: Symbol<'a>| match scope.contains(symbol.scope()) {
        true => symbol.references().next().is_some(),
        false => scope.through().any(|it| it.symbol() == Some(symbol)),
    };
    if scope.resolve_name(name).is_some_and(is_used_in_function) {
        return None;
    }
    let after = match func.type_params().first() {
        Some(first) => fixer.file().token_before(first)?.span(),
        None => func.params_span()?,
    };
    Some(fixer.insert_before(after, [b" ", name.bytes()].concat()))
}

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

impl Rule for FuncNames {
    const META: Meta = Meta::eslint("func-names", Kind::Suggestion);
    const ON: On = On::new().funcs();
    type State<'a> = GuessedNames<'a>;

    fn new(options: &Options) -> Self {
        FuncNames {
            config: Config::parse(options.str(0)).unwrap_or(Config::Always),
            generators: Config::parse(options.object(1).str("generators")),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<GuessedNames<'a>> {
        Some(GuessedNames::default())
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        // A method has no name of its own and never needs one.
        // For oxlint `export default function (): void;` is a function like others.
        if !matches!(func.kind(), FnKind::Expr | FnKind::Decl) || !func.has_body() && !cx.language().is_oxlint {
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
                // For oxlint the name is needed only where the function calls itself.
                Some(symbol) if cx.language().is_oxlint => {
                    let is_called = |e: Expr<'a>| {
                        !e.is_parenthesized()
                            && matches!(e.parent(), Node::Expr(it) if it.as_call().is_some_and(|it| it.callee() == e))
                    };
                    if symbol.references().any(|it| it.expr().is_some_and(is_called)) {
                        return;
                    }
                    NAMED
                }
                Some(symbol) if symbol.references().next().is_some() => return,
                _ => NAMED,
            },
            Node::Expr(e) if config == Config::AsNeeded && has_inferred_name(e) => return,
            Node::Expr(_) => UNNAMED,
            _ => return,
        };
        let head = ast_utils::get_function_head_loc(func);
        // For oxlint it starts with the function, not with the member that the function is the value of.
        let (start, name) = match cx.language().is_oxlint {
            true => (func.estree_span().start, utils::oxlint::get_function_name_with_kind(func)),
            false => (head.start, ast_utils::get_function_name_with_kind(func)),
        };
        let report = cx.report(Span::new(start, head.end), message).data("name", name);
        if cx.language().is_oxlint {
            match func.name() {
                Some(name) => report.suggest(REMOVE_NAME, |fixer| fixer.remove(name)),
                None => report.fix(|fixer| add_name(fixer, func, &mut cx.state)),
            };
        }
    }
}
