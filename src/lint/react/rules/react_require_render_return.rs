use bun_lint_oxlint::ast_util::{
    as_function, as_method_definition, as_object_property, as_property_definition, static_name,
};
use crate::react::{is_es5_component, is_es6_component, is_jsx};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;

/// Require render methods in ES5 and ES2015 React components to return a value.
pub struct RequireRenderReturn;

const REQUIRE_RENDER_RETURN: Message = Message::new("", "Your `render` method should have a `return` statement.");

impl Rule for RequireRenderReturn {
    const META: Meta = Meta::oxlint(Plugin::React, "require-render-return", Kind::Problem);
    const ON: On = On::new().funcs();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        RequireRenderReturn
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !is_jsx(file) || !file.mentions("render") {
            return None;
        }
        Some(())
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if as_function(Node::Func(func)).is_none() {
            return;
        }
        // The method or the property that the function is the value of.
        let parent = match func.owner() {
            Node::Expr(e) if !e.is_parenthesized() => e.parent(),
            owner => owner,
        };
        let (key, is_in_component) = match parent {
            Node::Member(member)
                if as_method_definition(parent).or_else(|| as_property_definition(parent)).is_some() =>
            {
                (member.key(), is_es6_component(member.parent()))
            }
            Node::Prop(property) if as_object_property(parent).is_some() => {
                let is_in_es5_component =
                    matches!(property.parent(), Node::Expr(object)
                        if !object.is_parenthesized() && is_es5_component(object.parent()));
                (property.key(), is_in_es5_component)
            }
            _ => return,
        };
        if let Some(key) = key.filter(|key| static_name(*key).is_some_and(|name| name.is("render")))
            && is_in_component
            && !contains_return_statement(func)
        {
            cx.report(key.inner_span(cx.file()), REQUIRE_RENDER_RETURN);
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Jump<'a> {
    Break(Option<Name<'a>>),
    Continue(Option<Name<'a>>),
}

/// Statements that are nested more deeply are not looked into.
const MAX_DEPTH: u32 = 256;

/// The way through a function that oxlint takes in its control flow graph: it does not go into a `catch` or a
/// `finally`, nor past a `try` with a `finally`, and it goes on after every `while` and `for`.
#[derive(Default)]
struct Walk<'a> {
    /// It got to a `return` with a value.
    found: bool,
    /// The `break` and `continue` that it got to and whose statement it is still in.
    jumps: SmallVec<[Jump<'a>; 4]>,
    depth: u32,
}

fn contains_return_statement(func: Func) -> bool {
    match func.body() {
        FnBody::Block(statements) => {
            let mut walk = Walk::default();
            walk.list(statements);
            walk.found
        }
        FnBody::Expr(_) => true,
        FnBody::None => false,
    }
}

impl<'a> Walk<'a> {
    /// Whether it gets to the end.
    fn list(&mut self, statements: List<'a, Stmt<'a>>) -> bool {
        statements.iter().all(|it| self.statement(it))
    }

    /// Takes the jumps after the first `from` for which `is_for_it` holds out, and tells whether there were any.
    fn take_jumps(&mut self, from: usize, is_for_it: impl Fn(Jump<'a>) -> bool) -> bool {
        let before = self.jumps.len();
        let others: SmallVec<[Jump<'a>; 4]> =
            self.jumps.drain(from.min(before)..).filter(|it| !is_for_it(*it)).collect();
        self.jumps.extend(others);
        self.jumps.len() < before
    }

    /// Whether it gets to the end of the statement.
    fn statement(&mut self, statement: Stmt<'a>) -> bool {
        if self.found {
            return false;
        }
        // It is taken to return something.
        if self.depth == MAX_DEPTH {
            self.found = true;
            return false;
        }
        self.depth += 1;
        let from = self.jumps.len();
        let is_of_loop = |jump: Jump| matches!(jump, Jump::Break(None) | Jump::Continue(None));
        let completes = match statement.kind() {
            StmtKind::Return(Some(_)) => {
                self.found = true;
                false
            }
            StmtKind::Return(None) | StmtKind::Throw(_) => false,
            StmtKind::Break(label) => {
                self.jumps.push(Jump::Break(label));
                false
            }
            StmtKind::Continue(label) => {
                self.jumps.push(Jump::Continue(label));
                false
            }
            StmtKind::Block(statements) => self.list(statements),
            StmtKind::With { body, .. } => self.statement(body),
            StmtKind::If { .. } => {
                // `else if` is not nested.
                let (mut at, mut completes) = (statement, false);
                loop {
                    let StmtKind::If { yes, no, .. } = at.kind() else {
                        break completes | self.statement(at);
                    };
                    completes |= self.statement(yes);
                    match no {
                        Some(no) => at = no,
                        None => break true,
                    }
                }
            }
            StmtKind::While { body, .. }
            | StmtKind::For { body, .. }
            | StmtKind::ForIn { body, .. }
            | StmtKind::ForOf { body, .. } => {
                self.statement(body);
                self.take_jumps(from, is_of_loop);
                true
            }
            StmtKind::DoWhile { body, .. } => self.statement(body) | self.take_jumps(from, is_of_loop),
            StmtKind::Labeled { label, body } => {
                self.statement(body)
                    | self.take_jumps(
                        from,
                        |jump| matches!(jump, Jump::Break(Some(to)) | Jump::Continue(Some(to)) if to == label),
                    )
            }
            StmtKind::Switch { cases, .. } => {
                let (mut has_default, mut last_completes) = (false, true);
                for case in cases {
                    has_default |= case.is_default();
                    last_completes = self.list(case.body());
                }
                self.take_jumps(from, |jump| jump == Jump::Break(None)) | last_completes | !has_default
            }
            StmtKind::Try { block, finalizer, .. } => self.statement(block) & finalizer.is_none(),
            _ => true,
        };
        self.depth -= 1;
        completes
    }
}
