use bun_lint::prelude::*;
use bun_lint::semantic::DeclarationKinds;
use std::cell::OnceCell;

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

/// Returns the assignment, `for`-`in` or `for`-`of` that writes to `reference`.
fn assignment_of(reference: Reference<'_>) -> Span {
    let mut ancestors = reference.node().ancestors();
    let assignment = ancestors.find_map(|it| match it {
        Node::Expr(e) if e.tag() == ExprTag::Assign && !utils::is_assignment_target(e) => Some(e.span()),
        Node::Stmt(s) if matches!(s.tag(), StmtTag::ForIn | StmtTag::ForOf) => Some(s.span()),
        _ => None,
    });
    assignment.unwrap_or_else(|| reference.span())
}

/// Returns oxlint's setting for the global variable `name`. oxlint doesn't read comments or know TypeScript's
/// libraries.
fn oxlint_global<'a>(file: &'a File<'a>, name: Name<'a>) -> Option<Global> {
    file.global_named(name).filter(|it| !it.is_only_in_lib)?.implicit_setting
}

/// Tracks which scopes are strict for oxc, in a file that isn't a module. Computed on the first lookup.
struct StrictScopes<'a> {
    file: &'a File<'a>,
    /// In the order of [`File::scopes`], where a scope comes after its parent.
    scopes: OnceCell<Vec<bool>>,
}

impl<'a> StrictScopes<'a> {
    #[inline(never)]
    fn has(&self, scope: Scope<'a>) -> bool {
        let scopes = self.scopes.get_or_init(|| {
            let mut strict: Vec<bool> = Vec::with_capacity(self.file.scopes().len());
            for scope in self.file.scopes() {
                let is_in_strict = scope.parent().and_then(|it| strict.get(it.id().idx()).copied());
                strict.push(is_in_strict == Some(true) || utils::oxlint::makes_strict(scope));
            }
            strict
        });
        scopes.get(scope.id().idx()).copied().unwrap_or(false)
    }
}

/// In sloppy JavaScript, a plain function declared in a block is also a variable of the enclosing function or file
/// (Annex B.3.2.1). oxc moves it there, unless something before it already has that name there.
#[derive(Copy, Clone)]
struct HoistedFunction<'a> {
    symbol: Symbol<'a>,
    /// The start of its name.
    start: u32,
    /// The scope that oxc puts it in.
    to: Scope<'a>,
    /// The outermost scope that is `to` or encloses it, and in which oxc has a function with that name.
    outermost_scope: Scope<'a>,
}

impl<'a> HoistedFunction<'a> {
    /// Only used to group entries with the same name. The order of the names means nothing.
    fn key(&self) -> (u32, u32) {
        (self.symbol.name().atom().0, self.to.span().start)
    }

    /// Returns all of them, sorted by [`HoistedFunction::key`].
    #[inline(never)]
    fn all_in(file: &'a File<'a>, strict: &StrictScopes<'a>) -> Vec<HoistedFunction<'a>> {
        let mut hoisted: Vec<HoistedFunction<'a>> = Vec::new();
        for symbol in file.symbols_declared_as(DeclarationKinds::FUNCTION_NAME) {
            let (scope, Some(Declaration::Fn(func))) = (symbol.scope(), symbol.declarations().next()) else {
                continue;
            };
            let to = scope.variable_scope();
            if let Some(name) = func.name()
                && to != scope
                && func.kind() == FnKind::Decl
                && !func.is_async()
                && !func.is_generator()
            {
                hoisted.push(HoistedFunction { symbol, start: name.span().start, to, outermost_scope: to });
            }
        }
        utils::sort::sort_unstable_by_key(&mut hoisted, |it| (it.key(), it.to.id(), it.start));
        let mut last: Option<HoistedFunction<'a>> = None;
        hoisted.retain_mut(|it| {
            let (name, start) = (it.symbol.name(), it.start);
            let last_of_name = last.filter(|last| last.symbol.name() == name);
            let is_before = |other: Declaration<'a>| other.name_span().is_some_and(|other| other.start < start);
            if last_of_name.is_some_and(|last| last.to == it.to)
                || strict.has(it.symbol.scope())
                || it.to.get_name(name).is_some_and(|there| there.declarations().any(is_before))
            {
                return false;
            }
            if let Some(last) = last_of_name.filter(|last| last.outermost_scope.contains(it.to)) {
                it.outermost_scope = last.outermost_scope;
            }
            last = Some(*it);
            true
        });
        hoisted
    }

    /// True if, for oxc, the unresolved `reference` refers to one of `hoisted`.
    fn resolves_reference(hoisted: &[HoistedFunction<'a>], reference: Reference<'a>) -> bool {
        let (name, start) = (reference.name(), reference.span().start);
        let after = hoisted.partition_point(|it| it.key() <= (name.atom().0, start));
        let before = after.checked_sub(1).and_then(|it| hoisted.get(it));
        before.is_some_and(|it| it.symbol.name() == name && it.outermost_scope.contains(reference.scope()))
    }
}

/// Returns a declaration's kind for the message, whether it's lexical, and its whole span. `None` if it isn't checked.
fn kind_of(declaration: Declaration<'_>, is_oxlint: bool) -> Option<(&'static str, bool, Span)> {
    Some(match declaration {
        Declaration::Fn(func) => ("function", false, func.estree_span()),
        Declaration::Class(class) => ("class", true, class.estree_span()),
        Declaration::Var(_) => {
            let Node::VarDecl(declarator) = declaration.node()? else {
                return None;
            };
            let (kind, is_lexical) = match declarator.var_kind() {
                VarKind::Var => ("'var'", false),
                VarKind::Let => ("'let'", true),
                VarKind::Const => ("'const'", true),
                VarKind::Using | VarKind::AwaitUsing if is_oxlint => ("'const'", true),
                VarKind::Using | VarKind::AwaitUsing => return None,
            };
            (kind, is_lexical, declarator.span())
        }
        _ => return None,
    })
}

impl NoImplicitGlobals {
    /// Checks the declarations of a global symbol. oxlint reports at the names, and ignores `/* exported */`.
    #[inline(never)]
    fn check_symbol<'a>(&self, symbol: Symbol<'a>, cx: &Cx<'a, Self>) {
        let (file, name) = (cx.file(), symbol.name());
        let is_oxlint = file.language().is_oxlint;
        let is_readonly = if is_oxlint {
            match oxlint_global(file, name) {
                Some(Global::Writable) => return,
                global => global == Some(Global::Readonly),
            }
        } else {
            let global = file.global(name.bytes());
            if global.is_some_and(|it| it.is_writable) || file.is_exported_in_comments(name.bytes()) {
                return;
            }
            global.is_some()
        };
        for declaration in symbol.declarations() {
            let Some((kind, is_lexical, whole)) = kind_of(declaration, is_oxlint) else {
                continue;
            };
            let report_span = if is_oxlint { declaration.name_span() } else { Some(whole) };
            let Some(report_span) = report_span.filter(|_| !is_lexical || self.lexical_bindings) else {
                continue;
            };
            if is_readonly {
                cx.report(report_span, REDECLARATION_OF_READONLY_GLOBAL);
                continue;
            }
            let message = if is_lexical { GLOBAL_LEXICAL_BINDING } else { GLOBAL_NON_LEXICAL_BINDING };
            cx.report(report_span, message).data("kind", kind);
        }
    }

    /// oxlint goes by its own source type for the file. Declarations count in a script, where the module scope here
    /// corresponds to oxc's single file scope. A leak also counts in CommonJS.
    fn check<'a>(&self, cx: &Cx<'a, Self>) {
        let file = cx.file();
        let for_oxlint = file.language().is_oxlint.then(|| utils::oxlint::source_type(file));
        let strict = StrictScopes { file, scopes: OnceCell::new() };
        let hoisted = match for_oxlint {
            Some(SourceType::Script | SourceType::CommonJs) if file.is_javascript() => HoistedFunction::all_in(file, &strict),
            _ => Vec::new(),
        };
        let global_scope = match for_oxlint {
            None => Some(file.scope()),
            Some(SourceType::Script) => Some(file.top_level_scope()),
            Some(_) => None,
        };
        for symbol in global_scope.into_iter().flat_map(Scope::symbols) {
            self.check_symbol(symbol, cx);
        }
        for it in hoisted.iter().filter(|it| Some(it.to) == global_scope) {
            self.check_symbol(it.symbol, cx);
        }
        // A target with a default value has two references, as in ESLint. oxc has one.
        let mut previous = None;
        for reference in file.unresolved_references().filter(|it| it.is_write_only()) {
            let is_leak = match for_oxlint {
                None => match reference.global() {
                    Some(global) if global.is_writable || global.is_exported => continue,
                    Some(_) => false,
                    None if reference.is_init() || reference.scope().is_strict() => continue,
                    None if file.global(reference.name().bytes()).is_some() => continue,
                    None => true,
                },
                Some(_) if reference.is_init() || previous.replace(reference.span()) == Some(reference.span()) => {
                    continue;
                }
                Some(source_type) => match oxlint_global(file, reference.name()) {
                    Some(Global::Writable) => continue,
                    _ if HoistedFunction::resolves_reference(&hoisted, reference) => continue,
                    Some(Global::Readonly) => false,
                    _ if source_type == SourceType::Module || strict.has(reference.scope()) => continue,
                    _ => true,
                },
            };
            let message = if is_leak { GLOBAL_VARIABLE_LEAK } else { ASSIGNMENT_TO_READONLY_GLOBAL };
            cx.report(assignment_of(reference), message);
        }
    }
}

impl Rule for NoImplicitGlobals {
    const META: Meta = Meta::eslint("no-implicit-globals", Kind::Suggestion);
    const ON: On = On::new().finish();
    no_state!();

    fn new(options: &Options) -> Self {
        NoImplicitGlobals {
            lexical_bindings: options.object(0).bool_or("lexicalBindings", false),
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        self.check(cx);
    }
}
