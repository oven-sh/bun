use crate::bun::{chain_start, is_listed, list_option};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::is_global_reference;
use smallvec::{SmallVec, smallvec};

/// Disallow statements outside functions that call something or assign to a property: importing the module then acts.
///
/// Not `module.exports` and `exports`, which are how a CommonJS module exports: see "Modules: CommonJS modules" in the
/// documentation of Node.js. By default `allow` has what declares tests, hooks and mocks in `bun:test`, Jest, Vitest,
/// Mocha and `node:test`.
pub struct NoSideEffectsOnImport {
    allow: Box<[Box<[u8]>]>,
}

const CALL: Message = Message::new(
    "call",
    "This runs whenever the module is imported. Export a function that does it, for the importer to call.",
);
const ASSIGNMENT: Message = Message::new(
    "assignment",
    "This changes an object whenever the module is imported. Export a function that does it, for the importer to call.",
);

const TEST_FUNCTIONS: [&str; 14] = [
    "after", "afterAll", "afterEach", "before", "beforeAll", "beforeEach", "describe", "expect", "it", "jest", "mock", "suite",
    "test", "vi",
];

fn is_member(e: Expr) -> bool {
    matches!(e.tag(), ExprTag::Dot | ExprTag::Index)
}

/// `module.exports`, `exports.a`: how a CommonJS module exports.
fn is_commonjs_export(target: Expr) -> bool {
    let start = chain_start(target);
    start.as_ident().is_some_and(|it| it.is_any(&["module", "exports"])) && is_global_reference(start)
}

impl NoSideEffectsOnImport {
    /// `a.b` allows `a.b()`. `a` also allows all that starts with it: `a.b()`, `a.b()()`.
    fn allows(&self, callee: Expr) -> bool {
        is_listed(&self.allow, callee.text()) || is_listed(&self.allow, chain_start(callee).text())
    }

    /// The first part of `e` that does something, and what to say about it.
    fn effect_in<'a>(&self, e: Expr<'a>) -> Option<(Expr<'a>, Message)> {
        use UnOp::{Delete, PostDec, PostInc, PreDec, PreInc};
        // The next is the last.
        let mut pending: SmallVec<[Expr<'a>; 8]> = smallvec![e];
        while let Some(e) = pending.pop() {
            match e.skip_type_wrappers().kind() {
                // `require()` is what `import` is.
                ExprKind::Call(call) if call.callee().is_ident("require") || self.allows(call.callee()) => {}
                ExprKind::Call(_) | ExprKind::New(_) | ExprKind::TaggedTemplate(_) | ExprKind::ImportCall { .. } => {
                    return Some((e, CALL));
                }
                ExprKind::Assign { target, value, .. } => match is_member(target) && !is_commonjs_export(target) {
                    true => return Some((e, ASSIGNMENT)),
                    false => pending.push(value),
                },
                ExprKind::Unary { op: Delete | PreInc | PreDec | PostInc | PostDec, operand } if is_member(operand) => {
                    return Some((e, ASSIGNMENT));
                }
                ExprKind::Unary { operand, .. } | ExprKind::Await(operand) => pending.push(operand),
                ExprKind::Binary { left, right, .. } => pending.extend([right, left]),
                ExprKind::Cond { test, yes, no } => pending.extend([no, yes, test]),
                _ => {}
            }
        }
        None
    }
}

impl Rule for NoSideEffectsOnImport {
    const META: Meta = Meta::plugin(Plugin::Bun, "no-side-effects-on-import", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoSideEffectsOnImport { allow: list_option(options, "allow", &TEST_FUNCTIONS) }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Expr], |rule, statement, cx| {
            if let StmtKind::Expr(e) = statement.kind()
                && Node::Stmt(statement).enclosing_function().is_none()
                && let Some((effect, message)) = rule.effect_in(e)
            {
                cx.report(effect, message);
            }
        });
    }
}
