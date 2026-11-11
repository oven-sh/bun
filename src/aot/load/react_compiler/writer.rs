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
    top_level_statements: Vec<TextRange>,
    places: Option<Places>,
    outlined_into_lists: Vec<(ListHolder, StmtId, StmtId)>,
    new_body_starts: Vec<(FnId, u32)>,
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

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum ListHolder {
    Block(StmtId),
    Case(CaseId),
    Function(FnId),
    Namespace(ModuleId),
}

#[derive(Copy, Clone)]
enum Place {
    BehindStatement(ListHolder, StmtId),
    TestOfCase(CaseId),
    ExpressionOfFunction(FnId, ExprId),
    OnlyStatementOfLoop(StmtId, StmtId),
    Head(FnId),
}

struct PlaceInFile {
    start: u32,
    end: u32,
    place: Place,
    around: u32,
}

struct Places(Vec<PlaceInFile>);

impl Places {
    const NOTHING_AROUND: u32 = u32::MAX;

    fn new(file: &FileBuilder) -> Places {
        let mut places = Vec::new();
        let around = Places::NOTHING_AROUND;
        let mut add = |start: u32, end: u32, place: Place| {
            if start < end {
                places.push(PlaceInFile {
                    start,
                    end,
                    place,
                    around,
                });
            }
        };
        let blocks = (0..file.stmts.len() as u32).map(|id| ListHolder::Block(StmtId(id)));
        let cases = (0..file.cases.len() as u32).map(|id| ListHolder::Case(CaseId(id)));
        let functions = (0..file.fns.len() as u32).map(|id| ListHolder::Function(FnId(id)));
        let namespaces =
            (0..file.modules.len() as u32).map(|id| ListHolder::Namespace(ModuleId(id)));
        for holder in blocks.chain(cases).chain(functions).chain(namespaces) {
            if let ListHolder::Case(case) = holder
                && file[case].test.is_some()
            {
                let test = file[file[case].test];
                add(test.pos, test.end, Place::TestOfCase(case));
            }
            for statement in file.ids(list_of(file, holder)) {
                let range = file[statement].loc;
                add(
                    range.pos,
                    range.end,
                    Place::BehindStatement(holder, statement),
                );
            }
        }
        for (index, function) in file.fns.iter().enumerate() {
            if let FnBody::Expr(body) = function.body {
                let place = Place::ExpressionOfFunction(FnId(index as u32), body);
                add(file[body].pos, file[body].end, place);
            }
        }
        for (index, statement) in file.stmts.iter().enumerate() {
            if let StmtKind::For { body, .. }
            | StmtKind::ForIn { body, .. }
            | StmtKind::ForOf { body, .. } = statement.kind
                && !matches!(file[body].kind, StmtKind::Block(_))
            {
                let place = Place::OnlyStatementOfLoop(StmtId(index as u32), body);
                add(file[body].loc.pos, file[body].loc.end, place);
            }
        }
        for (index, function) in file.fns.iter().enumerate() {
            let end = match function.body {
                FnBody::Expr(body) => file[body].pos,
                FnBody::Block(_) => {
                    let starts = &file.body_starts;
                    let at = starts.binary_search_by_key(&(index as u32), |entry| entry.0.0);
                    at.map_or(function.start, |at| starts[at].1)
                }
                FnBody::None => function.start,
            };
            add(function.start, end, Place::Head(FnId(index as u32)));
        }
        for statement in &file.stmts {
            match statement.kind {
                StmtKind::For {
                    init: head, body, ..
                }
                | StmtKind::ForIn {
                    left: head, body, ..
                }
                | StmtKind::ForOf {
                    left: head, body, ..
                } if head.is_some() && matches!(file[head].kind, StmtKind::Var(_)) => {
                    add(
                        statement.loc.pos,
                        file[body].loc.pos,
                        Place::Head(FnId::NONE),
                    );
                }
                StmtKind::Try { param, .. } if param.is_some() => {
                    add(
                        file[param].loc.pos,
                        file[param].loc.end,
                        Place::Head(FnId::NONE),
                    );
                }
                _ => {}
            }
        }
        places.sort_by_u32(|place| place.start);
        let mut open: Vec<u32> = Vec::new();
        for index in 0..places.len() {
            let start = places[index].start;
            while open
                .last()
                .is_some_and(|&last| places[last as usize].end <= start)
            {
                open.pop();
            }
            places[index].around = open.last().copied().unwrap_or(Places::NOTHING_AROUND);
            open.push(index as u32);
        }
        Places(places)
    }

    fn find_innermost_around(&self, function: FnId, position: u32) -> Option<usize> {
        let behind = self.0.partition_point(|place| place.start <= position);
        let mut at = behind.checked_sub(1)?;
        loop {
            let found = &self.0[at];
            let is_own_head = matches!(found.place, Place::Head(of) if of == function);
            if position < found.end && !is_own_head {
                return Some(at);
            }
            if found.around == Places::NOTHING_AROUND {
                return None;
            }
            at = found.around as usize;
        }
    }
}

fn list_of(file: &FileBuilder, holder: ListHolder) -> IdList<StmtId> {
    match holder {
        ListHolder::Block(block) => match file[block].kind {
            StmtKind::Block(list) => list,
            _ => IdList::EMPTY,
        },
        ListHolder::Case(case) => file[case].body,
        ListHolder::Function(function) => match file[function].body {
            FnBody::Block(list) => list,
            FnBody::None | FnBody::Expr(_) => IdList::EMPTY,
        },
        ListHolder::Namespace(namespace) => file[namespace].body,
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

fn top_level_statements_by_position(file: &FileBuilder) -> Vec<TextRange> {
    let mut ranges: Vec<TextRange> = file.ids(file.body).map(|id| file[id].loc).collect();
    ranges.sort_by_u32(|range| range.pos);
    ranges
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
            top_level_statements: top_level_statements_by_position(&file),
            places: None,
            outlined_into_lists: Vec::new(),
            new_body_starts: Vec::new(),
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
        let mut statements: Vec<StmtId> = self.file.ids(body).collect();
        for statement in compiled.outlined {
            statements.extend(self.write_outlined_function(statement, function)?);
        }
        if statements.len() > body.len() {
            body = self.file.list(&statements);
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
        self.lay_outlined_functions_into_lists();
        self.file.body_starts.append(&mut self.new_body_starts);
        self.file.body_starts.sort_by_u32(|entry| entry.0.0);
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
        let statements = &self.top_level_statements;
        let around = statements.get(statements.partition_point(|range| range.end <= position));
        let around = around.filter(|range| range.pos <= position);
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
        match self.find_place_around(outlined_from) {
            None => self.items.outlined.push(declaration),
            Some(Place::Head(_)) => return Ok(Some(declaration)),
            Some(Place::TestOfCase(case)) => {
                let in_front = (ListHolder::Case(case), StmtId::NONE, declaration);
                self.outlined_into_lists.push(in_front);
            }
            Some(Place::BehindStatement(holder, statement)) => {
                self.outlined_into_lists
                    .push((holder, statement, declaration));
            }
            Some(Place::ExpressionOfFunction(..) | Place::OnlyStatementOfLoop(..)) => {
                unreachable!()
            }
        }
        Ok(None)
    }

    fn find_place_around(&mut self, function: FnId) -> Option<Place> {
        let mut places = (self.places.take()).unwrap_or_else(|| Places::new(&self.file));
        let at = places.find_innermost_around(function, self.file[function].start);
        if let Some(at) = at {
            places.0[at].place = match places.0[at].place {
                Place::ExpressionOfFunction(arrow, body) => {
                    self.add_body_start(arrow);
                    let (pos, end) = (self.file[body].pos, self.file[body].end);
                    let returned = self.file.add_stmt_node(hir::Stmt {
                        kind: StmtKind::Return(body),
                        start: pos,
                        loc: TextRange { pos, end },
                    });
                    self.file[arrow].body = FnBody::Block(self.file.list(&[returned]));
                    Place::BehindStatement(ListHolder::Function(arrow), returned)
                }
                Place::OnlyStatementOfLoop(holder, body) => {
                    let kind = StmtKind::Block(self.file.list(&[body]));
                    let written = self.file[body];
                    let block = self.file.add_stmt_node(hir::Stmt { kind, ..written });
                    match &mut self.file[holder].kind {
                        StmtKind::For { body, .. }
                        | StmtKind::ForIn { body, .. }
                        | StmtKind::ForOf { body, .. } => *body = block,
                        _ => unreachable!(),
                    }
                    Place::BehindStatement(ListHolder::Block(block), body)
                }
                place => place,
            };
        }
        let place = at.map(|at| places.0[at].place);
        self.places = Some(places);
        place
    }

    fn lay_outlined_functions_into_lists(&mut self) {
        let mut holders = Vec::new();
        let mut outlined: FxHashMap<(ListHolder, StmtId), Vec<StmtId>> = FxHashMap::default();
        let mut seen = FxHashSet::default();
        for (holder, statement, declaration) in std::mem::take(&mut self.outlined_into_lists) {
            if seen.insert(holder) {
                holders.push(holder);
            }
            let behind = outlined.entry((holder, statement)).or_default();
            behind.push(declaration);
        }
        for holder in holders {
            let in_front = outlined.remove(&(holder, StmtId::NONE));
            let mut statements = in_front.unwrap_or_default();
            for statement in self.file.ids(list_of(&self.file, holder)) {
                statements.push(statement);
                let behind = outlined.get(&(holder, statement));
                statements.extend(behind.into_iter().flatten());
            }
            let list = self.file.list(&statements);
            match holder {
                ListHolder::Block(block) => self.file[block].kind = StmtKind::Block(list),
                ListHolder::Case(case) => self.file[case].body = list,
                ListHolder::Function(function) => self.file[function].body = FnBody::Block(list),
                ListHolder::Namespace(namespace) => self.file[namespace].body = list,
            }
        }
    }

    fn add_body_start(&mut self, function: FnId) {
        let body = self.file[function].body;
        match body {
            FnBody::None | FnBody::Block(_) => {}
            FnBody::Expr(expression) => {
                let start = self.file[expression].pos;
                self.new_body_starts.push((function, start));
            }
        }
    }
}
