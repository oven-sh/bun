use super::module_items::{ModuleItems, finish_file};
use bun_ast::{ImportRecord, Loc, Ref, Stmt, StmtData, StmtTag, flags};
use bun_core::StackCheck;
use bun_react_compiler::{AddedImport, CompiledFunction, ObservedSymbol, SymbolOrigin};
use bun_sema::atom::{Atom, Interner};
use bun_sema::hir::{
    self, CaseId, ExprId, ExprKind, File, FileBuilder, Flags, FnBody, FnId, IdList, Keyword,
    ListAt, ModuleId, StmtId, StmtKind, TextRange, TypeNodeId, TypeNodeKind,
};
use bun_sema::module_format::ModuleFormat;
use bun_sema::resolve::JsxSettings;
use bun_sema::session::Arena;
use bun_sort_by_number::{SortByNumber, number_of_pair};
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
    item_names: FxHashMap<u32, Atom>,
    outlined_into_lists: FxHashSet<StmtId>,
}

#[derive(Default)]
pub(super) struct FunctionContext {
    names: FxHashMap<u32, (Atom, SymbolOrigin)>,
    pub import_paths: Vec<Box<[u8]>>,
    used_ranges: FxHashMap<(u32, NodeShape), usize>,
    has_unknown_symbol: bool,
    pub fallback_position: u32,
    pub last_position: u32,
    pub is_strict: bool,
    pub is_strict_by_syntax: bool,
}

#[derive(Copy, Clone)]
enum ListHolder {
    File,
    Block(StmtId),
    Case(CaseId),
    Function(FnId),
    Namespace(ModuleId),
}

#[derive(Copy, Clone)]
enum BodyWithoutList {
    Expression(FnId, ExprId),
    Statement(StmtId, StmtId),
}

fn body_in_scope_of_head(kind: StmtKind) -> Option<StmtId> {
    match kind {
        StmtKind::For { body, .. }
        | StmtKind::ForIn { body, .. }
        | StmtKind::ForOf { body, .. } => Some(body),
        _ => None,
    }
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(super) enum NodeShape {
    Call,
    New,
    Member,
    Function,
    Other,
}

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
        ranges.sort_by_u32(|range| range.2);
        ranges.sort_by_u64(|range| number_of_pair(range.0, range.1 as u32));
        SourceRanges(ranges)
    }

    fn not_before(&self, start: u32, shape: NodeShape) -> &[(u32, NodeShape, u32)] {
        let number = number_of_pair(start, shape as u32);
        let first = self
            .0
            .partition_point(|range| number_of_pair(range.0, range.1 as u32) < number);
        &self.0[first..]
    }

    fn first_starting_at(&self, start: u32, shape: NodeShape) -> Option<&(u32, NodeShape, u32)> {
        let first = self.not_before(start, shape).first();
        first.filter(|range| (range.0, range.1) == (start, shape))
    }

    fn starting_at(&self, start: u32, shape: NodeShape) -> &[(u32, NodeShape, u32)] {
        let rest = self.not_before(start, shape);
        &rest[..rest.partition_point(|range| (range.0, range.1) == (start, shape))]
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
            outlined_into_lists: FxHashSet::default(),
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
        let mut body = self.write_statement_list(compiled.body)?;
        let this_param = self.write_this_parameter(original.kind, first_expression, original.start);
        for statement in compiled.outlined {
            if let Some(declaration) = self.write_outlined_function(statement, function)? {
                let statements: Vec<StmtId> = self.file.ids(body).chain([declaration]).collect();
                body = self.file.list(&statements);
            }
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
            if let Some(&local) = self.item_names.get(&import.local.inner_index()) {
                self.items.add_import(import.path, import.imported, local);
            }
        }
    }

    pub(super) fn into_file(mut self, arena: &'s Arena, format: ModuleFormat) -> File<'s> {
        self.items.write(&mut self.file, self.atoms, format);
        finish_file(self.file, arena, self.atoms)
    }

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

    pub(super) fn range_of_shape(&mut self, loc: Loc, shape: NodeShape) -> (u32, u32) {
        let fallback = self.function.fallback_position;
        self.source_range_of(loc, shape)
            .unwrap_or((fallback, fallback))
    }

    pub(super) fn identifier(&mut self, reference: Ref, loc: Loc) -> ExprId {
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
        let range = match shape {
            NodeShape::Call | NodeShape::New | NodeShape::Member => {
                let ranges = self.source_ranges.starting_at(start, shape);
                let used = self.function.used_ranges.entry((start, shape)).or_insert(0);
                *used += 1;
                ranges.get((*used - 1).min(ranges.len().saturating_sub(1)))
            }
            NodeShape::Function | NodeShape::Other => {
                self.source_ranges.first_starting_at(start, shape)
            }
        };
        Some((start, range.map_or(start, |range| range.2)))
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
            last_position: self.last_position_of_top_level_statement_at(record.start),
            fallback_position: record.start,
            is_strict: record.is_strict,
            is_strict_by_syntax: record.is_strict_by_syntax,
        }
    }

    fn last_position_of_top_level_statement_at(&self, position: u32) -> u32 {
        let mut statements = self.file.ids(self.file.body).map(|id| self.file[id].loc);
        let around = statements.find(|range| range.pos <= position && position < range.end);
        around.map_or(position, |range| range.end - 1)
    }

    fn resolve_symbol_name(
        &mut self,
        symbol: &ObservedSymbol<'_>,
        outside_names: &FxHashSet<&[u8]>,
    ) -> Atom {
        match symbol.origin {
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

    fn write_outlined_function(
        &mut self,
        statement: &Stmt,
        outlined_from: FnId,
    ) -> Written<Option<StmtId>> {
        let StmtData::SFunction(outlined) = &statement.data else {
            return Err(UnsupportedNode::statement(statement.data.tag()));
        };
        let declaration = self.write_function_declaration(&outlined.func, statement.loc)?;
        let position = self.file[outlined_from].start;
        self.give_list_to_innermost_body_around(position);
        let (holder, index, start) = self.find_statement_around(position);
        if self.stands_in_head_behind(start, outlined_from) {
            return Ok(Some(declaration));
        }
        match holder {
            ListHolder::File => self.items.outlined.push(declaration),
            holder => {
                let mut statements: Vec<StmtId> = self.file.ids(self.list_of(holder)).collect();
                let earlier = statements[index + 1..].iter();
                let earlier = earlier.take_while(|it| self.outlined_into_lists.contains(it));
                statements.insert(index + 1 + earlier.count(), declaration);
                self.outlined_into_lists.insert(declaration);
                let list = self.file.list(&statements);
                match holder {
                    ListHolder::File => unreachable!(),
                    ListHolder::Block(block) => self.file[block].kind = StmtKind::Block(list),
                    ListHolder::Case(case) => self.file[case].body = list,
                    ListHolder::Function(function) => {
                        self.file[function].body = FnBody::Block(list);
                    }
                    ListHolder::Namespace(namespace) => self.file[namespace].body = list,
                }
            }
        }
        Ok(None)
    }

    fn give_list_to_innermost_body_around(&mut self, position: u32) {
        let file = &self.file;
        let mut innermost = (self.find_statement_around(position).2, None);
        let mut look_at = |pos: u32, end: u32, body: BodyWithoutList| {
            if pos <= position && position < end && pos >= innermost.0 {
                innermost = (pos, Some(body));
            }
        };
        for (index, function) in file.fns.iter().enumerate() {
            if let FnBody::Expr(body) = function.body {
                let function = FnId(index as u32);
                look_at(
                    file[body].pos,
                    file[body].end,
                    BodyWithoutList::Expression(function, body),
                );
            }
        }
        for (index, statement) in file.stmts.iter().enumerate() {
            if let Some(body) = body_in_scope_of_head(statement.kind)
                && !matches!(file[body].kind, StmtKind::Block(_))
            {
                let range = file[body].loc;
                look_at(
                    range.pos,
                    range.end,
                    BodyWithoutList::Statement(StmtId(index as u32), body),
                );
            }
        }
        match innermost.1 {
            None => {}
            Some(BodyWithoutList::Expression(function, body)) => {
                self.add_body_start(function);
                let (pos, end) = (self.file[body].pos, self.file[body].end);
                let returned = self.file.add_stmt_node(hir::Stmt {
                    kind: StmtKind::Return(body),
                    start: pos,
                    loc: TextRange { pos, end },
                });
                self.file[function].body = FnBody::Block(self.file.list(&[returned]));
            }
            Some(BodyWithoutList::Statement(holder, body)) => {
                let kind = StmtKind::Block(self.file.list(&[body]));
                let written = self.file[body];
                let block = self.file.add_stmt_node(hir::Stmt { kind, ..written });
                match &mut self.file[holder].kind {
                    StmtKind::For { body, .. }
                    | StmtKind::ForIn { body, .. }
                    | StmtKind::ForOf { body, .. } => *body = block,
                    _ => unreachable!(),
                }
            }
        }
    }

    fn stands_in_head_behind(&self, start: u32, function: FnId) -> bool {
        let file = &self.file;
        let position = file[function].start;
        let is_around = |pos: u32, end: u32| start <= pos && pos <= position && position < end;
        let end_of_head = |index: usize, other: &hir::Func| match other.body {
            FnBody::Expr(body) => file[body].pos,
            FnBody::Block(_) => {
                let starts = &file.body_starts;
                let at = starts.binary_search_by_key(&(index as u32), |entry| entry.0.0);
                at.map_or(other.start, |at| starts[at].1)
            }
            FnBody::None => other.start,
        };
        let mut functions = file.fns.iter().enumerate();
        let mut statements = file.stmts.iter();
        functions.any(|(index, other)| {
            index != function.idx() && is_around(other.start, end_of_head(index, other))
        }) || statements.any(|statement| match statement.kind {
            StmtKind::For {
                init: head, body, ..
            }
            | StmtKind::ForIn {
                left: head, body, ..
            }
            | StmtKind::ForOf {
                left: head, body, ..
            } => {
                head.is_some()
                    && matches!(file[head].kind, StmtKind::Var(_))
                    && is_around(statement.loc.pos, file[body].loc.pos)
            }
            StmtKind::Try { param, .. } => {
                param.is_some() && is_around(file[param].loc.pos, file[param].loc.end)
            }
            _ => false,
        })
    }

    fn list_of(&self, holder: ListHolder) -> IdList<StmtId> {
        match holder {
            ListHolder::File => self.file.body,
            ListHolder::Block(block) => match self.file[block].kind {
                StmtKind::Block(list) => list,
                _ => IdList::EMPTY,
            },
            ListHolder::Case(case) => self.file[case].body,
            ListHolder::Function(function) => match self.file[function].body {
                FnBody::Block(list) => list,
                FnBody::None | FnBody::Expr(_) => IdList::EMPTY,
            },
            ListHolder::Namespace(namespace) => self.file[namespace].body,
        }
    }

    fn find_statement_around(&self, position: u32) -> (ListHolder, usize, u32) {
        let file = &self.file;
        let blocks = (0..file.stmts.len() as u32).map(|id| ListHolder::Block(StmtId(id)));
        let cases = (0..file.cases.len() as u32).map(|id| ListHolder::Case(CaseId(id)));
        let functions = (0..file.fns.len() as u32).map(|id| ListHolder::Function(FnId(id)));
        let namespaces =
            (0..file.modules.len() as u32).map(|id| ListHolder::Namespace(ModuleId(id)));
        let mut innermost = (ListHolder::File, 0, 0);
        for holder in blocks.chain(cases).chain(functions).chain(namespaces) {
            for (index, statement) in file.ids(self.list_of(holder)).enumerate() {
                let range = file[statement].loc;
                if range.pos <= position && position < range.end && range.pos >= innermost.2 {
                    innermost = (holder, index, range.pos);
                }
            }
        }
        innermost
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
