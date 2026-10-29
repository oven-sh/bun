mod alignment;

use std::thread::{self, ThreadId};

use bun_alloc::Arena;
use bun_ast::b::B;
use bun_ast::expr::Data as ExprData;
use bun_ast::stmt::Data as StmtData;
use bun_ast::symbol::follow_symbols;
use bun_ast::{
    ASTMemoryAllocator, Binding, E, Expr, G, Kind, Loader, Loc, Log, Ref, Source, Stmt, StmtOrExpr,
    Symbol, SymbolKind,
};
use bun_collections::StringSet;
use bun_core::handle_oom;
use bun_js_parser::Runtime::Features;
use bun_js_parser::{Define, Parser, ParserOptions, Result as Parsed};
use bun_sema::atom::Interner;
use bun_sema::bind::Bound;
use bun_sema::hir::{self, ExprId};
use bun_threading::Guarded;
use smallvec::{SmallVec, smallvec};

use self::alignment::{Alignment, PrintedTree, Rewrites};
pub(super) use self::alignment::{Rewrite, find_written_literal};

/// Bun's transpiler with the options `bun run` gives it, and the defines and flags of the build.
pub struct RuntimeTranspiler<'b> {
    define: &'b Define,
    enabled_features: Option<Box<StringSet>>,
    /// The arena of each thread that is not asking now. They are given back with the transpiler.
    arenas: Guarded<Vec<(ThreadId, Arena)>>,
}

impl<'b> RuntimeTranspiler<'b> {
    /// What `bun run` defines where no flag defines anything.
    pub fn create_default_define() -> Box<Define> {
        Define::with_pure_globals(false, true)
    }

    /// `enabled_features`: the flags for which `feature()` of "bun:bundle" answers true.
    pub fn new(define: &'b Define, enabled_features: &[&[u8]]) -> RuntimeTranspiler<'b> {
        RuntimeTranspiler {
            define,
            enabled_features: Features::init_bundler_feature_flags(enabled_features),
            arenas: Guarded::new(Vec::new()),
        }
    }
}

#[derive(Copy, Clone)]
pub(super) struct ParsedText<'a, 's> {
    pub(super) hir: &'a hir::File<'s>,
    pub(super) bound: &'a Bound<'s>,
    pub(super) atoms: &'a Interner<'s>,
    pub(super) max_steps: u64,
}

pub(super) struct TranspileRequest<'a, 's> {
    pub(super) path: &'a [u8],
    pub(super) text: &'a [u8],
    pub(super) loader: Loader,
    pub(super) has_legacy_decorators: bool,
    pub(super) assigns_class_fields: bool,
    /// The front end's own tree of `text`. Without it no rewrites are looked for.
    pub(super) parsed: Option<ParsedText<'a, 's>>,
}

/// An error that `bun run` prints in place of running the file.
pub(super) struct TranspilerError {
    pub(super) start: u32,
    pub(super) end: u32,
    pub(super) message: Box<[u8]>,
}

/// How deep a text may be nested depends on the thread that reads it.
fn ran_out_of_stack(log: &Log) -> bool {
    let mut messages = log.msgs.iter();
    messages.any(|message| &*message.data.text == b"Maximum call stack size exceeded")
}

fn errors_of(log: &Log) -> Vec<TranspilerError> {
    if ran_out_of_stack(log) {
        return Vec::new();
    }
    let errors = log.msgs.iter().filter(|message| message.kind == Kind::Err);
    errors
        .map(|error| {
            let location = error.data.location.as_ref();
            let start = location.map_or(0, |location| location.offset);
            let end = start + location.map_or(0, |location| location.length);
            TranspilerError {
                start: u32::try_from(start).unwrap_or(0),
                end: u32::try_from(end).unwrap_or(0),
                message: error.data.text.as_ref().into(),
            }
        })
        .collect()
}

const MAX_RETAINED_ARENA_BYTES: usize = 8 * 1024 * 1024;

impl RuntimeTranspiler<'_> {
    /// `Err`: nothing is printed for the file. The list holds what the transpiler says of its text.
    pub(super) fn transpile(
        &self,
        request: &TranspileRequest<'_, '_>,
    ) -> Result<TranspiledFile, Vec<TranspilerError>> {
        let thread = thread::current().id();
        let mut arena = self.take_arena_of(thread).unwrap_or_default();
        let transpiled = self.transpile_in(request, &arena);
        arena.reset_retain_with_limit(MAX_RETAINED_ARENA_BYTES);
        self.arenas.lock().push((thread, arena));
        transpiled
    }

    fn take_arena_of(&self, thread: ThreadId) -> Option<Arena> {
        let mut arenas = self.arenas.lock();
        let index = arenas.iter().position(|arena| arena.0 == thread)?;
        Some(arenas.swap_remove(index).1)
    }

    fn transpile_in(
        &self,
        request: &TranspileRequest<'_, '_>,
        arena: &Arena,
    ) -> Result<TranspiledFile, Vec<TranspilerError>> {
        let mut store = ASTMemoryAllocator::borrowing(arena);
        let _scope = store.enter();
        let source = Source::init_path_string(request.path, request.text);
        let mut options = ParserOptions::init(Default::default(), request.loader);
        options.tree_shaking = true;
        options.warn_about_unbundled_modules = false;
        options.use_define_for_class_fields = !request.assigns_class_fields;
        let features = &mut options.features;
        features.standard_decorators = !request.has_legacy_decorators;
        features.allow_runtime = true;
        features.trim_unused_imports = request.loader.is_typescript();
        features.no_macros = true;
        features.dont_bundle_twice = true;
        features.commonjs_at_runtime = true;
        features.inlining = true;
        features.minify_syntax = true;
        features.dead_code_elimination = true;
        features.top_level_await = true;
        let enabled_features = self.enabled_features.as_deref();
        features.bundler_feature_flags =
            enabled_features.map(|flags| Box::new(handle_oom(flags.clone())));
        let mut log = Log::init();
        let parsed = Parser::init(options, &mut log, &source, self.define, arena)
            .and_then(|parser| parser.parse());
        let Ok(Parsed::Ast(tree)) = parsed else {
            return Err(errors_of(&log));
        };
        let mut walker = Walker::new(request.text.len(), &tree.symbols);
        for part in tree.parts.iter() {
            walker
                .pending_statements
                .extend_from_slice(part.stmts.slice());
        }
        walker.walk();
        let rewrites = request.parsed.map(|parsed| {
            let records = tree.import_records.iter();
            let import_paths: Vec<&[u8]> = records.map(|record| record.path.text).collect();
            let printed = PrintedTree {
                identifiers: &walker.identifiers,
                statements: &walker.statements,
                initializers: &walker.initializers,
                computed_keys: &walker.computed_keys,
                calls: &walker.calls,
                import_paths: &import_paths,
            };
            Alignment::new(parsed, printed).find_rewrites()
        });
        let mut statements = PositionSet::new(request.text.len());
        for &(_, statement) in &walker.statements {
            statements.insert(statement.loc);
        }
        Ok(TranspiledFile {
            identifiers: walker.identifiers,
            bindings: walker.bindings,
            statements,
            accessed_constructions: walker.accessed_constructions,
            regexp_literals: walker.regexp_literals,
            require_main_positions: walker.require_main_positions,
            joined_declarators: walker.joined_declarators,
            classes_that_assign_fields: walker.classes_that_assign_fields,
            rewrites: rewrites.unwrap_or_default(),
        })
    }
}

/// Positions in a text, one bit for each byte.
struct PositionSet(Vec<u64>);

impl PositionSet {
    fn new(text_length: usize) -> PositionSet {
        PositionSet(vec![0; text_length / 64 + 1])
    }

    fn insert(&mut self, position: Loc) {
        if let Ok(position) = usize::try_from(position.start)
            && let Some(word) = self.0.get_mut(position / 64)
        {
            *word |= 1 << (position % 64);
        }
    }

    fn contains(&self, position: u32) -> bool {
        let word = self.0.get(position as usize / 64);
        word.is_some_and(|word| word >> (position % 64) & 1 != 0)
    }
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct JoinedDeclarator {
    object: u32,
    /// The `o` that is printed behind the pattern.
    pub(super) printed_object: u32,
    pub(super) is_first: bool,
}

/// Source positions of the nodes that are left in the AST the transpiler prints. The lists are sorted.
pub(super) struct TranspiledFile {
    identifiers: PositionSet,
    bindings: PositionSet,
    statements: PositionSet,
    // `new` expressions that are called or that a property is read from.
    accessed_constructions: Vec<u32>,
    regexp_literals: Vec<u32>,
    require_main_positions: Vec<u32>,
    // `a = o.x, b = o.y` is printed `{ x: a, y: b } = o`: the `o` of each declarator of such a run.
    joined_declarators: Vec<JoinedDeclarator>,
    // The `class` of each class whose instance fields are printed as assignments in its constructor.
    classes_that_assign_fields: Vec<u32>,
    rewrites: Rewrites,
}

impl TranspiledFile {
    pub(super) fn find_rewrite(&self, expression: ExprId) -> Option<Rewrite> {
        self.rewrites.expressions.get(&expression).copied()
    }

    pub(super) fn has_statement_at(&self, position: u32) -> bool {
        self.statements.contains(position)
    }

    pub(super) fn has_identifier_at(&self, position: u32) -> bool {
        self.identifiers.contains(position)
    }

    pub(super) fn has_binding_at(&self, position: u32) -> bool {
        self.bindings.contains(position)
    }

    pub(super) fn has_accessed_construction_at(&self, position: u32) -> bool {
        self.accessed_constructions.binary_search(&position).is_ok()
    }

    pub(super) fn has_regexp_literal_at(&self, position: u32) -> bool {
        self.regexp_literals.binary_search(&position).is_ok()
    }

    pub(super) fn has_require_main_at(&self, position: u32) -> bool {
        self.require_main_positions.binary_search(&position).is_ok()
    }

    /// For the object of one of several declarators that are printed as one pattern.
    pub(super) fn find_joined_declarator_at(&self, object: u32) -> Option<JoinedDeclarator> {
        let joined = &self.joined_declarators;
        let index = joined.binary_search_by_key(&object, |declarator| declarator.object);
        index.ok().map(|index| joined[index])
    }

    pub(super) fn assigns_fields_of_class_at(&self, position: u32) -> bool {
        let classes = &self.classes_that_assign_fields;
        classes.binary_search(&position).is_ok()
    }

    pub(super) fn find_return_that_evaluates(&self, initializer: ExprId) -> Option<u32> {
        let returned = &self.rewrites.returned_initializers;
        returned.get(&initializer).copied()
    }
}

struct Walker<'a> {
    symbols: &'a [Symbol],
    identifiers: PositionSet,
    bindings: PositionSet,
    accessed_constructions: Vec<u32>,
    regexp_literals: Vec<u32>,
    require_main_positions: Vec<u32>,
    joined_declarators: Vec<JoinedDeclarator>,
    classes_that_assign_fields: Vec<u32>,
    statements: Vec<(u32, Stmt)>,
    initializers: Vec<(u32, Expr)>,
    computed_keys: Vec<(u32, Expr)>,
    calls: Vec<(u32, Expr)>,
    pending_expressions: Vec<Expr>,
    pending_statements: Vec<Stmt>,
    pending_bindings: Vec<Binding>,
}

fn push_position(positions: &mut Vec<u32>, position: Loc) {
    if let Ok(position) = u32::try_from(position.start) {
        positions.push(position);
    }
}

/// `name = object.member`, without an optional chain: the name and the object.
fn find_member_declarator(declarator: &G::Decl) -> Option<(Ref, E::Identifier, Loc)> {
    let B::BIdentifier(binding) = &declarator.binding.data else {
        return None;
    };
    let ExprData::EDot(member) = &declarator.value.as_ref()?.data else {
        return None;
    };
    let ExprData::EIdentifier(object) = &member.target.data else {
        return None;
    };
    let is_plain = member.optional_chain.is_none();
    is_plain.then(|| (binding.r#ref, *object, member.target.loc))
}

impl<'a> Walker<'a> {
    fn new(text_length: usize, symbols: &'a [Symbol]) -> Walker<'a> {
        Walker {
            symbols,
            identifiers: PositionSet::new(text_length),
            bindings: PositionSet::new(text_length),
            accessed_constructions: Vec::new(),
            regexp_literals: Vec::new(),
            require_main_positions: Vec::new(),
            joined_declarators: Vec::new(),
            classes_that_assign_fields: Vec::new(),
            statements: Vec::new(),
            initializers: Vec::new(),
            computed_keys: Vec::new(),
            calls: Vec::new(),
            pending_expressions: Vec::new(),
            pending_statements: Vec::new(),
            pending_bindings: Vec::new(),
        }
    }

    fn walk(&mut self) {
        loop {
            if let Some(expression) = self.pending_expressions.pop() {
                self.walk_expression(expression);
            } else if let Some(binding) = self.pending_bindings.pop() {
                self.walk_binding(binding);
            } else if let Some(statement) = self.pending_statements.pop() {
                self.walk_statement(statement);
            } else {
                break;
            }
        }
        self.accessed_constructions.sort_unstable();
        self.regexp_literals.sort_unstable();
        self.require_main_positions.sort_unstable();
        self.joined_declarators.sort_unstable();
        self.classes_that_assign_fields.sort_unstable();
        self.statements.sort_unstable_by_key(|entry| entry.0);
        self.initializers.sort_unstable_by_key(|entry| entry.0);
        self.computed_keys.sort_unstable_by_key(|entry| entry.0);
        self.calls.sort_unstable_by_key(|entry| entry.0);
    }

    // `is_stable_destructuring_target` of js_printer.
    fn is_stable_object(&self, object: E::Identifier, followed: Ref) -> bool {
        let symbol = &self.symbols[followed.inner_index() as usize];
        if object.must_keep_due_to_with_stmt()
            || symbol.has_been_assigned_to()
            || symbol.namespace_alias.is_some()
        {
            return false;
        }
        match symbol.kind {
            SymbolKind::Unbound => object.can_be_removed_if_unused(),
            _ => !symbol.must_not_be_renamed(),
        }
    }

    // The runs that `print_decls` of js_printer joins.
    fn find_joined_declarators(&mut self, mut declarators: &[G::Decl]) {
        let symbols = self.symbols;
        while let [first, second, ..] = declarators {
            declarators = &declarators[1..];
            let Some((first_name, object, first_position)) = find_member_declarator(first) else {
                continue;
            };
            let followed = follow_symbols(symbols, object.ref_);
            let names_object = |name: Ref| follow_symbols(symbols, name) == followed;
            if !self.is_stable_object(object, followed) || names_object(first_name) {
                continue;
            }
            let reads_object = |declarator: &G::Decl| {
                let (name, object, position) = find_member_declarator(declarator)?;
                names_object(object.ref_).then_some((name, position))
            };
            let Some((mut last_name, printed_position)) = reads_object(second) else {
                continue;
            };
            let mut objects: SmallVec<[Loc; 8]> = smallvec![first_position, printed_position];
            declarators = &declarators[1..];
            // A declarator that binds the object itself is the last of its run.
            while !names_object(last_name)
                && let Some((name, position)) = declarators.first().and_then(reads_object)
            {
                last_name = name;
                objects.push(position);
                declarators = &declarators[1..];
            }
            let Ok(printed_object) = u32::try_from(printed_position.start) else {
                continue;
            };
            let objects = objects.iter().enumerate();
            self.joined_declarators
                .extend(objects.filter_map(|(index, object)| {
                    Some(JoinedDeclarator {
                        object: u32::try_from(object.start).ok()?,
                        printed_object,
                        is_first: index == 0,
                    })
                }));
        }
    }

    fn push_initializer(&mut self, binding: Binding, initializer: Option<Expr>) {
        self.push_initializer_at(binding.loc, initializer);
    }

    fn push_call_at(&mut self, position: Loc, call: Expr) {
        if let Ok(position) = u32::try_from(position.start) {
            self.calls.push((position, call));
        }
    }

    fn push_initializer_at(&mut self, position: Loc, initializer: Option<Expr>) {
        if let (Ok(position), Some(initializer)) = (u32::try_from(position.start), initializer) {
            self.initializers.push((position, initializer));
        }
    }

    fn walk_arguments(&mut self, arguments: &[G::Arg]) {
        for argument in arguments {
            self.pending_expressions
                .extend_from_slice(&argument.ts_decorators);
            self.pending_bindings.push(argument.binding);
            self.pending_expressions.extend(argument.default);
            self.push_initializer(argument.binding, argument.default);
        }
    }

    fn walk_function(&mut self, function: &G::Fn) {
        self.walk_arguments(function.args.slice());
        self.pending_statements
            .extend_from_slice(function.body.stmts.slice());
    }

    fn walk_property(&mut self, property: &G::Property) {
        self.pending_expressions
            .extend_from_slice(&property.ts_decorators);
        self.pending_expressions.extend(property.key);
        self.pending_expressions.extend(property.value);
        self.pending_expressions.extend(property.initializer);
        if let Some(block) = property.class_static_block_ref() {
            self.pending_statements.extend_from_slice(&block.stmts);
        }
    }

    fn walk_class(&mut self, class: &G::Class) {
        self.pending_expressions
            .extend_from_slice(&class.ts_decorators);
        self.pending_expressions.extend(class.extends);
        self.push_initializer_at(class.class_keyword.loc, class.extends);
        if class.assigns_fields_in_constructor {
            push_position(
                &mut self.classes_that_assign_fields,
                class.class_keyword.loc,
            );
        }
        for property in class.properties.slice() {
            self.walk_property(property);
            if let Some(key) = property.key {
                self.push_initializer_at(key.loc, property.initializer);
            }
        }
    }

    fn walk_binding(&mut self, binding: Binding) {
        self.bindings.insert(binding.loc);
        match binding.data {
            B::BIdentifier(_) | B::BMissing(_) => {}
            B::BArray(array) => {
                for item in array.items() {
                    self.pending_bindings.push(item.binding);
                    self.pending_expressions.extend(item.default_value);
                    self.push_initializer(item.binding, item.default_value);
                }
            }
            B::BObject(object) => {
                for property in object.properties() {
                    self.pending_expressions.push(property.key);
                    self.pending_bindings.push(property.value);
                    self.pending_expressions.extend(property.default_value);
                    self.push_initializer(property.value, property.default_value);
                    if let Ok(position) = u32::try_from(property.value.loc.start) {
                        self.computed_keys.push((position, property.key));
                    }
                }
            }
        }
    }

    fn walk_accessed(&mut self, object: Expr) {
        if let ExprData::ENew(_) = object.data {
            push_position(&mut self.accessed_constructions, object.loc);
        }
        self.pending_expressions.push(object);
    }

    fn walk_expression(&mut self, expression: Expr) {
        match expression.data {
            ExprData::EIdentifier(_)
            | ExprData::EImportIdentifier(_)
            | ExprData::ECommonjsExportIdentifier(_) => {
                self.identifiers.insert(expression.loc);
            }
            ExprData::EArray(list) => self.pending_expressions.extend_from_slice(&list.items),
            ExprData::EUnary(operator) => self.pending_expressions.push(operator.value),
            ExprData::EBinary(operator) => {
                self.pending_expressions
                    .extend([operator.left, operator.right]);
            }
            ExprData::EClass(class) => self.walk_class(&class),
            ExprData::ENew(site) => {
                self.push_call_at(expression.loc, expression);
                self.pending_expressions.push(site.target);
                self.pending_expressions.extend_from_slice(&site.args);
            }
            ExprData::EFunction(function) => self.walk_function(&function.func),
            ExprData::ECall(site) => {
                self.push_call_at(site.close_paren_loc, expression);
                self.walk_accessed(site.target);
                self.pending_expressions.extend_from_slice(&site.args);
            }
            ExprData::EDot(access) => self.walk_accessed(access.target),
            ExprData::EIndex(access) => {
                self.walk_accessed(access.target);
                self.pending_expressions.push(access.index);
            }
            ExprData::EArrow(arrow) => {
                self.walk_arguments(arrow.args.slice());
                self.pending_statements
                    .extend_from_slice(arrow.body.stmts.slice());
            }
            ExprData::EObject(object) => {
                for property in object.properties.iter() {
                    self.walk_property(property);
                }
            }
            ExprData::ESpread(spread) => self.pending_expressions.push(spread.value),
            ExprData::ETemplate(template) => {
                if let Some(tag) = template.tag {
                    self.walk_accessed(tag);
                }
                let parts = template.parts().iter();
                self.pending_expressions
                    .extend(parts.map(|part| part.value));
            }
            ExprData::EAwait(operator) => self.pending_expressions.push(operator.value),
            ExprData::EYield(operator) => self.pending_expressions.extend(operator.value),
            ExprData::EIf(condition) => {
                self.pending_expressions
                    .extend([condition.test, condition.yes, condition.no]);
            }
            ExprData::EImport(import) => self
                .pending_expressions
                .extend([import.expr, import.options]),
            ExprData::EInlinedEnum(member) => self.pending_expressions.push(member.value),
            ExprData::ERegExp(_) => push_position(&mut self.regexp_literals, expression.loc),
            ExprData::ERequireMain => {
                push_position(&mut self.require_main_positions, expression.loc)
            }
            ExprData::EJsxElement(_)
            | ExprData::EObjectJSON(_)
            | ExprData::EArrayJSON(_)
            | ExprData::EPrivateIdentifier(_)
            | ExprData::EBoolean(_)
            | ExprData::EBranchBoolean(_)
            | ExprData::ENumber(_)
            | ExprData::EBigInt(_)
            | ExprData::EString(_)
            | ExprData::ERequireString(_)
            | ExprData::ERequireResolveString(_)
            | ExprData::ERequireCallTarget
            | ExprData::ERequireResolveCallTarget
            | ExprData::EMissing(_)
            | ExprData::EThis(_)
            | ExprData::ESuper(_)
            | ExprData::ENull(_)
            | ExprData::EUndefined(_)
            | ExprData::ENewTarget(_)
            | ExprData::EImportMeta(_)
            | ExprData::EImportMetaMain(_)
            | ExprData::ESpecial(_)
            | ExprData::ENameOfSymbol(_) => {}
        }
    }

    fn walk_statement(&mut self, statement: Stmt) {
        if let Ok(position) = u32::try_from(statement.loc.start) {
            self.statements.push((position, statement));
        }
        match statement.data {
            StmtData::SBlock(block) => self
                .pending_statements
                .extend_from_slice(block.stmts.slice()),
            StmtData::SExpr(statement) => self.pending_expressions.push(statement.value),
            StmtData::SLocal(local) => {
                if !local.kind.is_using() {
                    self.find_joined_declarators(&local.decls);
                }
                for declaration in local.decls.iter() {
                    self.pending_bindings.push(declaration.binding);
                    self.pending_expressions.extend(declaration.value);
                    self.push_initializer(declaration.binding, declaration.value);
                }
            }
            StmtData::SReturn(returned) => self.pending_expressions.extend(returned.value),
            StmtData::SThrow(statement) => self.pending_expressions.push(statement.value),
            StmtData::SIf(statement) => {
                self.pending_expressions.push(statement.test);
                self.pending_statements.push(statement.yes);
                self.pending_statements.extend(statement.no);
            }
            StmtData::SFor(statement) => {
                self.pending_statements.extend(statement.init);
                self.pending_expressions.extend(statement.test);
                self.pending_expressions.extend(statement.update);
                self.pending_statements.push(statement.body);
            }
            StmtData::SForIn(statement) => {
                self.pending_statements
                    .extend([statement.init, statement.body]);
                self.pending_expressions.push(statement.value);
            }
            StmtData::SForOf(statement) => {
                self.pending_statements
                    .extend([statement.init, statement.body]);
                self.pending_expressions.push(statement.value);
            }
            StmtData::SWhile(statement) => {
                self.pending_expressions.push(statement.test);
                self.pending_statements.push(statement.body);
            }
            StmtData::SDoWhile(statement) => {
                self.pending_expressions.push(statement.test);
                self.pending_statements.push(statement.body);
            }
            StmtData::SSwitch(statement) => {
                self.pending_expressions.push(statement.test);
                for case in statement.cases.slice() {
                    self.pending_expressions.extend(case.value);
                    self.pending_statements.extend_from_slice(case.body.slice());
                }
            }
            StmtData::STry(statement) => {
                self.pending_statements
                    .extend_from_slice(statement.body.slice());
                if let Some(handler) = &statement.catch {
                    self.pending_bindings.extend(handler.binding);
                    self.pending_statements
                        .extend_from_slice(handler.body.slice());
                }
                if let Some(finalizer) = &statement.finally {
                    self.pending_statements
                        .extend_from_slice(finalizer.stmts.slice());
                }
            }
            StmtData::SLabel(statement) => self.pending_statements.push(statement.stmt),
            StmtData::SWith(statement) => {
                self.pending_expressions.push(statement.value);
                self.pending_statements.push(statement.body);
            }
            StmtData::SFunction(statement) => {
                if let Some(name) = &statement.func.name {
                    self.bindings.insert(name.loc);
                }
                self.walk_function(&statement.func);
            }
            StmtData::SClass(statement) => self.walk_class(&statement.class),
            StmtData::SExportDefault(statement) => match statement.value {
                StmtOrExpr::Stmt(value) => self.pending_statements.push(value),
                StmtOrExpr::Expr(value) => self.pending_expressions.push(value),
            },
            StmtData::SExportEquals(statement) => self.pending_expressions.push(statement.value),
            StmtData::SBreak(_)
            | StmtData::SComment(_)
            | StmtData::SContinue(_)
            | StmtData::SDirective(_)
            | StmtData::SDebugger(_)
            | StmtData::SEmpty(_)
            | StmtData::SEnum(_)
            | StmtData::SExportClause(_)
            | StmtData::SExportFrom(_)
            | StmtData::SExportStar(_)
            | StmtData::SImport(_)
            | StmtData::SLazyExport(_)
            | StmtData::SNamespace(_)
            | StmtData::STypeScript(_) => {}
        }
    }
}
