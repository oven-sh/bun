use bun_lint::prelude::*;
use bun_lint::semantic::DeclarationKinds;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

/// Disallow declarations in the global scope.
pub struct NoImplicitGlobals {
    lexical_bindings: bool,
}

const GLOBAL_NON_LEXICAL_BINDING: Message = Message::new(
    "globalNonLexicalBinding",
    "Unexpected {{kind}} declaration in the global scope, wrap in an IIFE for a local variable, assign as global property for a global variable.",
);
const GLOBAL_LEXICAL_BINDING: Message = Message::new(
    "globalLexicalBinding",
    "Unexpected {{kind}} declaration in the global scope, wrap in a block or in an IIFE.",
);
const GLOBAL_VARIABLE_LEAK: Message = Message::new(
    "globalVariableLeak",
    "Global variable leak, declare the variable if it is intended to be local.",
);
const ASSIGNMENT_TO_READONLY_GLOBAL: Message = Message::new(
    "assignmentToReadonlyGlobal",
    "Unexpected assignment to read-only global variable.",
);
const REDECLARATION_OF_READONLY_GLOBAL: Message = Message::new(
    "redeclarationOfReadonlyGlobal",
    "Unexpected redeclaration of read-only global variable.",
);

/// The assignment, the `for`-`in` or the `for`-`of` that writes to `reference`.
fn assignment_of(reference: Reference<'_>) -> Span {
    let mut ancestors = reference.node().ancestors();
    let assignment = ancestors.find_map(|it| match it {
        Node::Expr(e) if e.tag() == ExprTag::Assign && !utils::is_assignment_target(e) => Some(e.span()),
        Node::Stmt(s) if matches!(s.tag(), StmtTag::ForIn | StmtTag::ForOf) => Some(s.span()),
        _ => None,
    });
    assignment.unwrap_or_else(|| reference.span())
}

/// What oxlint takes the global variable `name` for: it reads no comments and knows no library of TypeScript.
fn oxlint_global<'a>(file: &'a File<'a>, name: Name<'a>) -> Option<Global> {
    file.global_named(name).filter(|it| !it.is_only_in_lib)?.implicit_setting
}

/// Which scopes are strict for oxc, in a file that is no module.
#[derive(Default)]
struct StrictScopes<'a>(FxHashMap<Scope<'a>, bool>);

impl<'a> StrictScopes<'a> {
    fn has(&mut self, scope: Scope<'a>) -> bool {
        let mut passed: SmallVec<[Scope<'a>; 8]> = SmallVec::new();
        let mut answer = false;
        for scope in scope.chain() {
            if let Some(&known) = self.0.get(&scope) {
                answer = known;
                break;
            }
            passed.push(scope);
            if utils::oxlint::makes_strict(scope) {
                answer = true;
                break;
            }
        }
        self.0.extend(passed.into_iter().map(|it| (it, answer)));
        answer
    }
}

/// In sloppy JavaScript a plain function that is declared in a block is a variable of the function or the file around it as well
/// (Annex B.3.2.1): oxc moves it there, unless something before it has the name there.
#[derive(Default)]
struct Moved<'a> {
    /// What the blocks declare, each with the scope that oxc has it in.
    symbols: Vec<(Scope<'a>, Symbol<'a>)>,
    names: FxHashSet<(Scope<'a>, Name<'a>)>,
    /// For each name the outermost of these scopes, in the order they start.
    outermost: FxHashMap<Name<'a>, Vec<Scope<'a>>>,
}

impl<'a> Moved<'a> {
    fn new(file: &'a File<'a>, strict: &mut StrictScopes<'a>) -> Moved<'a> {
        let functions = file.symbols_declared_as(DeclarationKinds::FUNCTION_NAME);
        let mut in_blocks: Vec<(u32, Symbol<'a>)> = functions
            .filter_map(|symbol| {
                let Some(Declaration::Fn(func)) = symbol.declarations().next() else {
                    return None;
                };
                let is_plain = func.kind() == FnKind::Decl && !func.is_async() && !func.is_generator();
                let (scope, start) = (symbol.scope(), func.name()?.span().start);
                (is_plain && scope != scope.variable_scope()).then_some((start, symbol))
            })
            .collect();
        utils::sort::sort_unstable_by_key(&mut in_blocks, |it| it.0);
        let mut moved = Moved::default();
        for (start, symbol) in in_blocks {
            let (scope, name) = (symbol.scope(), symbol.name());
            let to = scope.variable_scope();
            let is_before = |it: Declaration<'a>| it.name_span().is_some_and(|it| it.start < start);
            if !strict.has(scope)
                && !moved.names.contains(&(to, name))
                && !to.get_name(name).is_some_and(|it| it.declarations().any(is_before))
            {
                moved.names.insert((to, name));
                moved.symbols.push((to, symbol));
                moved.outermost.entry(name).or_default().push(to);
            }
        }
        for scopes in moved.outermost.values_mut() {
            utils::sort::sort_unstable_by_key(scopes, |it| it.span().start);
            let mut last: Option<Scope<'a>> = None;
            scopes.retain(|&it| {
                let is_outermost = !last.is_some_and(|last| last.contains(it));
                if is_outermost {
                    last = Some(it);
                }
                is_outermost
            });
        }
        moved
    }

    /// For oxc `reference`, which refers to nothing, refers to one of them.
    fn has(&self, reference: Reference<'a>) -> bool {
        let Some(scopes) = self.outermost.get(&reference.name()) else {
            return false;
        };
        let after = scopes.partition_point(|it| it.span().start <= reference.span().start);
        let around = after.checked_sub(1).and_then(|it| scopes.get(it));
        around.is_some_and(|it| it.contains(reference.scope()))
    }
}

const VAR: (&str, bool) = ("'var'", false);

/// What oxlint calls a declaration, and whether it is lexical. `None` for one that it does not look at.
fn oxlint_kind(declaration: Declaration<'_>) -> Option<(&'static str, bool)> {
    Some(match declaration {
        Declaration::Fn(_) => ("function", false),
        Declaration::Class(_) => ("class", true),
        Declaration::Var(_) => match declaration.node()? {
            Node::VarDecl(declarator) => match declarator.var_kind() {
                VarKind::Var => VAR,
                VarKind::Let => ("'let'", true),
                VarKind::Const | VarKind::Using | VarKind::AwaitUsing => ("'const'", true),
            },
            _ => return None,
        },
        _ => return None,
    })
}

impl NoImplicitGlobals {
    fn report_as_oxlint<'a>(
        &self,
        name: Span,
        (kind, is_lexical): (&'static str, bool),
        global: Option<Global>,
        cx: &Cx<'a, Self>,
    ) {
        if is_lexical && !self.lexical_bindings {
            return;
        }
        match global {
            Some(Global::Readonly) => cx.report(name, REDECLARATION_OF_READONLY_GLOBAL),
            _ if is_lexical => cx.report(name, GLOBAL_LEXICAL_BINDING).data("kind", kind),
            _ => cx.report(name, GLOBAL_NON_LEXICAL_BINDING).data("kind", kind),
        };
    }

    /// The declarations of a script. The scope of a module stands for the one scope that oxc has for a file.
    fn check_declarations_as_oxlint<'a>(&self, moved: &Moved<'a>, cx: &Cx<'a, Self>) {
        let file = cx.file();
        let top = file.top_level_scope();
        for &(_, symbol) in moved.symbols.iter().filter(|it| it.0 == top) {
            let global = oxlint_global(file, symbol.name());
            if global != Some(Global::Writable) {
                for name in symbol.declarations().filter_map(Declaration::name_span) {
                    self.report_as_oxlint(name, ("function", false), global, cx);
                }
            }
        }
        let mut catch_parameters: FxHashMap<Name<'a>, Vec<Symbol<'a>>> = FxHashMap::default();
        for parameter in file.symbols_declared_as(DeclarationKinds::CATCH_CLAUSE) {
            catch_parameters.entry(parameter.name()).or_default().push(parameter);
        }
        for symbol in top.symbols() {
            let name = symbol.name();
            let global = oxlint_global(file, name);
            if global == Some(Global::Writable) {
                continue;
            }
            // oxc takes a `var` in a `catch` that has a parameter of its name for a declaration of the parameter, which it moves
            // to the scope of the file if nothing has the name there yet.
            let (mut is_bound, mut moved_parameter) = (moved.names.contains(&(top, name)), None);
            // The parameters of the name, in the order of the clauses, and those of them whose clause has begun.
            let mut parameters = catch_parameters.get(&name).into_iter().flatten().peekable();
            let mut around: Vec<Symbol<'a>> = Vec::new();
            for declaration in symbol.declarations() {
                let (kind, Some(place)) = (oxlint_kind(declaration), declaration.name_span()) else {
                    continue;
                };
                around.extend(std::iter::from_fn(|| parameters.next_if(|it| it.scope().span().start <= place.start)));
                while around.last().is_some_and(|it| it.scope().span().end <= place.start) {
                    around.pop();
                }
                let parameter = around.last().filter(|_| kind == Some(VAR));
                if let Some(parameter) = parameter.and_then(|it| it.declarations().next()?.name_span())
                    && moved_parameter != Some(parameter)
                {
                    if is_bound {
                        continue;
                    }
                    moved_parameter = Some(parameter);
                    self.report_as_oxlint(parameter, VAR, global, cx);
                }
                is_bound = true;
                if let Some(kind) = kind {
                    self.report_as_oxlint(place, kind, global, cx);
                }
            }
        }
    }

    /// oxlint goes by what it takes the file for: the declarations count in a script, a leak also in CommonJS. It reports the
    /// name of a declaration, and `/* exported */` means nothing to it.
    fn check_as_oxlint<'a>(&self, cx: &Cx<'a, Self>) {
        let file = cx.file();
        let source_type = utils::oxlint::source_type(file);
        let mut strict = StrictScopes::default();
        let moved = match source_type != SourceType::Module && file.is_javascript() {
            true => Moved::new(file, &mut strict),
            false => Moved::default(),
        };
        if source_type == SourceType::Script {
            self.check_declarations_as_oxlint(&moved, cx);
        }
        // Where a target has a default value there are two references, as in ESLint. oxc has one.
        let mut previous = None;
        for reference in file.unresolved_references() {
            let place = Some(reference.span());
            if !reference.is_write_only() || reference.is_init() || previous == place {
                continue;
            }
            previous = place;
            match oxlint_global(file, reference.name()) {
                Some(Global::Writable) => {}
                _ if moved.has(reference) => {}
                Some(Global::Readonly) => {
                    cx.report(assignment_of(reference), ASSIGNMENT_TO_READONLY_GLOBAL);
                }
                _ => {
                    if source_type != SourceType::Module && !strict.has(reference.scope()) {
                        cx.report(assignment_of(reference), GLOBAL_VARIABLE_LEAK);
                    }
                }
            }
        }
    }

    fn check_declarations<'a>(&self, cx: &Cx<'a, Self>) {
        let file = cx.file();
        for symbol in file.scope().symbols() {
            let name = symbol.name().bytes();
            let global = file.global(name);
            if global.is_some_and(|it| it.is_writable) || file.is_exported_in_comments(name) {
                continue;
            }
            for declaration in symbol.declarations() {
                let (span, kind, is_lexical) = match declaration {
                    Declaration::Fn(func) => (func.estree_span(), "function", false),
                    Declaration::Class(class) => (class.estree_span(), "class", true),
                    Declaration::Var(_) => {
                        let Some(Node::VarDecl(declarator)) = declaration.node() else {
                            continue;
                        };
                        match declarator.var_kind() {
                            VarKind::Var => (declarator.span(), "'var'", false),
                            VarKind::Let => (declarator.span(), "'let'", true),
                            VarKind::Const => (declarator.span(), "'const'", true),
                            VarKind::Using | VarKind::AwaitUsing => continue,
                        }
                    }
                    _ => continue,
                };
                if is_lexical && !self.lexical_bindings {
                    continue;
                }
                if global.is_some() {
                    cx.report(span, REDECLARATION_OF_READONLY_GLOBAL);
                } else if is_lexical {
                    cx.report(span, GLOBAL_LEXICAL_BINDING).data("kind", kind);
                } else {
                    cx.report(span, GLOBAL_NON_LEXICAL_BINDING).data("kind", kind);
                }
            }
        }
    }

    fn check_assignments<'a>(&self, cx: &Cx<'a, Self>) {
        let file = cx.file();
        for reference in file.unresolved_references() {
            if !reference.is_write_only() {
                continue;
            }
            match reference.global() {
                Some(global) if global.is_writable || global.is_exported => {}
                Some(_) => {
                    cx.report(assignment_of(reference), ASSIGNMENT_TO_READONLY_GLOBAL);
                }
                None => {
                    if !reference.is_init()
                        && !reference.scope().is_strict()
                        && file.global(reference.name().bytes()).is_none()
                    {
                        cx.report(assignment_of(reference), GLOBAL_VARIABLE_LEAK);
                    }
                }
            }
        }
    }
}

impl Rule for NoImplicitGlobals {
    const META: Meta = Meta::eslint("no-implicit-globals", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoImplicitGlobals {
            lexical_bindings: options.object(0).bool_or("lexicalBindings", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(|rule, cx| {
            if cx.language().is_oxlint {
                return rule.check_as_oxlint(cx);
            }
            rule.check_declarations(cx);
            rule.check_assignments(cx);
        });
    }
}
