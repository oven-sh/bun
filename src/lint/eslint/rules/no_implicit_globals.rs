use bun_lint::prelude::*;
use rustc_hash::FxHashSet;

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

impl NoImplicitGlobals {
    fn check_declarations<'a>(&self, cx: &Cx<'a, Self>) {
        let file = cx.file();
        let exported = file.exported_in_comments();
        // Instead of the list, if that is long.
        let mut exported_names: FxHashSet<&[u8]> = FxHashSet::default();
        if exported.len() > 8 {
            exported_names.extend(exported.iter().map(|it| &**it));
        }
        let is_exported = |name: &[u8]| match exported_names.is_empty() {
            true => exported.iter().any(|it| **it == *name),
            false => exported_names.contains(name),
        };
        for symbol in file.scope().symbols() {
            let name = symbol.name().bytes();
            let global = file.global(name);
            if global.is_some_and(|it| it.is_writable) || is_exported(name) {
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
            rule.check_declarations(cx);
            rule.check_assignments(cx);
        });
    }
}
