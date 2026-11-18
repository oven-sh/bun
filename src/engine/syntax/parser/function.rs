//! Functions.

use super::context::{is_eval_or_arguments, is_reserved_in_strict_code};
use super::pattern::Binder;
use super::{
    Class, Context, Expression, Facts, Failed, In, Parsed, PauseKind, Session, Statement, nothing,
};
use crate::ast::{
    ExprKind, Function, FunctionId, List, PatternElement, PatternElementId, PropertyKey, ScopeId,
    ScopeKind, StmtId, StmtKind, Tree, TreeId,
};
use crate::cache::{Summary, Traits};
use crate::names::Name;
use crate::options::{FunctionFlags, FunctionKind};
use crate::scope::{self, Closed, Recall};
use crate::token::TokenKind;

/// What is put aside while a function is parsed.
#[derive(Clone, Copy)]
pub(super) struct Outer {
    context: Context,
    assignments: u32,
    facts: Facts,
    first_label: u32,
    duplicate_parameter: Option<Name>,
    recall: Recall,
    scopes: scope::Mark,
}

pub(super) enum Begun {
    Skipped(u32, Summary),
    /// At the brace, or at the arrow.
    Open(Open),
}

pub(super) struct Open {
    outer: Outer,
    kind: FunctionKind,
    flags: FunctionFlags,
    own_name: Option<Name>,
    parameters_start: u32,
    length: u32,
    tree: Option<TreeId>,
}

#[derive(Clone, Copy)]
struct Finished {
    parameters_start: u32,
    summary: Summary,
    tree: Option<TreeId>,
}

/// How far an inner function is gone into.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Depth {
    Check,
    Build,
}

#[derive(Clone, Copy)]
pub(super) struct Method {
    pub(super) kind: FunctionKind,
    pub(super) flags: FunctionFlags,
    pub(super) start: u32,
    pub(super) key: PropertyKey,
}

pub(super) struct Parameters {
    pub(super) list: List<PatternElementId>,
    pub(super) length: u32,
}

/// Where a declaration stands.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Site {
    Ordinary,
    /// After a label or as a branch of `if`.
    SingleStatement,
    DefaultExport,
}

pub(super) fn describe(kind: FunctionKind, flags: FunctionFlags) -> &'static str {
    let is_async = flags.contains(FunctionFlags::ASYNC);
    match (kind, is_async, flags.contains(FunctionFlags::GENERATOR)) {
        (FunctionKind::Getter, ..) => "getter",
        (FunctionKind::Setter, ..) => "setter",
        (FunctionKind::Arrow, false, _) => "arrow function",
        (FunctionKind::Arrow, true, _) => "async arrow function",
        (FunctionKind::Normal, false, false) => "function",
        (FunctionKind::Normal, false, true) => "generator function",
        (FunctionKind::Normal, true, false) => "async function",
        (FunctionKind::Normal, true, true) => "async generator function",
        (_, false, false) => "method",
        (_, false, true) => "generator method",
        (_, true, false) => "async method",
        (_, true, true) => "async generator method",
    }
}

impl Session<'_> {
    pub(super) fn enter_function(
        &mut self,
        kind: FunctionKind,
        context: Context,
        start: u32,
        recall: Recall,
    ) -> Outer {
        let outer = Outer {
            context: self.context,
            assignments: self.assignments,
            facts: core::mem::replace(&mut self.facts, Facts::empty()),
            first_label: core::mem::replace(&mut self.first_label, self.scopes.label_count()),
            duplicate_parameter: self.duplicate_parameter.take(),
            recall: core::mem::replace(&mut self.scopes.recall, recall),
            scopes: self.scopes.mark(),
        };
        self.context = context;
        self.scopes.push_function(kind, start);
        outer
    }

    fn restore_outer(&mut self, outer: &Outer) {
        self.set_context(outer.context);
        self.assignments = outer.assignments;
        self.facts = outer.facts | self.facts & Facts::INHERITED;
        self.scopes.drop_labels(self.first_label);
        self.first_label = outer.first_label;
        self.duplicate_parameter = outer.duplicate_parameter;
        self.scopes.recall = outer.recall;
    }

    #[cold]
    #[inline(never)]
    pub(super) fn abandon_function(&mut self, outer: &Outer) -> Failed {
        self.facts = Facts::empty();
        self.restore_outer(outer);
        self.scopes.rewind(outer.scopes);
        Failed
    }

    /// `summary` lacks only what the scope and the facts say.
    #[inline(always)]
    fn leave_function(
        &mut self,
        outer: &Outer,
        start: u32,
        mut summary: Summary,
        closed: Closed,
    ) -> Summary {
        /// Anything shorter is parsed as fast as it is looked up.
        const SHORTEST_SKIPPED: u32 = 16;
        for (holds, found) in [
            (closed.contains_eval, Traits::CONTAINS_EVAL),
            (
                self.facts.contains(Facts::TAGGED_TEMPLATE),
                Traits::TAGGED_TEMPLATE,
            ),
            (
                self.facts.contains(Facts::PRIVATE_NAMES),
                Traits::PRIVATE_NAMES,
            ),
        ] {
            summary.traits.set(found, holds);
        }
        if self.scopes.recall == Recall::Records {
            if closed.has_closures
                || (outer.recall == Recall::Records && summary.end - start > SHORTEST_SKIPPED)
            {
                self.scopes.outline.add(start, summary);
            } else {
                self.scopes.forget_since(outer.scopes);
            }
        }
        self.scopes.leave_function();
        self.restore_outer(outer);
        summary
    }

    /// Code that runs in a function without being written as one, which `read` checks. `part` is that of the outline.
    /// Returns whether it uses its home object.
    #[inline(always)]
    pub(super) fn implicit_function(
        &mut self,
        kind: FunctionKind,
        context: Context,
        part: Traits,
        read: impl FnOnce(&mut Self) -> Parsed<()>,
    ) -> Parsed<bool> {
        let start = self.start();
        let summary = match self.skip_or_recall(part, Depth::Check) {
            Ok(summary) => summary,
            Err(recall) => {
                let outer = self.enter_function(kind, context, start, recall);
                if read(self).is_err() {
                    return Err(self.abandon_function(&outer));
                }
                self.leave_implicit_function(&outer, start, part)
            }
        };
        Ok(summary.flags.contains(FunctionFlags::USES_HOME) || self.options.capture_everything)
    }

    #[inline(never)]
    fn leave_implicit_function(&mut self, outer: &Outer, start: u32, traits: Traits) -> Summary {
        let closed = self.scopes.close_function::<false>(self.ast);
        let mut flags = FunctionFlags::STRICT;
        flags.set(
            FunctionFlags::USES_HOME,
            closed.captures_home || self.facts.contains(Facts::USES_SUPER_PROPERTY),
        );
        let summary = Summary {
            end: self.previous_end(),
            length: 0,
            flags,
            traits,
        };
        self.leave_function(outer, start, summary, closed)
    }

    /// Skips the function that starts here, or says what to do with the outline inside it.
    #[inline(always)]
    fn skip_or_recall(&mut self, part: Traits, depth: Depth) -> Result<Summary, Recall> {
        let recall = match self.scopes.recall {
            Recall::Replays => Recall::Replays,
            _ if !self.keeps_outline => Recall::Nothing,
            // The wrapper of a module, which is seldom parsed again.
            _ if depth == Depth::Build && !self.context.contains(Context::FUNCTION) => {
                Recall::Nothing
            }
            _ => Recall::Records,
        };
        if self.knows_functions
            && let Some(found) = self.scopes.outline.find(self.start(), part)
        {
            return self.skip(self.scopes.outline.summary(found), recall);
        }
        Err(recall)
    }

    #[inline(never)]
    fn skip(&mut self, summary: Summary, recall: Recall) -> Result<Summary, Recall> {
        if summary.traits.contains(Traits::TOLD) {
            if !self.has_captured_as_told {
                return Err(recall);
            }
        } else if recall != Recall::Replays {
            return Err(Recall::Nothing);
        }
        (self.scopes).note_closure(summary.traits.contains(Traits::CONTAINS_EVAL));
        if summary.traits.contains(Traits::TAGGED_TEMPLATE) {
            self.facts |= Facts::TAGGED_TEMPLATE;
        }
        if summary.traits.contains(Traits::PRIVATE_NAMES) {
            self.facts |= Facts::PRIVATE_NAMES;
        }
        self.note_skipped(summary.end);
        self.lexer.jump(summary.end);
        Ok(summary)
    }

    /// At the body of the function that is parsed, if it is the one with the functions that are `TOLD`.
    pub(super) fn capture_as_told(&mut self) {
        if !(self.start()..self.lexer.end()).contains(&self.scopes.outline.first_told) {
            return;
        }
        self.has_captured_as_told = true;
        for index in 0..self.scopes.outline.told_captures.len() {
            let told = self.scopes.outline.told_captures[index];
            let (start, end) = (told.start as usize, (told.start + told.length) as usize);
            let name = (self.lexer.names).intern_source(self.lexer.source, start, end);
            self.scopes.capture(name, told.may_be_assigned);
        }
    }

    /// At the parameters.
    #[inline(never)]
    pub(super) fn begin_function(
        &mut self,
        kind: FunctionKind,
        flags: FunctionFlags,
        own_name: Option<Name>,
        parameters_end: Option<u32>,
        depth: Depth,
    ) -> Parsed<Begun> {
        let parameters_start = self.start();
        let recall = match self.skip_or_recall(Traits::empty(), depth) {
            Ok(mut summary) => {
                summary.flags |= flags;
                return Ok(Begun::Skipped(parameters_start, summary));
            }
            Err(recall) => recall,
        };
        self.check_stack()?;
        let context = self.context.of_parameters(kind, flags);
        let outer = self.enter_function(kind, context, parameters_start, recall);
        let parameters = match depth {
            Depth::Check => self.parameters::<false>(kind, flags),
            Depth::Build => self.parameters::<true>(kind, flags),
        };
        let parameters = parameters.and_then(|parameters| {
            self.check_start_of_body(kind, flags, parameters_end)?;
            Ok(parameters)
        });
        match parameters {
            Ok(Parameters { list, length }) => Ok(Begun::Open(Open {
                outer,
                kind,
                flags,
                own_name,
                parameters_start,
                length,
                tree: (depth == Depth::Build).then(|| {
                    self.ast.push_tree(Tree {
                        start: parameters_start,
                        parameters: list,
                        ..Tree::default()
                    })
                }),
            })),
            Err(Failed) => Err(self.abandon_function(&outer)),
        }
    }

    #[inline(always)]
    fn check_start_of_body(
        &mut self,
        kind: FunctionKind,
        flags: FunctionFlags,
        parameters_end: Option<u32>,
    ) -> Parsed<()> {
        if kind == FunctionKind::Arrow {
            self.require(
                TokenKind::Arrow,
                "Expected a '=>' after arrow function parameter declaration",
            )?;
            if self.follows_newline() {
                return Err(self.unexpected());
            }
        } else if !self.at(TokenKind::OpenBrace) {
            let sentence = "Expected an opening '{' at the start of a % body";
            return Err(self.fail_saying(sentence, describe(kind, flags)));
        }
        if parameters_end.is_some_and(|end| end != self.previous_end()) {
            return Err(self.reject(
                "Parameters should match arguments offered as parameters in Function constructor",
            ));
        }
        Ok(())
    }

    #[inline(never)]
    fn finish_function(&mut self, begun: Begun, r#in: In) -> Parsed<Finished> {
        let mut open = match begun {
            Begun::Skipped(parameters_start, summary) => {
                return Ok(Finished {
                    parameters_start,
                    summary,
                    tree: None,
                });
            }
            Begun::Open(open) => open,
        };
        if self.inner_body(&mut open, r#in).is_err() {
            return Err(self.abandon_function(&open.outer));
        }
        let summary = self.close_inner_function(&open);
        if !summary.flags.contains(FunctionFlags::EXPRESSION_BODY) {
            self.next();
        }
        Ok(Finished {
            parameters_start: open.parameters_start,
            summary,
            tree: open.tree,
        })
    }

    /// For a function expression at `start`.
    #[inline(always)]
    pub(super) fn depth_for<const BUILD: bool>(&self, start: u32) -> Depth {
        /// The trees are all kept until the parse ends.
        const MOST_EXPRESSIONS_BEFORE: usize = 1 << 16;
        if BUILD
            && start == self.eager_start
            && self.ast.expression_count() < MOST_EXPRESSIONS_BEFORE
            && self.options.eager_functions
            && !self.options.capture_everything
            && self.pauses.is_none()
        {
            Depth::Build
        } else {
            Depth::Check
        }
    }

    /// Between the parameters and the body. Returns whether the body has a scope of its own.
    pub(super) fn begin_body(&mut self, own_name: Option<Name>, flags: FunctionFlags) -> bool {
        if let Some(name) = own_name
            && flags.contains(FunctionFlags::BINDS_OWN_NAME)
        {
            self.scopes.declare_callee(name);
        }
        let has_scope = self.facts.contains(Facts::PARAMETER_EXPRESSIONS);
        if has_scope {
            self.scopes.push(ScopeKind::FunctionBody, self.start());
        }
        has_scope
    }

    /// Up to the closing brace, or past the last token if there is none.
    #[inline(always)]
    fn inner_body(&mut self, open: &mut Open, r#in: In) -> Parsed<()> {
        self.context = open.outer.context.of_body(open.kind, open.flags);
        let has_scope = self.begin_body(open.own_name, open.flags);
        if open.kind == FunctionKind::Arrow {
            self.next();
        }
        let has_braces = self.at(TokenKind::OpenBrace);
        if let Some(tree) = open.tree {
            (self.ast[tree].body, self.ast[tree].body_scope) = self.build_body(has_scope, r#in)?;
        } else {
            match (has_braces, self.pauses.is_some()) {
                (true, false) => self.body_in_braces::<false>().map(drop)?,
                (false, false) => self.expression_body::<false>(r#in).map(drop)?,
                (true, true) => self.body_in_braces::<true>().map(drop)?,
                (false, true) => self.expression_body::<true>(r#in).map(drop)?,
            }
            if has_scope {
                self.scopes.pop_function_body::<false>(self.ast);
            }
        }
        if !has_braces {
            open.flags |= FunctionFlags::EXPRESSION_BODY;
            return Ok(());
        }
        if let Some(name) = open.own_name
            && name <= Name::EVAL
            && self.is_strict()
            && (is_eval_or_arguments(name) || is_reserved_in_strict_code(name))
        {
            return Err(self.reject_naming("'%' is not a valid function name in strict mode", name));
        }
        if !self.at(TokenKind::CloseBrace) {
            let sentence = "Expected a closing '}' after a % body";
            return Err(self.fail_saying(sentence, describe(open.kind, open.flags)));
        }
        self.record_pause(PauseKind::Enter, open.parameters_start);
        self.record_pause(PauseKind::Leave, self.start());
        Ok(())
    }

    #[inline(always)]
    fn body_in_braces<const BUILD: bool>(&mut self) -> Parsed<List<StmtId>> {
        self.next();
        if self.at(TokenKind::CloseBrace) {
            return Ok(List::EMPTY);
        }
        self.statements_with_directives::<BUILD>()
    }

    /// Up to the closing brace, or past the last token if there is none. Returns it with the scope that is its own.
    #[inline(never)]
    pub(super) fn build_body(
        &mut self,
        has_scope: bool,
        r#in: In,
    ) -> Parsed<(List<StmtId>, Option<ScopeId>)> {
        let body = if self.at(TokenKind::OpenBrace) {
            let start = self.start();
            let body = self.body_in_braces::<true>()?;
            let block = self.statement_node::<true>(start, StmtKind::Block { body, scope: None });
            self.ast[block].end = self.token().end();
            block
        } else {
            self.expression_body::<true>(r#in)?
        };
        let scope = has_scope.then(|| self.scopes.pop_function_body::<true>(self.ast));
        Ok((self.list_of_one(body), scope.flatten()))
    }

    fn expression_body<const BUILD: bool>(&mut self, r#in: In) -> Parsed<Statement> {
        let start = self.start();
        let value = self.assignment_in::<BUILD>(r#in)?;
        self.end_expression::<BUILD>(value);
        Ok(self.step_node::<BUILD>(start, StmtKind::Return(Some(value.id()))))
    }

    #[inline(always)]
    fn close_inner_function(&mut self, open: &Open) -> Summary {
        let closed = if open.tree.is_some() {
            self.scopes.close_function::<true>(self.ast)
        } else {
            self.scopes.close_function::<false>(self.ast)
        };
        let mut flags = open.flags;
        flags.set(FunctionFlags::STRICT, self.is_strict());
        flags.set(FunctionFlags::AWAITS, self.facts.contains(Facts::AWAITS));
        flags.set(
            FunctionFlags::USES_HOME,
            open.kind.has_home_object()
                && (closed.captures_home || self.facts.contains(Facts::USES_SUPER_PROPERTY)),
        );
        let mut traits = Traits::empty();
        traits.set(Traits::ARROW, open.kind == FunctionKind::Arrow);
        let summary = Summary {
            end: if flags.contains(FunctionFlags::EXPRESSION_BODY) {
                self.previous_end()
            } else {
                self.token().end()
            },
            length: open.length,
            flags,
            traits,
        };
        if let Some(tree) = open.tree {
            self.ast[tree] = Tree {
                features: self.features_of(closed.scope),
                end: summary.end,
                scope: closed.scope,
                ..self.ast[tree]
            };
        }
        self.leave_function(&open.outer, open.parameters_start, summary, closed)
    }

    fn function_node(
        &mut self,
        kind: FunctionKind,
        own_name: Option<Name>,
        name: Option<Name>,
        start: u32,
        Finished {
            parameters_start,
            summary,
            tree,
        }: Finished,
    ) -> FunctionId {
        self.ast.push_function(Function {
            kind,
            flags: summary.flags,
            own_name,
            name,
            start,
            parameters_start,
            end: summary.end,
            length: summary.length,
            tree,
        })
    }

    pub(super) fn parameters<const BUILD: bool>(
        &mut self,
        kind: FunctionKind,
        flags: FunctionFlags,
    ) -> Parsed<Parameters> {
        if !self.eat(TokenKind::OpenParen) {
            return self.parameter_without_parentheses::<BUILD>(kind, flags);
        }
        let (parameters, sentence) = match kind {
            FunctionKind::Getter => (
                Parameters {
                    list: List::EMPTY,
                    length: 0,
                },
                "getter functions must have no parameters",
            ),
            FunctionKind::Setter => (
                self.setter_parameter::<BUILD>()?,
                "Expected a ')' after a parameter declaration",
            ),
            _ => (
                self.parameter_list::<BUILD>(kind)?,
                "Expected a ')' or a ',' after a parameter declaration",
            ),
        };
        self.expect(TokenKind::CloseParen, sentence)?;
        Ok(parameters)
    }

    fn parameter_without_parentheses<const BUILD: bool>(
        &mut self,
        kind: FunctionKind,
        flags: FunctionFlags,
    ) -> Parsed<Parameters> {
        if kind != FunctionKind::Arrow || !self.at_name() {
            self.refuse_keyword(self.token(), describe(kind, flags), " name")?;
            if kind == FunctionKind::Arrow {
                return Err(self.fail("Expected an arrow function input parameter"));
            }
            let sentence = "Expected an opening '(' before a %'s parameter list";
            return Err(self.fail_saying(sentence, describe(kind, flags)));
        }
        let list = self.open_list();
        let pattern = Some(self.binding_name::<BUILD>(Binder::Parameter)?);
        self.append_element::<BUILD>(PatternElement {
            key: PropertyKey::None,
            pattern,
            default: None,
            is_rest: false,
        });
        Ok(Parameters {
            list: self.close_list::<BUILD, _>(list),
            length: 1,
        })
    }

    fn setter_parameter<const BUILD: bool>(&mut self) -> Parsed<Parameters> {
        const SENTENCE: &str = "setter functions must have one parameter";
        if self.at(TokenKind::CloseParen) {
            return Err(self.fail(SENTENCE));
        }
        let list = self.open_list();
        let has_default = self.parameter::<BUILD>(false)?;
        if let Some(name) = self.duplicate_parameter {
            return Err(self.reject_naming(
                "Duplicate parameter '%' not allowed in function with non-simple parameter list",
                name,
            ));
        }
        if self.at(TokenKind::Comma) {
            return Err(self.fail(SENTENCE));
        }
        Ok(Parameters {
            list: self.close_list::<BUILD, _>(list),
            length: u32::from(!has_default),
        })
    }

    /// Returns whether it has a default.
    #[inline(always)]
    fn parameter<const BUILD: bool>(&mut self, is_rest: bool) -> Parsed<bool> {
        let declared = self.scopes.variable_count();
        let pattern = match self.kind() {
            TokenKind::Identifier => self.binding_name::<BUILD>(Binder::Parameter)?,
            _ => self.pattern::<BUILD>(Binder::Parameter)?,
        };
        let default = if is_rest {
            None
        } else {
            self.default_value::<BUILD>(Binder::Parameter, pattern)?
        };
        if is_rest || default.is_some() || self.facts.contains(Facts::PARAMETER_PATTERNS) {
            self.facts |= Facts::ELABORATE_PARAMETERS;
        }
        if BUILD && self.facts.contains(Facts::PARAMETER_EXPRESSIONS) {
            (self.scopes).initialize_parameters(declared, self.lexer.previous_end);
        }
        self.append_element::<BUILD>(PatternElement {
            key: PropertyKey::None,
            pattern: Some(pattern),
            default,
            is_rest,
        });
        Ok(default.is_some())
    }

    /// Between the parentheses.
    pub(super) fn parameter_list<const BUILD: bool>(
        &mut self,
        kind: FunctionKind,
    ) -> Parsed<Parameters> {
        let list = self.open_list();
        let (mut length, mut has_defaults) = (0, false);
        while !self.at(TokenKind::CloseParen) {
            let is_rest = self.eat(TokenKind::Ellipsis);
            if is_rest && self.token().spells(TokenKind::Await) && self.is_await_reserved() {
                let sentence = "Cannot use 'await' as a parameter name in an async function";
                return Err(self.reject(sentence));
            }
            has_defaults |= self.parameter::<BUILD>(is_rest)?;
            if is_rest && self.at(TokenKind::Comma) {
                return Err(self.fail(
                    "Rest parameter should be the last parameter in a function declaration",
                ));
            }
            if let Some(name) = self.duplicate_parameter {
                self.check_duplicate_parameter(name, kind, has_defaults, is_rest)?;
            }
            length += u32::from(!has_defaults && !is_rest);
            if is_rest || !self.eat(TokenKind::Comma) {
                break;
            }
        }
        Ok(Parameters {
            list: self.close_list::<BUILD, _>(list),
            length,
        })
    }

    #[cold]
    fn check_duplicate_parameter(
        &mut self,
        name: Name,
        kind: FunctionKind,
        has_defaults: bool,
        is_rest: bool,
    ) -> Parsed<()> {
        let place = if has_defaults {
            "function with default parameter values"
        } else if self.facts.contains(Facts::PARAMETER_PATTERNS) {
            "function with destructuring parameters"
        } else if is_rest {
            "function with a rest parameter"
        } else if kind == FunctionKind::Arrow {
            "an arrow function"
        } else if kind.has_home_object() {
            "a method"
        } else {
            return Ok(());
        };
        let parts = &[name.into(), place.into()];
        Err(self.reject_with("Duplicate parameter '%' not allowed in %", parts))
    }

    /// At the parameters.
    pub(super) fn arrow_function<const BUILD: bool>(
        &mut self,
        start: u32,
        flags: FunctionFlags,
        r#in: In,
    ) -> Parsed<Expression> {
        let depth = self.depth_for::<BUILD>(start);
        let begun = self.begin_function(FunctionKind::Arrow, flags, None, None, depth)?;
        self.rest_of_arrow::<BUILD>(start, begun, r#in)
    }

    /// At the arrow. The parameters have been read as if they were an expression.
    pub(super) fn begin_scouted_arrow(&mut self, start: u32, flags: FunctionFlags) -> Begun {
        let (kind, recall) = (FunctionKind::Arrow, self.scopes.recall);
        let context = self.context.of_parameters(kind, flags);
        Begun::Open(Open {
            outer: self.enter_function(kind, context, start, recall),
            kind,
            flags,
            own_name: None,
            parameters_start: start,
            length: 0,
            tree: None,
        })
    }

    pub(super) fn rest_of_arrow<const BUILD: bool>(
        &mut self,
        start: u32,
        begun: Begun,
        r#in: In,
    ) -> Parsed<Expression> {
        let parsed = self.finish_function(begun, r#in)?;
        let function = if BUILD {
            self.function_node(FunctionKind::Arrow, None, None, start, parsed)
        } else {
            nothing()
        };
        Ok(self.node::<BUILD>(Class::Other, start, ExprKind::Function(function)))
    }

    /// At the parameters.
    pub(super) fn method<const BUILD: bool>(
        &mut self,
        method: Method,
    ) -> Parsed<(FunctionId, FunctionFlags)> {
        let begun = self.begin_function(method.kind, method.flags, None, None, Depth::Check)?;
        let mut parsed = self.finish_function(begun, In::Allowed)?;
        if self.options.capture_everything {
            parsed.summary.flags |= FunctionFlags::USES_HOME;
        }
        if !BUILD {
            return Ok((nothing(), parsed.summary.flags));
        }
        let name = match method.key {
            PropertyKey::Named(name) | PropertyKey::Private(name) => Some(name),
            _ => None,
        };
        let function = self.function_node(method.kind, None, name, method.start, parsed);
        Ok((function, parsed.summary.flags))
    }

    /// After the key.
    pub(super) fn accessor<const BUILD: bool>(
        &mut self,
        method: Method,
    ) -> Parsed<(FunctionId, FunctionFlags)> {
        if !self.at(TokenKind::OpenParen) {
            let privacy = match method.key {
                PropertyKey::Private(_) => "private ",
                _ => "",
            };
            let kind = describe(method.kind, method.flags);
            let parts = &[privacy.into(), kind.into()];
            return Err(self.fail_with("Expected a parameter list for %% definition", parts));
        }
        self.method::<BUILD>(method)
    }

    /// At `function`, which follows `async` unless it is at `start`.
    fn function_flags(&mut self, start: u32) -> FunctionFlags {
        let mut flags = FunctionFlags::empty();
        flags.set(FunctionFlags::ASYNC, self.start() != start);
        self.next();
        flags.set(FunctionFlags::GENERATOR, self.at(TokenKind::Star));
        flags
    }

    /// At the name, if there is one.
    #[inline(always)]
    fn function_name(&mut self, flags: FunctionFlags, is_expression: bool) -> Parsed<Option<Name>> {
        let token = self.token();
        match token.kind() {
            TokenKind::OpenParen => return Ok(None),
            TokenKind::Identifier => {}
            _ if self.is_unusual_function_name(flags, is_expression)? => {}
            _ => return Ok(None),
        }
        self.next();
        Ok(Some(token.name()))
    }

    #[cold]
    #[inline(never)]
    fn is_unusual_function_name(
        &mut self,
        flags: FunctionFlags,
        is_expression: bool,
    ) -> Parsed<bool> {
        let token = self.token();
        let is_async = flags.contains(FunctionFlags::ASYNC);
        let is_generator = flags.contains(FunctionFlags::GENERATOR);
        let kind = describe(FunctionKind::Normal, flags);
        if token.spells(TokenKind::Await) {
            const SENTENCE: &str = "Cannot declare function named 'await' %";
            if self.is_await_reserved() && (!is_expression || is_async) {
                return Err(self.reject_saying(SENTENCE, self.why_await_is_reserved()));
            }
            if self.context.contains(Context::MODULE) {
                return Err(self.reject_saying(SENTENCE, "in a module"));
            }
            if is_async && is_expression {
                return Err(self.reject_saying("Cannot declare % named 'await'", kind));
            }
            return Ok(true);
        }
        if token.spells(TokenKind::Yield) {
            let is_in_own_scope = is_expression && !is_generator;
            if self.is_strict() || (!is_in_own_scope && self.is_yield_reserved()) {
                return Ok(false);
            }
            if is_generator && is_expression {
                return Err(self.reject_saying("Cannot declare % named 'yield'", kind));
            }
            return Ok(true);
        }
        Ok(token.spells(TokenKind::Let) && !self.is_strict())
    }

    /// At `function`.
    #[inline(never)]
    pub(super) fn function_expression<const BUILD: bool>(
        &mut self,
        start: u32,
    ) -> Parsed<Expression> {
        let flags = self.function_flags(start);
        let depth = self.depth_for::<BUILD>(start);
        let (name, parsed) = self.named_function(flags, depth)?;
        let function = if BUILD {
            self.function_node(FunctionKind::Normal, name, name, start, parsed)
        } else {
            nothing()
        };
        Ok(self.node::<BUILD>(Class::Other, start, ExprKind::Function(function)))
    }

    fn named_function(
        &mut self,
        mut flags: FunctionFlags,
        depth: Depth,
    ) -> Parsed<(Option<Name>, Finished)> {
        self.eat(TokenKind::Star);
        let name = self.function_name(flags, true)?;
        if let Some(name) = name {
            flags |= FunctionFlags::BINDS_OWN_NAME;
            if is_eval_or_arguments(name) && self.is_strict() {
                let kind = describe(FunctionKind::Normal, flags);
                let parts = &[name.into(), kind.into()];
                return Err(self.reject_with("'%' is not a valid % name in strict mode", parts));
            }
        }
        let begun = self.begin_function(FunctionKind::Normal, flags, name, None, depth)?;
        Ok((name, self.finish_function(begun, In::Allowed)?))
    }

    /// At `function`.
    #[inline(never)]
    pub(super) fn function_declaration<const BUILD: bool>(
        &mut self,
        start: u32,
        site: Site,
        parameters_end: Option<u32>,
    ) -> Parsed<Statement> {
        let keyword_start = self.start();
        let (own_name, parsed) = self.skim_function_declaration(start, site, parameters_end)?;
        if !BUILD {
            return Ok(nothing());
        }
        let binding = own_name.unwrap_or(Name::DEFAULT_EXPORT);
        if self.context.contains(Context::EXPORTING) {
            self.export_declaration(binding, "Cannot export a duplicate function name: '%'")?;
        }
        let name = own_name.or(Some(Name::DEFAULT));
        let function = self.function_node(FunctionKind::Normal, own_name, name, start, parsed);
        self.scopes.add_function(function);
        Ok(self.statement_node::<BUILD>(keyword_start, StmtKind::Function(function)))
    }

    fn skim_function_declaration(
        &mut self,
        start: u32,
        site: Site,
        parameters_end: Option<u32>,
    ) -> Parsed<(Option<Name>, Finished)> {
        let flags = self.function_flags(start);
        if flags.contains(FunctionFlags::GENERATOR) {
            if site == Site::SingleStatement {
                return Err(self.fail(
                    "Cannot use generator function declaration in single-statement context",
                ));
            }
            self.next();
        }
        let own_name = self.function_name(flags, false)?;
        if own_name.is_none() && site != Site::DefaultExport {
            return Err(self.fail_for_function_name(flags));
        }
        let kind = FunctionKind::Normal;
        let begun = self.begin_function(kind, flags, own_name, parameters_end, Depth::Check)?;
        let parsed = self.finish_function(begun, In::Allowed)?;
        let name = own_name.unwrap_or(Name::DEFAULT_EXPORT);
        let article = if flags.contains(FunctionFlags::ASYNC) {
            "an async"
        } else {
            "a"
        };
        if is_eval_or_arguments(name) {
            self.declare_eval_or_arguments(
                name,
                "Cannot declare a function named '%' in strict mode",
            )?;
        }
        if !(self.scopes).declare_function(name, flags.is_empty(), self.is_strict()) {
            return Err(self.reject_with(
                "Cannot declare % function that shadows a let/const/class/function variable '%'",
                &[article.into(), name.into()],
            ));
        }
        if flags.is_empty() && !self.is_strict() {
            self.scopes.note_hoistable(name);
        }
        Ok((own_name, parsed))
    }

    #[cold]
    #[inline(never)]
    fn fail_for_function_name(&mut self, flags: FunctionFlags) -> Failed {
        if self.at(TokenKind::OpenParen) && !flags.contains(FunctionFlags::GENERATOR) {
            return self.reject(if flags.is_empty() {
                "Function statements must have a name"
            } else {
                "Async function statements must have a name"
            });
        }
        let outer = self.context;
        self.context = outer.of_body(FunctionKind::Normal, flags);
        let kind = describe(FunctionKind::Normal, flags);
        let result = self.refuse_keyword(self.token(), kind, " name");
        self.context = outer;
        result.err().unwrap_or_else(|| self.unexpected())
    }

    /// At the brace.
    pub(super) fn static_block_function(&mut self, start: u32) -> Parsed<FunctionId> {
        let parameters_start = self.start();
        let mut flags = FunctionFlags::STRICT | FunctionFlags::STATIC;
        flags.set(FunctionFlags::USES_HOME, self.static_block::<false>()?);
        let summary = Summary {
            end: self.previous_end(),
            length: 0,
            flags,
            traits: Traits::empty(),
        };
        let parsed = Finished {
            parameters_start,
            summary,
            tree: None,
        };
        Ok(self.function_node(FunctionKind::StaticBlock, None, None, start, parsed))
    }
}
