use bun_lint_oxlint::ast_util::parent_node;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;
use std::collections::hash_map::Entry;
use smallvec::SmallVec;

/// Prefer `import.meta.{dirname,filename}` over legacy techniques for getting file paths.
pub struct PreferImportMetaProperties;

const DIRNAME: Message = Message::new("", "Do not construct dirname.");
const FILENAME: Message = Message::new("", "Do not construct filename using `fileURLToPath()`.");

/// A function of a module of Node.js.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub enum Function {
    /// `path.dirname`
    Dirname,
    /// `url.fileURLToPath`
    FileUrlToPath,
}

impl Function {
    fn name(self) -> &'static str {
        match self {
            Function::Dirname => "dirname",
            Function::FileUrlToPath => "fileURLToPath",
        }
    }

    fn modules(self) -> &'static [&'static str] {
        match self {
            Function::Dirname => &["path", "node:path"],
            Function::FileUrlToPath => &["url", "node:url"],
        }
    }
}

/// Whether a variable is the function (`false`) or its module (`true`).
type Known<'a> = FxHashMap<(Symbol<'a>, Function, bool), bool>;

/// The call that `e` is directly the first argument of.
fn call_with_first_argument(e: Expr<'_>) -> Option<Expr<'_>> {
    parent_node(e)?.as_expr().filter(|it| it.as_call().is_some_and(|it| it.args().first() == Some(e)))
}

/// `process.getBuiltinModule("module")`
fn is_process_get_builtin_module_call(call: Call, modules: &[&str]) -> bool {
    let callee = call.callee();
    let ExprKind::Dot { obj, name, chain: Chain::No } = callee.kind() else {
        return false;
    };
    call.chain() == Chain::No
        && call.args().len() == 1
        && name.name().is("getBuiltinModule")
        && obj.is_ident("process")
        && !obj.is_parenthesized()
        && !callee.is_parenthesized()
        && (call.args().first().filter(|it| !it.is_parenthesized()).and_then(Expr::as_string))
            .is_some_and(|it| it.is_any(modules))
}

/// `function(a)`, where the callee is the function of the module of Node.js, through imports and constants.
fn is_node_builtin_module_function_call<'a>(call: Expr<'a>, function: Function, known: &mut Known<'a>) -> bool {
    let Some(call) = call.as_call().filter(|it| it.args().len() == 1 && !it.is_optional()) else {
        return false;
    };
    if call.args().first().is_some_and(|it| it.tag() == ExprTag::Spread) {
        return false;
    }
    // The variables that stand for the same as the callee.
    let mut visited: SmallVec<[(Symbol<'a>, Function, bool); 4]> = SmallVec::new();
    let (mut node, mut is_module) = (call.callee(), false);
    let answer = loop {
        if node.is_parenthesized() || node.is_chain_root() {
            break false;
        }
        match node.kind() {
            ExprKind::Dot { obj, name, .. } if !is_module && !node.is_optional() && name.name().is(function.name()) => {
                (node, is_module) = (obj, true);
            }
            ExprKind::Call(call) => break is_module && is_process_get_builtin_module_call(call, function.modules()),
            ExprKind::Ident(_) => {
                let Some(symbol) = node.symbol() else {
                    break false;
                };
                let key = (symbol, function, is_module);
                // While it is being looked at it is not the function: `const path = path`.
                match known.entry(key) {
                    Entry::Occupied(answer) => break *answer.get(),
                    Entry::Vacant(entry) => {
                        entry.insert(false);
                        visited.push(key);
                    }
                }
                match symbol.declarations().next() {
                    Some(Declaration::ImportSpec(specifier)) => {
                        break !is_module
                            && specifier.import().spec().is_any(function.modules())
                            && specifier.imported().name().is(function.name());
                    }
                    Some(Declaration::ImportDefault(import) | Declaration::ImportNamespace(import)) => {
                        break is_module && import.spec().is_any(function.modules());
                    }
                    Some(declaration @ Declaration::Var(_)) if !declaration.is_catch_parameter() => {
                        match initializer_of_constant(declaration, symbol, function, is_module) {
                            Some(next) => (node, is_module) = next,
                            None => break false,
                        }
                    }
                    _ => break false,
                }
            }
            _ => break false,
        }
    };
    for key in visited {
        known.insert(key, answer);
    }
    answer
}

/// For `const symbol = init` the `init`, which is what `symbol` is. For `const { function: symbol } = init` the `init`,
/// which is the module.
fn initializer_of_constant<'a>(
    declaration: Declaration<'a>,
    symbol: Symbol<'a>,
    function: Function,
    is_module: bool,
) -> Option<(Expr<'a>, bool)> {
    let Some(Node::VarDecl(declarator)) = declaration.node() else {
        return None;
    };
    let init = declarator.init().filter(|_| declarator.var_kind() == VarKind::Const)?;
    match declarator.pat().kind() {
        PatKind::Ident(_) => Some((init, is_module)),
        PatKind::Object(properties) => {
            let property = properties.iter().find(|it| {
                it.key().is_some_and(|key| !key.is_computed())
                    && it.default().is_none()
                    && it.value().tag() == PatTag::Ident
                    && it.value().symbol() == Some(symbol)
            })?;
            (!is_module && property.key()?.is(function.name())).then_some((init, true))
        }
        _ => None,
    }
}

type Context<'c, 'a> = &'c mut Cx<'a, PreferImportMetaProperties>;

fn report_dirname<'a>(e: Expr<'a>, cx: &Cx<'a, PreferImportMetaProperties>) {
    cx.report(e, DIRNAME).fix(|fixer| fixer.replace(e, "import.meta.dirname"));
}

/// `path.dirname(node)`
fn report_dirname_call_with<'a>(node: Expr<'a>, cx: Context<'_, 'a>) -> bool {
    let call = call_with_first_argument(node)
        .filter(|it| is_node_builtin_module_function_call(*it, Function::Dirname, &mut cx.state));
    if let Some(call) = call {
        report_dirname(call, cx);
    }
    call.is_some()
}

/// `node`: the name of the file.
fn iterate_problems_from_filename<'a>(node: Expr<'a>, report_filename_node: bool, cx: Context<'_, 'a>) {
    if report_dirname_call_with(node, cx) {
        return;
    }
    if report_filename_node {
        cx.report(node, FILENAME).fix(|fixer| fixer.replace(node, "import.meta.filename"));
    }
    let Some(Node::VarDecl(declarator)) = parent_node(node) else {
        return;
    };
    if declarator.var_kind() != VarKind::Const || declarator.pat().tag() != PatTag::Ident {
        return;
    }
    let Some(symbol) = declarator.pat().symbol() else {
        return;
    };
    for reference in symbol.references().filter(|it| it.is_read()).filter_map(Reference::expr) {
        report_dirname_call_with(reference, cx);
    }
}

impl Rule for PreferImportMetaProperties {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "prefer-import-meta-properties", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = Known<'a>;

    fn new(_: &Options) -> Self {
        PreferImportMetaProperties
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Known<'a> {
        if file.mentions_any(&["dirname", "fileURLToPath"]) {
            on.exprs([ExprTag::ImportMeta], check);
        }
        Known::default()
    }
}

fn check<'a>(_: &PreferImportMetaProperties, meta: Expr<'a>, cx: Context<'_, 'a>) {
    let Some(Node::Expr(member)) = parent_node(meta) else {
        return;
    };
    let ExprKind::Dot { name, chain: Chain::No, .. } = member.kind() else {
        return;
    };
    if name.name().is("filename") {
        iterate_problems_from_filename(member, false, cx);
        return;
    }
    let Some(Node::Expr(parent)) = parent_node(member).filter(|_| name.name().is("url")) else {
        return;
    };
    match parent.kind() {
        // `fileURLToPath(import.meta.url)`
        ExprKind::Call(call) => {
            if call.args().first() == Some(member)
                && is_node_builtin_module_function_call(parent, Function::FileUrlToPath, &mut cx.state)
            {
                iterate_problems_from_filename(parent, true, cx);
            }
        }
        ExprKind::New(new_url) => {
            let (callee, args) = (new_url.callee(), new_url.args());
            if !callee.is_ident("URL") || callee.is_parenthesized() || callee.symbol().is_some() {
                return;
            }
            let Some(url_parent) = call_with_first_argument(parent) else {
                return;
            };
            if !is_node_builtin_module_function_call(url_parent, Function::FileUrlToPath, &mut cx.state) {
                return;
            }
            match (args.len(), args.first()) {
                // `fileURLToPath(new URL(import.meta.url))`
                (1, Some(first)) if first == member => iterate_problems_from_filename(url_parent, true, cx),
                // `fileURLToPath(new URL(".", import.meta.url))`
                (2, Some(first))
                    if args.get(1) == Some(member)
                        && !first.is_parenthesized()
                        && first.as_string().is_some_and(|it| it.is_any(&[".", "./"])) =>
                {
                    report_dirname(url_parent, cx);
                }
                _ => {}
            }
        }
        _ => {}
    }
}
