//! The whole of what is parsed.

use bun_engine_text::StringRef;

use super::function::Site;
use super::{Context, Facts, Failed, In, Parsed, Session, Statement};
use crate::ast::{
    BindingFlags, BindingKind, Features, List, PropertyKey, ScopeId, ScopeKind, StmtId, StmtKind,
};
use crate::cache::{Found, Traits};
use crate::error::Part;
use crate::names::Name;
use crate::options::{
    EvalContext, FieldKind, FieldSource, FunctionFlags, FunctionKind, FunctionSource, Goal,
};
use crate::scope::Recall;
use crate::token::TokenKind;

fn context_of_eval(allowed: EvalContext) -> Context {
    let mut context = Context::empty();
    for (condition, consequence) in [
        (EvalContext::STRICT, Context::STRICT),
        (EvalContext::IN_FUNCTION, Context::NEW_TARGET),
        (EvalContext::IN_METHOD, Context::SUPER_PROPERTY),
        (
            EvalContext::IN_FUNCTION | EvalContext::IN_DERIVED_CONSTRUCTOR,
            Context::SUPER_CALL,
        ),
        (
            EvalContext::IN_FIELD_INITIALIZER,
            Context::NO_ARGUMENTS_IN_EVAL,
        ),
    ] {
        if allowed.contains(condition) {
            context |= consequence;
        }
    }
    context
}

impl Session<'_> {
    pub(super) fn root(&mut self) -> Parsed<()> {
        let body = match self.options.goal {
            Goal::Function(function) => self.function_goal(function)?,
            goal => self.program_goal(goal)?,
        };
        // What a script has, a debugger finds without.
        if self.options.capture_everything && !matches!(self.options.goal, Goal::Script { .. }) {
            self.scopes.capture_context();
        }
        let scope = self.scopes.close_function::<true>(self.ast).scope;
        if self.facts.contains(Facts::PRIVATE_NAMES)
            && !self.context.contains(Context::CHECKED_BEFORE)
        {
            self.check_private_names()?;
        }
        let features = self.features_of(scope);
        let root = &mut self.ast.root.tree;
        root.features = features;
        root.end = self.lexer.end();
        root.scope = scope;
        root.body = body;
        Ok(())
    }

    /// Of the code whose scope has just been closed.
    pub(super) fn features_of(&self, scope: Option<ScopeId>) -> Features {
        let mut features = Features::empty();
        for (fact, feature) in [
            (Facts::USES_THIS, Features::USES_THIS),
            (Facts::USES_NEW_TARGET, Features::USES_NEW_TARGET),
            (Facts::AWAITS, Features::AWAITS),
            (Facts::TAGGED_TEMPLATE, Features::TAGGED_TEMPLATE),
        ] {
            features.set(feature, self.facts.contains(fact));
        }
        features.set(Features::STRICT, self.is_strict());
        features.set(
            Features::SIMPLE_PARAMETERS,
            !self.facts.contains(Facts::ELABORATE_PARAMETERS),
        );
        let uses = self.facts & (Facts::READS_ARGUMENTS_LENGTH | Facts::USES_ARGUMENTS);
        features.set(
            Features::ONLY_ARGUMENTS_LENGTH,
            uses == Facts::READS_ARGUMENTS_LENGTH
                && scope.is_some_and(|scope| {
                    self.ast.bindings(scope).iter().any(|binding| {
                        binding.kind == BindingKind::Arguments
                            && !binding.flags.contains(BindingFlags::CAPTURED)
                    })
                }),
        );
        features
    }

    fn program_goal(&mut self, goal: Goal<'_>) -> Parsed<List<StmtId>> {
        let (kind, context) = match goal {
            Goal::Module => (
                ScopeKind::Module,
                Context::STRICT | Context::MODULE | Context::TOP_LEVEL_OF_MODULE,
            ),
            Goal::Script { strict: true } => (ScopeKind::Script, Context::STRICT),
            Goal::Eval { context, .. } => (ScopeKind::Script, context_of_eval(context)),
            _ => (ScopeKind::Script, Context::empty()),
        };
        self.set_context(context);
        self.scopes.push(kind, self.start());
        self.lexer.skip_hashbang();
        self.next();
        self.ast.root.tree.start = self.start();
        let body = match goal {
            Goal::Module => self.module_items()?,
            Goal::SingleFunction { parameters_end } => self.single_function(parameters_end)?,
            _ => self.statements_with_directives::<true>()?,
        };
        if !self.at(TokenKind::End) {
            return Err(Failed);
        }
        if matches!(goal, Goal::Eval { .. }) && self.is_strict() {
            self.scopes.keep_variables_in_root();
        }
        let source = self.lexer.source;
        let text = |(start, end)| StringRef::try_narrowed(source.slice(start, end)).ok();
        self.ast.root.source_url = self.lexer.source_url.and_then(text);
        self.ast.root.source_mapping_url = self.lexer.source_mapping_url.and_then(text);
        Ok(body)
    }

    pub(super) fn list_of_one(&mut self, statement: Statement) -> List<StmtId> {
        let list = self.open_list();
        self.ast.push_to_list(statement);
        self.ast.close_list(list)
    }

    fn single_function(&mut self, parameters_end: Option<u32>) -> Parsed<List<StmtId>> {
        let start = self.start();
        if self.at_contextual(Name::ASYNC) {
            self.next();
            if !self.at(TokenKind::Function) || self.follows_newline() {
                return Err(self.fail("Cannot parse the async function"));
            }
        } else if !self.at(TokenKind::Function) {
            return Err(self.unexpected());
        }
        let function = self.function_declaration::<true>(start, Site::Ordinary, parameters_end)?;
        Ok(self.list_of_one(function))
    }

    pub(super) fn is_private_name_declared_outside(&self, name: Name) -> bool {
        match self.options.goal {
            Goal::Eval {
                is_private_name_declared,
                ..
            } => is_private_name_declared(self.lexer.names.text(name, self.lexer.source.text)),
            _ => false,
        }
    }

    #[cold]
    fn check_private_names(&mut self) -> Parsed<()> {
        let undeclared = self.scopes.free_names().find(|&name| {
            let text = self.lexer.names.text(name, self.lexer.source.text);
            text.get(0) == Some(u16::from(b'#')) && !self.is_private_name_declared_outside(name)
        });
        match undeclared {
            Some(name) => Err(self.reject_verbatim(
                "Cannot reference undeclared private names: \"%\"",
                &[Part::RawName(name)],
            )),
            None => Ok(()),
        }
    }

    fn function_goal(&mut self, function: FunctionSource<'_>) -> Parsed<List<StmtId>> {
        let FunctionSource { kind, flags, .. } = function;
        let mut outer = Context::CHECKED_BEFORE
            | Context::NEW_TARGET
            | Context::SUPER_PROPERTY
            | Context::SUPER_CALL;
        outer.set(Context::STRICT, flags.contains(FunctionFlags::STRICT));
        outer.set(Context::MODULE, self.options.in_module);
        if kind == FunctionKind::FieldInitializer {
            self.scopes.push_function(kind, self.start());
            self.set_context(outer.of_body(kind, flags));
            return self.field_definitions(function.fields);
        }
        self.set_context(outer.of_parameters(kind, flags));
        self.next();
        let mut own_name = None;
        if flags.contains(FunctionFlags::BINDS_OWN_NAME) {
            own_name = Some(self.own_name()?);
        }
        self.scopes.push_function(kind, self.start());
        if self.is_in_outline(function) {
            self.scopes.recall = Recall::Replays;
        }
        self.ast.root.tree.start = self.start();
        if kind != FunctionKind::StaticBlock {
            self.ast.root.tree.parameters = self.parameters::<true>(kind, flags)?.list;
        }
        self.context = outer.of_body(kind, flags);
        let has_scope = self.begin_body(own_name, flags);
        self.capture_as_told();
        if kind == FunctionKind::Arrow {
            self.expect(TokenKind::Arrow, "Expected an arrow")?;
        }
        let has_braces = self.at(TokenKind::OpenBrace);
        let (body, scope) = self.build_body(has_scope, In::Allowed)?;
        if (has_braces && !self.eat(TokenKind::CloseBrace)) || !self.at(TokenKind::End) {
            return Err(Failed);
        }
        self.ast.root.tree.body_scope = scope;
        Ok(body)
    }

    /// At the parameters.
    fn is_in_outline(&self, function: FunctionSource<'_>) -> bool {
        let outline = &self.scopes.outline;
        let found = outline.find(self.start(), Traits::empty());
        let shape = FunctionFlags::STRICT
            | FunctionFlags::ASYNC
            | FunctionFlags::GENERATOR
            | FunctionFlags::BINDS_OWN_NAME;
        found.map(|it| outline.summary(it)).is_some_and(|summary| {
            !summary.traits.contains(Traits::TOLD)
                && summary.traits.contains(Traits::ARROW) == (function.kind == FunctionKind::Arrow)
                && summary.flags & shape == function.flags & shape
                && summary.end == self.lexer.end()
        })
    }

    /// From the first token of a function expression to its parameters.
    fn own_name(&mut self) -> Parsed<Name> {
        self.eat(TokenKind::Identifier);
        self.expect(TokenKind::Function, "Expected a function")?;
        self.eat(TokenKind::Star);
        let token = self.token();
        if !token.kind().is_identifier_name() {
            return Err(self.unexpected());
        }
        self.next();
        Ok(token.name())
    }

    fn field_definitions(&mut self, fields: &[FieldSource]) -> Parsed<List<StmtId>> {
        self.ast.root.tree.start = self.start();
        let list = self.open_list();
        for (index, field) in (0..).zip(fields) {
            self.lexer.jump(field.key_start);
            let kind = if field.kind == FieldKind::StaticBlock {
                self.replay_if_known(Traits::empty());
                let function = self.static_block_function(field.start)?;
                StmtKind::StaticBlock { function }
            } else {
                self.field_definition(index, field)?
            };
            let statement = self.statement_node::<true>(field.start, kind);
            self.ast.push_to_list(statement);
        }
        self.scopes.recall = Recall::Nothing;
        Ok(self.ast.close_list(list))
    }

    fn replay_if_known(&mut self, part: Traits) -> Option<Found> {
        let found = self.scopes.outline.find(self.start(), part);
        self.scopes.recall = found.map_or(Recall::Nothing, |_| Recall::Replays);
        found
    }

    /// At the key.
    fn field_definition(&mut self, index: u32, field: &FieldSource) -> Parsed<StmtKind> {
        let token = self.token();
        let key = match (field.kind, token.kind()) {
            (FieldKind::Private, TokenKind::PrivateName) => {
                self.refer_to_private_name(token);
                PropertyKey::Private(token.name())
            }
            (FieldKind::Named, TokenKind::Number | TokenKind::BigInt) => {
                PropertyKey::Named(self.numeric_key::<true>()?)
            }
            (FieldKind::Named, kind) if kind == TokenKind::String || kind.is_identifier_name() => {
                PropertyKey::Named(self.word_or_string(token))
            }
            (FieldKind::Computed | FieldKind::StaticBlock, _) => PropertyKey::None,
            _ => return Err(self.unexpected()),
        };
        if field.initializer_start == 0 {
            self.lexer.previous_end = token.end();
            let value = None;
            return Ok(StmtKind::DefineField { index, key, value });
        }
        self.lexer.jump(field.initializer_start);
        let found = self.replay_if_known(Traits::INITIALIZER);
        let value = self.assignment::<true>()?;
        if let Some(found) = found {
            self.scopes.replay(found);
        }
        self.end_expression::<true>(value);
        if let PropertyKey::Named(name) | PropertyKey::Private(name) = key {
            self.name_anonymous(value.id(), name);
        }
        let value = Some(value.id());
        Ok(StmtKind::DefineField { index, key, value })
    }
}
