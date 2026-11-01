//! Where a file counts how often it runs, for `bun test --aot --coverage`.
//!
//! The places are those of JavaScriptCore's control flow profiler (`emitProfileControlFlow` in NodesCodegen.cpp), which `bun test --coverage`
//! reads: each is a range of the text with a counter, and a piece of text ran as often as the smallest range that holds it. Here the ranges
//! are in the text of the file as it is written, not in what the transpiler prints.

use bun_sema::bind::{Bound, FnOwner};
use bun_sema::hir::{
    self, BinOp, CaseId, Chain, DecoratorOwner, ExprId, ExprKind, Flags, FnBody, FnId, FnKind,
    IdList, MemberKind, StmtId, StmtKind, VarKind,
};
use rustc_hash::FxHashMap;

use super::{FileLowering, FunctionLowering};
use crate::ir::StringId;

/// The counter of the body of the file.
const FILE_BODY: u32 = 0;

pub(in crate::lower) struct CountedPlaces {
    /// The path of the file, then a line for each counter, which says what text it counts: `b <start> <end>`. For a function:
    /// `f <start> <end> <counter> <end of head>`, with the counter of the code that makes the function, and where its parameters start.
    /// `s <start> <end> <counter>` has no counter of its own: that text runs as often as the text of the counter it names.
    /// `e <start> <end> <counter> <end of head>` has none either: an enum or a namespace, which the transpiler prints as a function that is
    /// called where it stands, in the code of the counter. `o <start> <end> <position>` has none: the transpiler prints that text a second
    /// time, outside the function it stands in, where the text at the position runs.
    description: Vec<u8>,
    interned_description: Option<StringId>,
    count: u32,
    statements: FxHashMap<StmtId, u32>,
    expressions: FxHashMap<ExprId, u32>,
    cases: FxHashMap<CaseId, u32>,
    functions: FxHashMap<FnId, u32>,
    generator_bodies: FxHashMap<FnId, u32>,
    /// By what stands in front of a `?.`.
    rests_of_chains: FxHashMap<ExprId, u32>,
}

/// A function, or the initializer of a field of the objects of a class: JSC compiles the initializers of a class as a function.
struct FunctionRange {
    start: u32,
    end: u32,
    counter: u32,
    /// Index of the one around it.
    parent: Option<usize>,
}

struct Finder<'p, 's> {
    hir: &'p hir::File<'s>,
    places: CountedPlaces,
    /// By where they start.
    functions: Vec<FunctionRange>,
    /// Where a function can be left for good: each `await` and `yield`, in order.
    suspensions: Vec<u32>,
}

fn find_end_of_function(hir: &hir::File<'_>, bound: &Bound<'_>, function: FnId) -> Option<u32> {
    match bound.fns[function.idx()].owner {
        FnOwner::Expr(expression) => Some(hir[expression].end),
        FnOwner::Stmt(statement) => Some(hir[statement].loc.end),
        FnOwner::Member(member) => Some(hir[member].loc.end),
        FnOwner::Type(_) | FnOwner::None => None,
    }
}

impl CountedPlaces {
    pub(in crate::lower) fn find(
        hir: &hir::File<'_>,
        bound: &Bound<'_>,
        path: &[u8],
    ) -> CountedPlaces {
        let mut description = path.to_vec();
        description.push(b'\n');
        let mut finder = Finder {
            hir,
            places: CountedPlaces {
                description,
                interned_description: None,
                count: 0,
                statements: FxHashMap::default(),
                expressions: FxHashMap::default(),
                cases: FxHashMap::default(),
                functions: FxHashMap::default(),
                generator_bodies: FxHashMap::default(),
                rests_of_chains: FxHashMap::default(),
            },
            functions: Vec::new(),
            suspensions: Vec::new(),
        };
        let file_body = finder.add_block(0, hir.source_len);
        debug_assert_eq!(file_body, FILE_BODY);
        finder.find_functions(bound);
        finder.find_suspensions();
        finder.find_statements(bound);
        finder.find_expressions();
        finder.find_rests_of_chains();
        finder.find_printed_functions();
        finder.places
    }
}

impl Finder<'_, '_> {
    fn add(&mut self, kind: u8, start: u32, end: u32, parent: Option<u32>) -> u32 {
        use std::io::Write;
        let description = &mut self.places.description;
        description.push(kind);
        let _ = write!(description, " {start} {end}");
        if let Some(parent) = parent {
            let _ = write!(description, " {parent}");
        }
        description.push(b'\n');
        self.places.count += 1;
        self.places.count - 1
    }

    /// `end_of_head`: no other function starts between `start` and there.
    fn add_function(&mut self, kind: u8, range: (u32, u32), maker: u32, end_of_head: u32) -> u32 {
        use std::io::Write;
        let counter = self.add(kind, range.0, range.1, Some(maker));
        self.places.description.pop();
        let _ = writeln!(self.places.description, " {end_of_head}");
        counter
    }

    fn add_block(&mut self, start: u32, end: u32) -> u32 {
        self.add(b'b', start, end.max(start), None)
    }

    fn find_functions(&mut self, bound: &Bound<'_>) {
        let hir = self.hir;
        let mut ranges: Vec<(u32, u32, Result<FnId, ExprId>)> = Vec::new();
        for member in hir.members.iter() {
            if member.kind == MemberKind::Property
                && !member.flags.contains(Flags::STATIC)
                && let Some(initializer) = member.init.some()
            {
                ranges.push((member.start, hir[initializer].end, Err(initializer)));
            }
        }
        for (index, function) in hir.fns.iter().enumerate() {
            let id = FnId(index as u32);
            let is_counted = match function.kind {
                FnKind::Decl
                | FnKind::Expr
                | FnKind::Arrow
                | FnKind::Method
                | FnKind::Getter
                | FnKind::Setter
                | FnKind::Constructor => !matches!(function.body, FnBody::None),
                // It runs where the class is evaluated, and is no function of the report.
                FnKind::StaticBlock
                | FnKind::CallSignature
                | FnKind::ConstructSignature
                | FnKind::FunctionType
                | FnKind::ConstructorType
                | FnKind::IndexSignature => false,
            };
            if is_counted && let Some(end) = find_end_of_function(hir, bound, id) {
                ranges.push((function.text_start, end, Ok(id)));
            }
        }
        ranges.sort_unstable_by_key(|&(start, end, _)| (start, u32::MAX - end));
        let mut open: Vec<usize> = Vec::new();
        for (start, end, id) in ranges {
            while open
                .last()
                .is_some_and(|&outer| self.functions[outer].end <= start)
            {
                open.pop();
            }
            let parent = open.last().copied();
            let parent_counter = parent.map_or(FILE_BODY, |parent| self.functions[parent].counter);
            let counter = match id {
                Ok(function) => {
                    let end_of_head = hir[function].anchor;
                    let counter =
                        self.add_function(b'f', (start, end), parent_counter, end_of_head);
                    self.places.functions.insert(function, counter);
                    counter
                }
                Err(initializer) => {
                    self.count_expression(initializer, start, end);
                    self.places.expressions[&initializer]
                }
            };
            open.push(self.functions.len());
            self.functions.push(FunctionRange {
                start,
                end,
                counter,
                parent,
            });
        }
    }

    /// The counter of the innermost of them that holds the position.
    fn function_at(&self, position: u32) -> u32 {
        let after = self
            .functions
            .partition_point(|function| function.start <= position);
        let mut candidate = after.checked_sub(1);
        while let Some(index) = candidate {
            let function = &self.functions[index];
            if position < function.end {
                return function.counter;
            }
            candidate = function.parent;
        }
        FILE_BODY
    }

    fn find_suspensions(&mut self) {
        let hir = self.hir;
        for expression in hir.exprs.iter() {
            if matches!(expression.kind, ExprKind::Await(_) | ExprKind::Yield { .. }) {
                self.suspensions.push(expression.pos);
            }
        }
        for statement in hir.stmts.iter() {
            let suspends = match statement.kind {
                StmtKind::ForOf { is_await, .. } => is_await,
                StmtKind::Var(declarations) => {
                    let mut declarations = declarations.iter();
                    declarations.any(|declaration| hir[declaration].kind == VarKind::AwaitUsing)
                }
                _ => false,
            };
            if suspends {
                self.suspensions.push(statement.start);
            }
        }
        self.suspensions.sort_unstable();
    }

    fn suspends(&self, statement: StmtId) -> bool {
        let statement = &self.hir[statement];
        let first = self.suspensions.partition_point(|&at| at < statement.start);
        let inside = self.suspensions[first..]
            .iter()
            .take_while(|&&at| at < statement.loc.end);
        let function = self.function_at(statement.start);
        inside.clone().any(|&at| self.function_at(at) == function)
    }

    /// Control can leave the statement for elsewhere than the statement behind it.
    fn can_be_left(&self, statement: StmtId) -> bool {
        match self.hir[statement].kind {
            StmtKind::Block(_)
            | StmtKind::If { .. }
            | StmtKind::For { .. }
            | StmtKind::ForIn { .. }
            | StmtKind::ForOf { .. }
            | StmtKind::While { .. }
            | StmtKind::DoWhile { .. }
            | StmtKind::Switch { .. }
            | StmtKind::Try { .. }
            | StmtKind::Labeled { .. }
            | StmtKind::With { .. }
            | StmtKind::Return(_)
            | StmtKind::Throw(_)
            | StmtKind::Break(_)
            | StmtKind::Continue(_) => true,
            _ => self.suspends(statement),
        }
    }

    fn count_statement(&mut self, statement: StmtId, start: u32, end: u32) {
        if statement.is_some() && !self.places.statements.contains_key(&statement) {
            let counter = self.add_block(start, end);
            self.places.statements.insert(statement, counter);
        }
    }

    /// What stands behind a statement that control can leave has a count of its own, up to the end of the statements.
    fn find_statements_behind_exits(&mut self, statements: IdList<StmtId>, end: u32) {
        let hir = self.hir;
        let mut left_at = None;
        for statement in hir.ids(statements) {
            // A function declaration does not run where it stands.
            if matches!(hir[statement].kind, StmtKind::Fn(_)) {
                continue;
            }
            if let Some(left_at) = left_at.take() {
                self.count_statement(statement, left_at, end);
            }
            if self.can_be_left(statement) {
                left_at = Some(hir[statement].loc.end);
            }
        }
    }

    fn find_statements(&mut self, bound: &Bound<'_>) {
        let hir = self.hir;
        for index in 0..hir.stmts.len() {
            let statement = hir.stmts[index];
            let range = |of: StmtId| (hir[of].start, hir[of].loc.end);
            match statement.kind {
                StmtKind::If { yes, no, .. } => {
                    let (start, end) = range(yes);
                    self.count_statement(yes, start, end);
                    if no.is_some() {
                        self.count_statement(no, end, hir[no].loc.end);
                    }
                }
                StmtKind::For { body, .. }
                | StmtKind::While { body, .. }
                | StmtKind::DoWhile { body, .. } => {
                    let (start, end) = range(body);
                    self.count_statement(body, start, end);
                }
                StmtKind::ForIn { left, body, .. } | StmtKind::ForOf { left, body, .. } => {
                    let (start, end) = range(body);
                    self.count_statement(body, start, end);
                    // What stands in front of `in` or `of` is assigned to each time round.
                    let (start, end) = range(left);
                    let counter = self.places.statements[&body];
                    self.add(b's', start, end, Some(counter));
                }
                StmtKind::Try {
                    block,
                    handler,
                    finalizer,
                    ..
                } => {
                    let mut before = hir[block].loc.end;
                    if handler.is_some() {
                        self.count_statement(handler, before, hir[handler].loc.end);
                        before = hir[handler].loc.end;
                    }
                    if finalizer.is_some() {
                        self.count_statement(finalizer, before, hir[finalizer].loc.end);
                    }
                }
                _ => {}
            }
        }
        self.find_statements_behind_exits(hir.body, hir.source_len);
        for index in 0..hir.stmts.len() {
            let statement = hir.stmts[index];
            if let StmtKind::Block(statements) = statement.kind {
                self.find_statements_behind_exits(statements, statement.loc.end);
            }
        }
        for index in 0..hir.fns.len() {
            let id = FnId(index as u32);
            if let FnBody::Block(statements) = hir.fns[index].body
                && let Some(end) = find_end_of_function(hir, bound, id)
            {
                self.find_statements_behind_exits(statements, end);
                // The call of a generator runs nothing of its body.
                if hir.fns[index].flags.contains(Flags::GENERATOR) && !statements.is_empty() {
                    let counter = self.add_block(hir[hir.id_at(statements, 0)].start, end);
                    self.places.generator_bodies.insert(id, counter);
                }
            }
        }
        for index in 0..hir.modules.len() {
            let module = hir.modules[index];
            if module.stmt.is_some() {
                self.find_statements_behind_exits(module.body, hir[module.stmt].loc.end);
            }
        }
        for index in 0..hir.cases.len() {
            let case = hir.cases[index];
            let counter = self.add_block(case.pos, case.end);
            self.places.cases.insert(CaseId(index as u32), counter);
            self.find_statements_behind_exits(case.body, case.end);
        }
    }

    /// What stands behind a `?.`, up to the end of the chain, runs where what stands in front of it is neither null nor undefined.
    fn find_rests_of_chains(&mut self) {
        let hir = self.hir;
        let link_of = |expression: &hir::Expr| match expression.kind {
            ExprKind::Dot { obj, chain, .. } | ExprKind::Index { obj, chain, .. } => (obj, chain),
            ExprKind::Call(call) => (hir[call].callee, hir[call].chain),
            _ => (ExprId::NONE, Chain::No),
        };
        let mut next_links: FxHashMap<ExprId, ExprId> = FxHashMap::default();
        for (index, expression) in hir.exprs.iter().enumerate() {
            let (mut base, chain) = link_of(expression);
            if chain == Chain::No {
                continue;
            }
            next_links.insert(base, ExprId(index as u32));
            while let ExprKind::NonNull(operand) = hir[base].kind {
                base = operand;
                next_links.insert(base, ExprId(index as u32));
            }
        }
        for (index, expression) in hir.exprs.iter().enumerate() {
            let (base, chain) = link_of(expression);
            if chain != Chain::Start {
                continue;
            }
            let mut last = ExprId(index as u32);
            while let Some(&next) = next_links.get(&last) {
                last = next;
            }
            let counter = self.add_block(hir[base].end, hir[last].end);
            self.places.rests_of_chains.insert(base, counter);
        }
    }

    fn find_printed_functions(&mut self) {
        let hir = self.hir;
        let enums = hir
            .enums
            .iter()
            .map(|it| (it.stmt, it.name_pos, it.flags.contains(Flags::AMBIENT)));
        let namespaces = hir.modules.iter().map(|it| {
            let is_erased = it.is_erased || !it.has_body || it.flags.contains(Flags::AMBIENT);
            (it.stmt, it.name_pos, is_erased)
        });
        let printed: Vec<(StmtId, u32)> = enums
            .chain(namespaces)
            .filter(|&(statement, _, is_erased)| statement.is_some() && !is_erased)
            .map(|(statement, name, _)| (statement, name))
            .collect();
        for (statement, name) in printed {
            let range = (hir[statement].start, hir[statement].loc.end);
            let around = self.function_at(range.0);
            self.add_function(b'e', range, around, name);
        }
        // `namespace N { export function f() {} }` is printed with `N.f = f` behind the function.
        for index in 0..hir.modules.len() {
            for statement in hir.ids(hir.modules[index].body) {
                if let StmtKind::Fn(function) = hir[statement].kind
                    && hir[function].flags.contains(Flags::EXPORT)
                    && !matches!(hir[function].body, FnBody::None)
                {
                    let function = hir[function];
                    let outside = hir[statement].loc.pos;
                    self.add(b'o', function.text_start, function.anchor, Some(outside));
                }
            }
        }
        // `@log method() {}` is printed with a call behind the class that names the method.
        for &(owner, _) in hir.decorators.iter() {
            if let DecoratorOwner::Member(member) = owner
                && let Some(function) = hir[member].func.some()
            {
                let function = hir[function];
                let outside = hir[member].loc.pos;
                self.add(b'o', function.text_start, function.anchor, Some(outside));
            }
        }
        // `constructor(public x: number) {}` is printed with a field `x` in the class.
        for index in 0..hir.members.len() {
            let member = hir.members[index];
            if member.kind != MemberKind::Constructor || member.func.is_none() {
                continue;
            }
            for parameter in hir[member.func].params.iter() {
                let parameter = hir[parameter];
                if parameter.flags.contains(Flags::PARAMETER_PROPERTY) && parameter.loc.end != 0 {
                    self.add(b'o', parameter.pos, parameter.loc.end, Some(member.loc.pos));
                }
            }
        }
    }

    fn count_expression(&mut self, expression: ExprId, start: u32, end: u32) {
        if expression.is_none() || self.places.expressions.contains_key(&expression) {
            return;
        }
        let counter = self.add_block(start, end);
        // Whichever of them the lowering starts with.
        let mut inner = expression;
        loop {
            self.places.expressions.insert(inner, counter);
            inner = match self.hir[inner].kind {
                ExprKind::As { expr, .. }
                | ExprKind::Satisfies { expr, .. }
                | ExprKind::Instantiation { expr, .. }
                | ExprKind::AsConst(expr)
                | ExprKind::NonNull(expr) => expr,
                _ => return,
            };
        }
    }

    fn count_whole_expression(&mut self, expression: ExprId) {
        if let Some(expression) = expression.some() {
            self.count_expression(
                expression,
                self.hir[expression].pos,
                self.hir[expression].end,
            );
        }
    }

    fn find_expressions(&mut self) {
        let hir = self.hir;
        for index in 0..hir.exprs.len() {
            match hir.exprs[index].kind {
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish,
                    left,
                    right,
                } => {
                    self.count_expression(right, hir[left].end, hir[right].end);
                }
                ExprKind::Assign {
                    op: Some(BinOp::And | BinOp::Or | BinOp::Nullish),
                    value,
                    ..
                } => {
                    self.count_whole_expression(value);
                }
                ExprKind::Cond { branches, .. } => {
                    let branches = hir.branches(branches);
                    self.count_whole_expression(branches.yes);
                    self.count_expression(branches.no, hir[branches.yes].end, hir[branches.no].end);
                }
                _ => {}
            }
        }
        for index in 0..hir.stmts.len() {
            let statement = hir.stmts[index];
            match statement.kind {
                StmtKind::For { test, update, .. } => {
                    self.count_whole_expression(test);
                    self.count_whole_expression(update);
                }
                StmtKind::While { test, .. } => self.count_whole_expression(test),
                StmtKind::DoWhile { body, test } => {
                    self.count_expression(test, hir[body].loc.end, statement.loc.end);
                }
                _ => {}
            }
        }
        for index in 0..hir.params.len() {
            self.count_whole_expression(hir.params[index].default);
        }
        for index in 0..hir.pat_props.len() {
            self.count_whole_expression(hir.pat_props[index].default);
        }
        for index in 0..hir.pat_elems.len() {
            self.count_whole_expression(hir.pat_elems[index].default);
        }
        // A field runs when an object is made, not where the class is evaluated.
        for index in 0..hir.members.len() {
            let member = hir.members[index];
            if member.kind == MemberKind::Property
                && let Some(initializer) = member.init.some()
            {
                self.count_expression(initializer, member.start, hir[initializer].end);
            }
        }
    }
}

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn counts_executions(&self) -> bool {
        self.counted_places.is_some()
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn emit_count(&mut self, counter: u32) {
        let file = &mut *self.file;
        let Some(places) = file.counted_places.as_mut() else {
            return;
        };
        let description = match places.interned_description {
            Some(description) => description,
            None => {
                let description = file.fragment.strings.intern(&places.description);
                places.interned_description = Some(description);
                description
            }
        };
        let module = self.file.module_id();
        self.builder.count_execution(module, description, counter);
    }

    pub(in crate::lower) fn count_file_body(&mut self) {
        self.emit_count(FILE_BODY);
    }

    pub(in crate::lower) fn count_function(&mut self, function: FnId) {
        let places = self.file.counted_places.as_ref();
        if let Some(&counter) = places.and_then(|places| places.functions.get(&function)) {
            self.emit_count(counter);
        }
    }

    pub(in crate::lower) fn count_generator_body(&mut self, function: FnId) {
        let places = self.file.counted_places.as_ref();
        if let Some(&counter) = places.and_then(|places| places.generator_bodies.get(&function)) {
            self.emit_count(counter);
        }
    }

    pub(in crate::lower) fn count_statement(&mut self, statement: StmtId) {
        let places = self.file.counted_places.as_ref();
        if let Some(&counter) = places.and_then(|places| places.statements.get(&statement)) {
            self.emit_count(counter);
        }
    }

    pub(in crate::lower) fn count_rest_of_chain(&mut self, base: ExprId) {
        let places = self.file.counted_places.as_ref();
        if let Some(&counter) = places.and_then(|places| places.rests_of_chains.get(&base)) {
            self.emit_count(counter);
        }
    }

    pub(in crate::lower) fn count_case(&mut self, case: CaseId) {
        let places = self.file.counted_places.as_ref();
        if let Some(&counter) = places.and_then(|places| places.cases.get(&case)) {
            self.emit_count(counter);
        }
    }

    /// Counts the expression unless what is being lowered is that expression already. Returns what `leave_counted_expression` takes.
    pub(in crate::lower) fn enter_counted_expression(&mut self, expression: ExprId) -> Option<u32> {
        let outer = self.counted_expression;
        let places = self.file.counted_places.as_ref();
        if let Some(&counter) = places.and_then(|places| places.expressions.get(&expression))
            && outer != Some(counter)
        {
            self.counted_expression = Some(counter);
            self.emit_count(counter);
        }
        outer
    }

    pub(in crate::lower) fn leave_counted_expression(&mut self, outer: Option<u32>) {
        self.counted_expression = outer;
    }
}
