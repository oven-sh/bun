mod alignment;
mod first_recorded_position;

use std::thread::{self, ThreadId};

use bun_alloc::{Arena, AstAlloc};
use bun_ast::b::B;
use bun_ast::expr::Data as ExprData;
use bun_ast::flags::Property as PropertyFlag;
use bun_ast::stmt::Data as StmtData;
use bun_ast::symbol::follow_symbols;
use bun_ast::{
    ASTMemoryAllocator, Ast, Binding, E, Expr, G, Kind, Loader, Loc, Log, OpCode, Ref, S, Source,
    Stmt, StmtOrExpr, Symbol, SymbolKind,
};
use bun_collections::StringSet;
use bun_core::handle_oom;
use bun_js_parser::Runtime::Features;
use bun_js_parser::{Define, Parser, ParserOptions, Result as Parsed};
use bun_sema::atom::Interner;
use bun_sema::bind::Bound;
use bun_sema::hir::{self, ExprId, FnId};
use bun_sema::util::SharedSort;
use bun_threading::Guarded;
use smallvec::{SmallVec, smallvec};

use self::alignment::{Alignment, PrintedTree, Rewrites};
pub(super) use self::alignment::{Rewrite, find_written_literal};
use self::first_recorded_position::{
    Variables, find_first_recorded_position, find_first_recorded_position_of_class,
};
use crate::load::source_provider::{SourceProvider, TranspiledTree};

/// Bun's transpiler with the options `bun run` gives it, and the defines and flags of the build.
pub struct RuntimeTranspiler<'b> {
    define: &'b Define,
    enabled_features: Option<Box<StringSet>>,
    /// It has Bun's printer.
    printer: &'b dyn SourceProvider,
    /// The arena of each thread that is not asking now. They are given back with the transpiler.
    arenas: Guarded<Vec<(ThreadId, Arena)>>,
}

impl<'b> RuntimeTranspiler<'b> {
    /// What `bun run` defines where no flag defines anything.
    pub fn create_default_define() -> Box<Define> {
        Define::with_pure_globals(false, true)
    }

    /// `enabled_features`: the flags for which `feature()` of "bun:bundle" answers true.
    pub fn new(
        define: &'b Define,
        enabled_features: &[&[u8]],
        printer: &'b dyn SourceProvider,
    ) -> RuntimeTranspiler<'b> {
        RuntimeTranspiler {
            define,
            enabled_features: Features::init_bundler_feature_flags(enabled_features),
            printer,
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
        options.keep_parameter_lists_as_written = true;
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
        features.lower_using = false;
        let enabled_features = self.enabled_features.as_deref();
        features.bundler_feature_flags =
            enabled_features.map(|flags| Box::new(handle_oom(flags.clone())));
        let mut log = Log::init();
        let parsed = Parser::init(options, &mut log, &source, self.define, arena)
            .and_then(|parser| parser.parse());
        let Ok(Parsed::Ast(mut tree)) = parsed else {
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
        let parts = tree.parts.iter().map(|part| part.stmts.slice());
        let (first_recorded_positions, first_recorded_positions_of_functions) =
            walker.find_first_recorded_positions(parts);
        let quoted_functions = std::mem::take(&mut walker.quoted_functions);
        let declarations_printed_without_name = request.parsed.map_or_else(Vec::new, |parsed| {
            walker.find_declarations_printed_without_name(parsed.hir)
        });
        let mut transpiled = TranspiledFile {
            identifiers: walker.identifiers,
            bindings: walker.bindings,
            statements,
            accessed_constructions: walker.accessed_constructions,
            regexp_literals: walker.regexp_literals,
            require_main_positions: walker.require_main_positions,
            joined_declarators: walker.joined_declarators,
            classes_that_assign_fields: walker.classes_that_assign_fields,
            quoted_brackets_over_lines: walker.quoted_brackets_over_lines,
            printed_functions: Vec::new(),
            first_recorded_positions,
            first_recorded_positions_of_functions,
            declarations_printed_without_name,
            rewrites: rewrites.unwrap_or_default(),
        };
        transpiled.printed_functions =
            self.print_functions(&quoted_functions, &mut tree, &source, arena);
        Ok(transpiled)
    }

    fn print_functions(
        &self,
        functions: &[QuotedFunction],
        tree: &mut Ast<'_>,
        source: &Source<'_>,
        arena: &Arena,
    ) -> Vec<PrintedFunction> {
        if functions.is_empty() {
            return Vec::new();
        }
        let symbols = tree.symbols.drain(..).collect();
        let file = TranspiledTree {
            tree,
            symbols,
            source,
            arena,
        };
        let statements: Vec<(Stmt, u32)> = functions
            .iter()
            .map(|function| (function.printed_alike, function.indentation))
            .collect();
        let printed = self.printer.print_as_run(file, &statements);
        let printed = printed.unwrap_or_default();
        let functions = functions.iter().zip(&printed);
        functions
            .filter_map(|(function, printed)| {
                let (in_front, behind): (&[u8], &[u8]) = match function.written {
                    WrittenFunction::Method { .. } => (b"return { ", b" };\n"),
                    _ => (b"return ", b";\n"),
                };
                let printed = printed.get(function.indentation as usize * 2..)?;
                let text = printed.strip_prefix(in_front)?.strip_suffix(behind)?;
                Some(PrintedFunction {
                    written: function.written,
                    is_in_list: function.is_in_list,
                    text: text.into(),
                })
            })
            .collect()
    }
}

/// What says which function or class of the file it is.
#[derive(Copy, Clone)]
pub(super) enum WrittenFunction {
    /// `function () {}` and `() => {}`, by the `{` of the body. `() => 1`, by the `=>`.
    Expression { body: u32 },
    /// `m() {}`, `get a() {}` and `set a(v) {}` of an object, by the `{` of the body.
    Method { body: u32 },
    /// By its `class`.
    Class { keyword: u32 },
}

/// A function or a class that lies in what an error may quote.
struct QuotedFunction {
    written: WrittenFunction,
    is_in_list: bool,
    /// Of the line that it starts in.
    indentation: u32,
    /// `return f;`, or `return { m() {} };` for a method.
    printed_alike: Stmt,
}

pub(super) struct PrintedFunction {
    pub(super) written: WrittenFunction,
    pub(super) is_in_list: bool,
    /// As `bun run` has it.
    pub(super) text: Box<[u8]>,
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
    // The `[` or `{` of each list and object that is printed over several lines and lies in what an error may quote. With how often its line is indented.
    quoted_brackets_over_lines: Vec<(u32, u32)>,
    // The functions and classes in what an error may quote.
    printed_functions: Vec<PrintedFunction>,
    // The `class` of each class without a parent, and the first position that its constructor records.
    first_recorded_positions: Vec<(u32, u32)>,
    // The `(` of each function that may be constructed, and the first position that it records as strict code and as sloppy code.
    first_recorded_positions_of_functions: Vec<(u32, [Option<u32>; 2])>,
    // `{ function f() {} }` is printed `{ let f = function() {}; }`: each such declaration.
    declarations_printed_without_name: Vec<FnId>,
    rewrites: Rewrites,
}

impl TranspiledFile {
    pub(super) fn find_rewrite(&self, expression: ExprId) -> Option<Rewrite> {
        self.rewrites.expressions.get(&expression).copied()
    }

    /// In no order.
    pub(super) fn rewritten_expressions(&self) -> impl Iterator<Item = ExprId> {
        self.rewrites.expressions.keys().copied()
    }

    /// Each `a[key]` that is printed `a.name`.
    pub(super) fn keys_printed_as_names(&self) -> &[ExprId] {
        &self.rewrites.keys_printed_as_names
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

    pub(super) fn quoted_brackets_over_lines(&self) -> &[(u32, u32)] {
        &self.quoted_brackets_over_lines
    }

    pub(super) fn printed_functions(&self) -> &[PrintedFunction] {
        &self.printed_functions
    }

    pub(super) fn assigns_fields_of_class_at(&self, position: u32) -> bool {
        let classes = &self.classes_that_assign_fields;
        classes.binary_search(&position).is_ok()
    }

    /// Where `bun run` reports an error out of making `this`, for the `class` of a class without a parent.
    /// `None`: at the parameters of the constructor.
    pub(super) fn find_first_recorded_position(&self, class: u32) -> Option<u32> {
        let positions = &self.first_recorded_positions;
        let index = positions.binary_search_by_key(&class, |entry| entry.0);
        index.ok().map(|index| positions[index].1)
    }

    /// The same for a plain function, by the `(` of its parameters.
    pub(super) fn find_first_recorded_position_of_function(
        &self,
        parameters: u32,
        is_strict: bool,
    ) -> Option<u32> {
        let positions = &self.first_recorded_positions_of_functions;
        let index = positions.binary_search_by_key(&parameters, |entry| entry.0);
        positions[index.ok()?].1[usize::from(!is_strict)]
    }

    /// The functions that the file declares and that are anonymous functions in variables in what is printed. In order.
    pub(super) fn declarations_printed_without_name(&self) -> &[FnId] {
        &self.declarations_printed_without_name
    }

    /// The name in whose place an initializer is printed.
    pub(super) fn find_name_replaced_by(&self, initializer: ExprId) -> Option<ExprId> {
        self.rewrites.replaced_names.get(&initializer).copied()
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
    quoted_brackets_over_lines: Vec<(u32, u32)>,
    quoted_functions: Vec<QuotedFunction>,
    // The `[` and `{` of `[a, { b }] = v`.
    assigned_patterns: PositionSet,
    classes_without_parent: Vec<StmtOrExpr>,
    // Those that are written with `function` and are neither async nor generators. Methods are among them.
    functions: Vec<StmtOrExpr>,
    statements: Vec<(u32, Stmt)>,
    initializers: Vec<(u32, Expr)>,
    computed_keys: Vec<(u32, Expr)>,
    calls: Vec<(u32, Expr)>,
    pending_expressions: Vec<Expr>,
    pending_statements: Vec<Stmt>,
    pending_bindings: Vec<Binding>,
    // Where the printer stands at what is walked now, and at each node that is pending. A list may be shorter than its nodes until `settle`.
    place: PrintedPlace,
    places_of_pending_expressions: Vec<PrintedPlace>,
    places_of_pending_statements: Vec<PrintedPlace>,
    places_of_pending_bindings: Vec<PrintedPlace>,
}

#[derive(Copy, Clone, Default)]
struct PrintedPlace {
    indentation: u32,
    // In a list that takes values, or in a call, a read, an `in` or an `instanceof` that may fail: an error quotes that whole.
    is_quoted: bool,
    is_in_list_that_takes_values: bool,
}

fn may_be_constructed(function: &G::Fn) -> bool {
    !function.flags.contains(G::FnFlags::IsAsync)
        && !function.flags.contains(G::FnFlags::IsGenerator)
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
            quoted_brackets_over_lines: Vec::new(),
            quoted_functions: Vec::new(),
            assigned_patterns: PositionSet::new(text_length),
            classes_without_parent: Vec::new(),
            functions: Vec::new(),
            statements: Vec::new(),
            initializers: Vec::new(),
            computed_keys: Vec::new(),
            calls: Vec::new(),
            pending_expressions: Vec::new(),
            pending_statements: Vec::new(),
            pending_bindings: Vec::new(),
            place: PrintedPlace::default(),
            places_of_pending_expressions: Vec::new(),
            places_of_pending_statements: Vec::new(),
            places_of_pending_bindings: Vec::new(),
        }
    }

    /// What has been pushed since the last call is printed at `self.place`.
    fn settle(&mut self) {
        let place = self.place;
        let expressions = self.pending_expressions.len();
        self.places_of_pending_expressions
            .resize(expressions, place);
        let statements = self.pending_statements.len();
        self.places_of_pending_statements.resize(statements, place);
        let bindings = self.pending_bindings.len();
        self.places_of_pending_bindings.resize(bindings, place);
    }

    /// What `push` pushes is printed one indentation deeper where `is_deeper`.
    fn push_indented(&mut self, is_deeper: bool, push: impl FnOnce(&mut Self)) {
        self.settle();
        self.place.indentation += u32::from(is_deeper);
        push(self);
        self.settle();
        self.place.indentation -= u32::from(is_deeper);
    }

    /// The body of `if`, of a loop and of a label. A block indents what it holds by itself.
    fn push_body(&mut self, body: Stmt) {
        let is_block = matches!(body.data, StmtData::SBlock(_));
        self.push_indented(!is_block, |walker| walker.pending_statements.push(body));
    }

    fn push_block(&mut self, statements: &[Stmt]) {
        self.push_indented(true, |walker| {
            walker.pending_statements.extend_from_slice(statements);
        });
    }

    fn record_bracket(&mut self, position: Loc, is_single_line: bool) {
        if let Ok(position) = u32::try_from(position.start)
            && !is_single_line
            && self.place.is_quoted
        {
            let indentation = self.place.indentation;
            self.quoted_brackets_over_lines
                .push((position, indentation));
        }
    }

    /// `walk` pushes what a function or a class holds. A quote around it has it as the printer prints it, whole: so what it holds lies in no quote but its own.
    /// `returned`: the function or the class, or an object that holds nothing but the method.
    fn walk_function_or_class(
        &mut self,
        written: Option<WrittenFunction>,
        returned: impl FnOnce() -> Expr,
        walk: impl FnOnce(&mut Self),
    ) {
        self.settle();
        let is_quoted = self.place.is_quoted;
        if is_quoted && let Some(written) = written {
            let returned = returned();
            let statement = S::Return {
                value: Some(returned),
            };
            self.quoted_functions.push(QuotedFunction {
                written,
                is_in_list: self.place.is_in_list_that_takes_values,
                indentation: self.place.indentation,
                printed_alike: Stmt::alloc(statement, returned.loc),
            });
        }
        let is_in_list = self.place.is_in_list_that_takes_values;
        self.place.is_quoted = false;
        self.place.is_in_list_that_takes_values = false;
        walk(self);
        self.settle();
        self.place.is_quoted = is_quoted;
        self.place.is_in_list_that_takes_values = is_in_list;
    }

    /// `[a, { b: [c] }, ...d] = v`
    fn mark_assigned_pattern(&mut self, target: Expr) {
        match target.data {
            ExprData::EArray(_) | ExprData::EObject(_) => self.assigned_patterns.insert(target.loc),
            ExprData::ESpread(rest) => self.mark_assigned_pattern(rest.value),
            ExprData::EBinary(with_default) if with_default.op == OpCode::BinAssign => {
                self.mark_assigned_pattern(with_default.left);
            }
            _ => {}
        }
    }

    fn is_assigned_pattern(&self, target: Expr) -> bool {
        u32::try_from(target.loc.start)
            .is_ok_and(|position| self.assigned_patterns.contains(position))
    }

    fn walk(&mut self) {
        self.settle();
        loop {
            if let Some(expression) = self.pending_expressions.pop() {
                self.place = self.places_of_pending_expressions.pop().unwrap_or_default();
                self.walk_expression(expression);
            } else if let Some(binding) = self.pending_bindings.pop() {
                self.place = self.places_of_pending_bindings.pop().unwrap_or_default();
                self.walk_binding(binding);
            } else if let Some(statement) = self.pending_statements.pop() {
                self.place = self.places_of_pending_statements.pop().unwrap_or_default();
                self.walk_statement(statement);
            } else {
                break;
            }
            self.settle();
        }
        self.quoted_brackets_over_lines.sort_unstable();
        self.accessed_constructions.sort_unstable();
        self.regexp_literals.sort_unstable();
        self.require_main_positions.sort_unstable();
        self.joined_declarators.shared_sort_unstable();
        self.classes_that_assign_fields.sort_unstable();
        self.statements.sort_unstable_by_key(|entry| entry.0);
        self.initializers.sort_unstable_by_key(|entry| entry.0);
        self.computed_keys.sort_unstable_by_key(|entry| entry.0);
        self.calls.sort_unstable_by_key(|entry| entry.0);
    }

    /// After `walk`. Those of the classes, then those of the functions.
    fn find_first_recorded_positions<'s>(
        &self,
        parts: impl Iterator<Item = &'s [Stmt]>,
    ) -> (Vec<(u32, u32)>, Vec<(u32, [Option<u32>; 2])>) {
        if self.classes_without_parent.is_empty() && self.functions.is_empty() {
            return (Vec::new(), Vec::new());
        }
        let variables = &Variables::of_file(self.symbols, parts);
        let joined = &self.joined_declarators;
        let find = |class: &G::Class| {
            let position =
                find_first_recorded_position_of_class(self.symbols, joined, variables, class)?;
            Some((u32::try_from(class.class_keyword.loc.start).ok()?, position))
        };
        // The tree does not say which of the two a function is.
        let find_in_function = |function: &G::Fn| {
            let positions = [true, false].map(|is_strict| {
                find_first_recorded_position(self.symbols, joined, variables, function, is_strict)
            });
            let parameters = u32::try_from(function.open_parens_loc.start).ok()?;
            (positions != [None, None]).then_some((parameters, positions))
        };
        let mut of_functions: Vec<(u32, [Option<u32>; 2])> = self
            .functions
            .iter()
            .filter_map(|function| match function {
                StmtOrExpr::Stmt(Stmt {
                    data: StmtData::SFunction(statement),
                    ..
                }) => find_in_function(&statement.func),
                StmtOrExpr::Expr(Expr {
                    data: ExprData::EFunction(function),
                    ..
                }) => find_in_function(&function.func),
                _ => None,
            })
            .collect();
        of_functions.sort_unstable();
        let classes = self.classes_without_parent.iter();
        let mut positions: Vec<(u32, u32)> = classes
            .filter_map(|class| match class {
                StmtOrExpr::Stmt(Stmt {
                    data: StmtData::SClass(statement),
                    ..
                }) => find(&statement.class),
                StmtOrExpr::Expr(Expr {
                    data: ExprData::EClass(class),
                    ..
                }) => find(class),
                _ => None,
            })
            .collect();
        positions.sort_unstable();
        (positions, of_functions)
    }

    /// After `walk`. A declaration and what is printed for it have one `(`.
    fn find_declarations_printed_without_name(&self, hir: &hir::File<'_>) -> Vec<FnId> {
        let mut expressions: Vec<u32> = (self.functions.iter())
            .filter_map(|function| match function {
                StmtOrExpr::Expr(Expr {
                    data: ExprData::EFunction(function),
                    ..
                }) if function.func.name.is_none() => {
                    u32::try_from(function.func.open_parens_loc.start).ok()
                }
                _ => None,
            })
            .collect();
        expressions.sort_unstable();
        let mut declarations: Vec<FnId> = (hir.stmts.iter())
            .filter_map(|statement| match statement.kind {
                hir::StmtKind::Fn(function) => Some(function),
                _ => None,
            })
            .filter(|&function| expressions.binary_search(&hir[function].anchor).is_ok())
            .collect();
        declarations.sort_unstable();
        declarations
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
        self.push_block(function.body.stmts.slice());
    }

    fn walk_property(&mut self, property: &G::Property) {
        let is_method = property.flags.contains(PropertyFlag::IsMethod)
            || matches!(property.kind, G::PropertyKind::Get | G::PropertyKind::Set);
        let Some(Expr {
            data: ExprData::EFunction(method),
            loc: position,
        }) = property.value.filter(|_| is_method)
        else {
            return self.push_property(property);
        };
        let create_object = || {
            let mut properties = AstAlloc::vec();
            properties.push(G::Property {
                kind: property.kind,
                flags: property.flags,
                key: property.key,
                value: property.value,
                ..Default::default()
            });
            let object = E::Object {
                properties,
                is_single_line: true,
                ..Default::default()
            };
            Expr::init(object, position)
        };
        let body = u32::try_from(method.func.body.loc.start).ok();
        self.walk_function_or_class(
            body.map(|body| WrittenFunction::Method { body }),
            create_object,
            |walker| walker.push_property(property),
        );
    }

    fn push_property(&mut self, property: &G::Property) {
        self.pending_expressions
            .extend_from_slice(&property.ts_decorators);
        self.pending_expressions.extend(property.key);
        self.pending_expressions.extend(property.value);
        self.pending_expressions.extend(property.initializer);
        if let Some(block) = property.class_static_block_ref() {
            self.push_block(&block.stmts);
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
        self.push_indented(true, |walker| {
            for property in class.properties.slice() {
                walker.walk_property(property);
                if let Some(key) = property.key {
                    walker.push_initializer_at(key.loc, property.initializer);
                }
            }
        });
    }

    fn walk_binding(&mut self, binding: Binding) {
        self.bindings.insert(binding.loc);
        match binding.data {
            B::BIdentifier(_) | B::BMissing(_) => {}
            B::BArray(array) => {
                self.place.is_quoted = true;
                self.place.is_in_list_that_takes_values = true;
                self.record_bracket(binding.loc, array.is_single_line);
                self.push_indented(!array.is_single_line, |walker| {
                    for item in array.items() {
                        walker.pending_bindings.push(item.binding);
                        walker.pending_expressions.extend(item.default_value);
                        walker.push_initializer(item.binding, item.default_value);
                    }
                });
            }
            B::BObject(object) => {
                self.record_bracket(binding.loc, object.is_single_line);
                self.push_indented(!object.is_single_line, |walker| {
                    for property in object.properties() {
                        walker.pending_expressions.push(property.key);
                        walker.pending_bindings.push(property.value);
                        walker.pending_expressions.extend(property.default_value);
                        walker.push_initializer(property.value, property.default_value);
                        if let Ok(position) = u32::try_from(property.value.loc.start) {
                            walker.computed_keys.push((position, property.key));
                        }
                    }
                });
            }
        }
    }

    fn find_kind_of_declaration(&self, name: E::Identifier) -> Option<SymbolKind> {
        let symbol = &self.symbols[follow_symbols(self.symbols, name.ref_).inner_index() as usize];
        let is_declaration = matches!(
            symbol.kind,
            SymbolKind::HoistedFunction | SymbolKind::GeneratorOrAsyncFunction | SymbolKind::Class
        );
        let is_stable = !name.must_keep_due_to_with_stmt() && !symbol.has_been_assigned_to();
        (is_declaration && is_stable).then_some(symbol.kind)
    }

    fn may_be_no_function(&self, callee: Expr) -> bool {
        match callee.data {
            ExprData::EFunction(_) | ExprData::EArrow(_) => false,
            ExprData::EIdentifier(name) => !matches!(
                self.find_kind_of_declaration(name),
                Some(SymbolKind::HoistedFunction | SymbolKind::GeneratorOrAsyncFunction)
            ),
            _ => true,
        }
    }

    fn may_be_no_constructor(&self, callee: Expr) -> bool {
        match callee.data {
            ExprData::EClass(_) => false,
            ExprData::EFunction(function) => !may_be_constructed(&function.func),
            ExprData::EIdentifier(name) => !matches!(
                self.find_kind_of_declaration(name),
                Some(SymbolKind::HoistedFunction | SymbolKind::Class)
            ),
            _ => true,
        }
    }

    fn is_written_as_object(object: Expr) -> bool {
        matches!(
            object.data,
            ExprData::EFunction(_)
                | ExprData::EArrow(_)
                | ExprData::EClass(_)
                | ExprData::EObject(_)
                | ExprData::EArray(_)
                | ExprData::ERegExp(_)
                | ExprData::ENew(_)
        )
    }

    fn walk_read_from(&mut self, object: Expr) {
        self.place.is_quoted |= !Self::is_written_as_object(object);
        self.walk_accessed(object);
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
            ExprData::EArray(list) => {
                if self.is_assigned_pattern(expression) {
                    self.place.is_quoted = true;
                    self.place.is_in_list_that_takes_values = true;
                    for &item in list.items.iter() {
                        self.mark_assigned_pattern(item);
                    }
                }
                self.record_bracket(expression.loc, list.is_single_line);
                self.push_indented(!list.is_single_line, |walker| {
                    walker.pending_expressions.extend_from_slice(&list.items);
                });
            }
            ExprData::EUnary(operator) => self.pending_expressions.push(operator.value),
            ExprData::EBinary(operator) => {
                if operator.op == OpCode::BinAssign {
                    self.mark_assigned_pattern(operator.left);
                }
                self.place.is_quoted |= match operator.op {
                    OpCode::BinIn => !Self::is_written_as_object(operator.right),
                    OpCode::BinInstanceof => self.may_be_no_constructor(operator.right),
                    _ => false,
                };
                self.pending_expressions
                    .extend([operator.left, operator.right]);
            }
            ExprData::EClass(class) => {
                if class.extends.is_none() {
                    self.classes_without_parent
                        .push(StmtOrExpr::Expr(expression));
                }
                let keyword = u32::try_from(class.class_keyword.loc.start).ok();
                self.walk_function_or_class(
                    keyword.map(|keyword| WrittenFunction::Class { keyword }),
                    || expression,
                    |walker| walker.walk_class(&class),
                );
            }
            ExprData::ENew(site) => {
                self.push_call_at(expression.loc, expression);
                self.place.is_quoted |= self.may_be_no_constructor(site.target);
                self.pending_expressions.push(site.target);
                self.pending_expressions.extend_from_slice(&site.args);
            }
            ExprData::EFunction(function) => {
                if may_be_constructed(&function.func) {
                    self.functions.push(StmtOrExpr::Expr(expression));
                }
                let body = u32::try_from(function.func.body.loc.start).ok();
                self.walk_function_or_class(
                    body.map(|body| WrittenFunction::Expression { body }),
                    || expression,
                    |walker| walker.walk_function(&function.func),
                );
            }
            ExprData::ECall(site) => {
                self.push_call_at(site.close_paren_loc, expression);
                self.place.is_quoted |= self.may_be_no_function(site.target);
                self.walk_accessed(site.target);
                self.pending_expressions.extend_from_slice(&site.args);
            }
            ExprData::EDot(access) => self.walk_read_from(access.target),
            ExprData::EIndex(access) => {
                self.walk_read_from(access.target);
                self.pending_expressions.push(access.index);
            }
            ExprData::EArrow(arrow) => {
                let body = arrow.body.stmts.slice();
                let is_expression = arrow.prefer_expr
                    && matches!(body, [Stmt { data: StmtData::SReturn(returned), .. }] if returned.value.is_some());
                let start_of_body = u32::try_from(arrow.body.loc.start).ok();
                self.walk_function_or_class(
                    start_of_body.map(|body| WrittenFunction::Expression { body }),
                    || expression,
                    |walker| {
                        walker.walk_arguments(arrow.args.slice());
                        walker.push_indented(!is_expression, |walker| {
                            walker.pending_statements.extend_from_slice(body);
                        });
                    },
                );
            }
            ExprData::EObject(object) => {
                if self.is_assigned_pattern(expression) {
                    for property in object.properties.iter() {
                        if let Some(value) = property.value {
                            self.mark_assigned_pattern(value);
                        }
                    }
                }
                self.record_bracket(expression.loc, object.is_single_line);
                self.push_indented(!object.is_single_line, |walker| {
                    for property in object.properties.iter() {
                        walker.walk_property(property);
                    }
                });
            }
            ExprData::ESpread(spread) => self.pending_expressions.push(spread.value),
            ExprData::ETemplate(template) => {
                if let Some(tag) = template.tag {
                    self.place.is_quoted |= self.may_be_no_function(tag);
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

    /// `[a, b]` of `for ([a, b] of v)` takes values too.
    fn push_loop_target(&mut self, target: Stmt) {
        if let StmtData::SExpr(assigned) = target.data {
            self.mark_assigned_pattern(assigned.value);
        }
        self.pending_statements.push(target);
    }

    fn walk_statement(&mut self, statement: Stmt) {
        if let Ok(position) = u32::try_from(statement.loc.start) {
            self.statements.push((position, statement));
        }
        match statement.data {
            StmtData::SBlock(block) => self.push_block(block.stmts.slice()),
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
                self.push_body(statement.yes);
                match statement.no {
                    Some(no) if matches!(no.data, StmtData::SIf(_)) => {
                        self.pending_statements.push(no);
                    }
                    Some(no) => self.push_body(no),
                    None => {}
                }
            }
            StmtData::SFor(statement) => {
                self.pending_statements.extend(statement.init);
                self.pending_expressions.extend(statement.test);
                self.pending_expressions.extend(statement.update);
                self.push_body(statement.body);
            }
            StmtData::SForIn(statement) => {
                self.push_loop_target(statement.init);
                self.push_body(statement.body);
                self.pending_expressions.push(statement.value);
            }
            StmtData::SForOf(statement) => {
                self.push_loop_target(statement.init);
                self.push_body(statement.body);
                self.pending_expressions.push(statement.value);
            }
            StmtData::SWhile(statement) => {
                self.pending_expressions.push(statement.test);
                self.push_body(statement.body);
            }
            StmtData::SDoWhile(statement) => {
                self.pending_expressions.push(statement.test);
                self.push_body(statement.body);
            }
            StmtData::SSwitch(statement) => {
                self.pending_expressions.push(statement.test);
                self.push_indented(true, |walker| {
                    for case in statement.cases.slice() {
                        walker.pending_expressions.extend(case.value);
                        match case.body.slice() {
                            &[block] if matches!(block.data, StmtData::SBlock(_)) => {
                                walker.pending_statements.push(block);
                            }
                            body => walker.push_block(body),
                        }
                    }
                });
            }
            StmtData::STry(statement) => {
                self.push_block(statement.body.slice());
                if let Some(handler) = &statement.catch {
                    self.pending_bindings.extend(handler.binding);
                    self.push_block(handler.body.slice());
                }
                if let Some(finalizer) = &statement.finally {
                    self.push_block(finalizer.stmts.slice());
                }
            }
            StmtData::SLabel(statement) => self.push_body(statement.stmt),
            StmtData::SWith(statement) => {
                self.pending_expressions.push(statement.value);
                self.push_body(statement.body);
            }
            StmtData::SFunction(declared) => {
                if let Some(name) = &declared.func.name {
                    self.bindings.insert(name.loc);
                }
                if may_be_constructed(&declared.func) {
                    self.functions.push(StmtOrExpr::Stmt(statement));
                }
                self.walk_function(&declared.func);
            }
            StmtData::SClass(declared) => {
                if declared.class.extends.is_none() {
                    self.classes_without_parent
                        .push(StmtOrExpr::Stmt(statement));
                }
                self.walk_class(&declared.class);
            }
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
