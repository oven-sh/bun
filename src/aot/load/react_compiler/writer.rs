use super::module_items::{ModuleItems, finish_file};
use bun_ast::{ImportRecord, Loc, Ref, Stmt, StmtData, StmtTag, flags};
use bun_core::StackCheck;
use bun_react_compiler::{AddedImport, CompiledFunction, ObservedSymbol, SymbolOrigin};
use bun_sema::atom::{Atom, Interner};
use bun_sema::hir::{
    ExprId, ExprKind, File, FileBuilder, Flags, FnBody, FnId, Keyword, ListAt, TypeNodeId,
    TypeNodeKind,
};
use bun_sema::resolve::JsxSettings;
use bun_sema::session::Arena;
use rustc_hash::{FxHashMap, FxHashSet};

#[derive(Debug)]
pub(super) struct UnsupportedNode(pub &'static str);

impl UnsupportedNode {
    pub(super) fn statement(tag: StmtTag) -> UnsupportedNode {
        UnsupportedNode(tag.into())
    }
}

pub(super) type Written<T> = Result<T, UnsupportedNode>;

pub(super) struct TreeWriter<'a, 's> {
    pub(super) file: FileBuilder,
    pub(super) atoms: &'a Interner<'s>,
    pub(super) jsx: &'a JsxSettings,
    pub(super) items: ModuleItems,
    pub(super) function: FunctionContext,
    pub(super) stack: StackCheck,
    written_type_arguments: FxHashMap<(u32, u32), ListAt<TypeNodeId>>,
    source_ranges: SourceRanges,
    /// Names of the module-level items the compiler added, by `Ref::inner_index()`. Functions share them.
    item_names: FxHashMap<u32, Atom>,
}

#[derive(Default)]
pub(super) struct FunctionContext {
    /// By `Ref::inner_index()`.
    names: FxHashMap<u32, (Atom, SymbolOrigin)>,
    pub import_paths: Vec<Box<[u8]>>,
    used_ranges: FxHashMap<(u32, NodeShape), usize>,
    has_unknown_symbol: bool,
    pub fallback_position: u32,
    pub last_position: u32,
    pub is_strict: bool,
    pub is_strict_by_syntax: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(super) enum NodeShape {
    Call,
    New,
    Member,
    Function,
    Other,
}

/// The end offset of every expression in the source file. The compiler's output only has start offsets.
struct SourceRanges(Vec<(u32, NodeShape, u32)>);

impl SourceRanges {
    fn new(file: &FileBuilder) -> SourceRanges {
        let mut ranges: Vec<(u32, NodeShape, u32)> = (file.exprs.iter())
            .map(|expression| {
                let shape = match expression.kind {
                    ExprKind::Call(_) | ExprKind::TaggedTemplate(_) => NodeShape::Call,
                    ExprKind::New(_) => NodeShape::New,
                    ExprKind::Dot { .. } | ExprKind::Index { .. } => NodeShape::Member,
                    ExprKind::Fn(_) => NodeShape::Function,
                    _ => NodeShape::Other,
                };
                (expression.pos, shape, expression.end)
            })
            .collect();
        ranges.sort_unstable();
        SourceRanges(ranges)
    }

    /// The expressions of one shape that start at `start`, innermost first.
    fn starting_at(&self, start: u32, shape: NodeShape) -> &[(u32, NodeShape, u32)] {
        let first = self
            .0
            .partition_point(|range| (range.0, range.1) < (start, shape));
        let count = self.0[first..].partition_point(|range| (range.0, range.1) == (start, shape));
        &self.0[first..first + count]
    }
}

fn find_written_type_arguments(file: &FileBuilder) -> FxHashMap<(u32, u32), ListAt<TypeNodeId>> {
    let mut found = FxHashMap::default();
    for expression in &file.exprs {
        if let ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) =
            expression.kind
            && !file[call].type_args.is_empty()
        {
            found.insert((expression.pos, expression.end), file[call].type_args);
        }
    }
    found
}

impl<'a, 's> TreeWriter<'a, 's> {
    pub(super) fn new(
        file: FileBuilder,
        atoms: &'a Interner<'s>,
        jsx: &'a JsxSettings,
    ) -> TreeWriter<'a, 's> {
        TreeWriter {
            written_type_arguments: find_written_type_arguments(&file),
            source_ranges: SourceRanges::new(&file),
            item_names: FxHashMap::default(),
            file,
            atoms,
            jsx,
            items: ModuleItems::default(),
            function: FunctionContext::default(),
            stack: StackCheck::init(),
        }
    }

    pub(super) fn replace_function(
        &mut self,
        function: FnId,
        compiled: &CompiledFunction<'_>,
    ) -> Written<()> {
        self.function = self.create_function_context(function, compiled);
        let original = self.file[function];
        let first_expression = self.file.exprs.len();
        let params = self.write_parameters(compiled.parameters, compiled.flags, original.params)?;
        let body = self.write_statement_list(compiled.body)?;
        let this_param = self.write_this_parameter(original.kind, first_expression, original.start);
        for statement in compiled.outlined {
            self.write_outlined_function(statement)?;
        }
        if self.function.has_unknown_symbol {
            return Err(UnsupportedNode("symbol without a name"));
        }
        self.add_body_start(function);
        let is_async = compiled.flags.contains(flags::Function::IsAsync);
        let is_generator = compiled.flags.contains(flags::Function::IsGenerator);
        let record = &mut self.file[function];
        debug_assert_eq!(record.flags.contains(Flags::ASYNC), is_async);
        debug_assert_eq!(record.flags.contains(Flags::GENERATOR), is_generator);
        record.flags.set(Flags::ASYNC, is_async);
        record.flags.set(Flags::GENERATOR, is_generator);
        record.flags.insert(Flags::REPLACED_BODY);
        record.params = params;
        if this_param.is_some() {
            record.this_param = this_param;
        }
        record.body = FnBody::Block(body);
        Ok(())
    }

    pub(super) fn add_imports(&mut self, imports: &[AddedImport<'_>]) {
        for import in imports {
            // No compiled function references an import without a name.
            if let Some(&local) = self.item_names.get(&import.local.inner_index()) {
                self.items.add_import(import.path, import.imported, local);
            }
        }
    }

    pub(super) fn into_file(mut self, arena: &'s Arena) -> File<'s> {
        self.items.write(&mut self.file, self.atoms);
        finish_file(self.file, arena, self.atoms)
    }

    /// The compiler's tree has no types.
    pub(super) fn type_arguments_of_call(&self, range: (u32, u32)) -> ListAt<TypeNodeId> {
        let written = self.written_type_arguments.get(&range);
        written.copied().unwrap_or(ListAt::EMPTY)
    }

    pub(super) fn name_of(&mut self, reference: Ref) -> Atom {
        match self.function.names.get(&reference.inner_index()) {
            Some(&(name, _)) => name,
            None => {
                self.function.has_unknown_symbol = true;
                Atom::NONE
            }
        }
    }

    pub(super) fn origin_of(&self, reference: Ref) -> SymbolOrigin {
        let known = self.function.names.get(&reference.inner_index());
        known.map_or(SymbolOrigin::Source, |&(_, origin)| origin)
    }

    pub(super) fn range_of(&mut self, loc: Loc) -> (u32, u32) {
        self.range_of_shape(loc, NodeShape::Other)
    }

    /// Every node of a chain like `a.b().c()` starts at the same offset, so call this for inner nodes first.
    pub(super) fn range_of_shape(&mut self, loc: Loc, shape: NodeShape) -> (u32, u32) {
        let fallback = self.function.fallback_position;
        self.source_range_of(loc, shape)
            .unwrap_or((fallback, fallback))
    }

    pub(super) fn identifier(&mut self, reference: Ref, loc: Loc) -> ExprId {
        // TypeScript orders a use and its declaration by position: a use without one comes after every declaration.
        let last = self.function.last_position;
        let (start, end) = self
            .source_range_of(loc, NodeShape::Other)
            .unwrap_or((last, last));
        let name = self.name_of(reference);
        self.file.expr(ExprKind::Ident(name), start, end)
    }

    pub(super) fn any_type(&mut self, position: u32) -> TypeNodeId {
        let kind = TypeNodeKind::Keyword(Keyword::Any);
        self.file.ty(kind, position, position)
    }

    fn source_range_of(&mut self, loc: Loc, shape: NodeShape) -> Option<(u32, u32)> {
        let start = u32::try_from(loc.start).ok()?;
        let ranges = self.source_ranges.starting_at(start, shape);
        let index = match shape {
            NodeShape::Call | NodeShape::New | NodeShape::Member => {
                let used = self.function.used_ranges.entry((start, shape)).or_insert(0);
                *used += 1;
                (*used - 1).min(ranges.len().saturating_sub(1))
            }
            NodeShape::Function | NodeShape::Other => 0,
        };
        Some((start, ranges.get(index).map_or(start, |range| range.2)))
    }

    fn create_function_context(
        &mut self,
        function: FnId,
        compiled: &CompiledFunction<'_>,
    ) -> FunctionContext {
        let record = self.file[function];
        let outside = (compiled.symbols.iter()).filter(|it| it.origin == SymbolOrigin::Source);
        let outside_names: FxHashSet<&[u8]> = outside.map(|symbol| symbol.name).collect();
        let mut names = FxHashMap::default();
        for symbol in compiled.symbols {
            let name = self.resolve_symbol_name(symbol, &outside_names);
            names.insert(symbol.reference.inner_index(), (name, symbol.origin));
        }
        let path_of = |record: &ImportRecord<'_>| Box::from(record.path.text);
        FunctionContext {
            names,
            import_paths: compiled.import_records.iter().map(path_of).collect(),
            used_ranges: FxHashMap::default(),
            has_unknown_symbol: false,
            last_position: self.end_of_top_level_statement_at(record.start),
            fallback_position: record.start,
            is_strict: record.is_strict,
            is_strict_by_syntax: record.is_strict_by_syntax,
        }
    }

    fn end_of_top_level_statement_at(&self, position: u32) -> u32 {
        let mut statements = self.file.ids(self.file.body).map(|id| self.file[id].loc);
        let around = statements.find(|range| range.pos <= position && position < range.end);
        around.map_or(position, |range| range.end)
    }

    fn resolve_symbol_name(
        &mut self,
        symbol: &ObservedSymbol<'_>,
        outside_names: &FxHashSet<&[u8]>,
    ) -> Atom {
        match symbol.origin {
            // The compiler keeps two symbols with one name apart by `Ref`. This tree binds by name.
            SymbolOrigin::Local if outside_names.contains(symbol.name) => {
                ModuleItems::name_shadowing_local(self.atoms, symbol.name)
            }
            SymbolOrigin::Source | SymbolOrigin::Local | SymbolOrigin::NamespaceMember(_) => {
                self.atoms.intern(symbol.name)
            }
            _ => {
                let index = symbol.reference.inner_index();
                if let Some(&name) = self.item_names.get(&index) {
                    return name;
                }
                let name = self.items.name_of(self.atoms, self.jsx, symbol);
                self.item_names.insert(index, name);
                name
            }
        }
    }

    fn write_outlined_function(&mut self, statement: &Stmt) -> Written<()> {
        let StmtData::SFunction(outlined) = &statement.data else {
            return Err(UnsupportedNode::statement(statement.data.tag()));
        };
        let declaration = self.write_function_declaration(&outlined.func, statement.loc)?;
        self.items.outlined.push(declaration);
        Ok(())
    }

    fn add_body_start(&mut self, function: FnId) {
        let body = self.file[function].body;
        match body {
            FnBody::None | FnBody::Block(_) => {}
            FnBody::Expr(expression) => {
                let start = self.file[expression].pos;
                let starts = &mut self.file.body_starts;
                let at = starts.partition_point(|entry| entry.0 < function);
                starts.insert(at, (function, start));
            }
        }
    }
}
