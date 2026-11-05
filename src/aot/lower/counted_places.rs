use bun_sema::bind::{Binding, BindingInitializer, Bound, FnOwner};
use bun_sema::hir::{
    self, BinOp, CaseId, Chain, ClassId, ExprId, ExprKind, Flags, FnBody, FnId, FnKind, IdList,
    MemberId, MemberKind, ModifierKind, PropKey, Span, StmtId, StmtKind, VarKind,
};
use bun_sema::program::CompiledModule;
use rustc_hash::FxHashMap;

use super::class::{
    PrintedForEachObject, decorators_of, find_keys_that_hold_decorators,
    find_what_is_printed_for_each_object, has_decorators, is_printed_as_getter_and_setter,
    runtime_members,
};
use super::{FileLowering, FunctionLowering};
use crate::ir::StringId;
use crate::ir::generated::MethodKind;

#[cfg(test)]
mod tests;

const FILE_BODY: u32 = 0;

pub(in crate::lower) struct CountedPlaces {
    description: Vec<u8>,
    interned_description: Option<StringId>,
    count: u32,
    statements: FxHashMap<StmtId, u32>,
    expressions: FxHashMap<ExprId, u32>,
    cases: FxHashMap<CaseId, u32>,
    functions: FxHashMap<FnId, u32>,
    made_constructors: FxHashMap<ClassId, u32>,
    made_getters: FxHashMap<MemberId, u32>,
    made_setters: FxHashMap<MemberId, u32>,
    generator_bodies: FxHashMap<FnId, u32>,
    rests_of_chains: FxHashMap<ExprId, u32>,
}

struct FunctionRange {
    start: u32,
    end: u32,
    counter: u32,
    parent: Option<usize>,
}

struct Finder<'p, 's> {
    hir: &'p hir::File<'s>,
    places: CountedPlaces,
    functions: Vec<FunctionRange>,
    suspensions: Vec<u32>,
    getters_that_only_hold_keys: FxHashMap<MemberId, u32>,
}

fn find_start_of_field(hir: &hir::File<'_>, member: &hir::Member, initializer: ExprId) -> u32 {
    match member.flags.contains(Flags::COMPUTED_NAME) {
        true => hir[initializer].pos - 1,
        false => member.name_pos,
    }
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
        compiled: &CompiledModule<'_>,
        fields_under_signed_members: &[MemberId],
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
                made_constructors: FxHashMap::default(),
                made_getters: FxHashMap::default(),
                made_setters: FxHashMap::default(),
                generator_bodies: FxHashMap::default(),
                rests_of_chains: FxHashMap::default(),
            },
            functions: Vec::new(),
            suspensions: Vec::new(),
            getters_that_only_hold_keys: FxHashMap::default(),
        };
        let file_body = finder.add(b'b', 0, hir.source_len, None);
        debug_assert_eq!(file_body, FILE_BODY);
        finder.find_functions(bound);
        finder.find_suspensions();
        finder.find_statements(bound);
        finder.find_expressions();
        finder.find_rests_of_chains();
        finder.find_printed_functions();
        finder.find_text_printed_behind_classes();
        finder.find_what_classes_print(bound, compiled, fields_under_signed_members);
        finder.find_reads_of_constants(bound, compiled);
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

    fn add_function(&mut self, kind: u8, range: (u32, u32), maker: u32, end_of_head: u32) -> u32 {
        use std::io::Write;
        let counter = self.add(kind, range.0, range.1, Some(maker));
        self.places.description.pop();
        let _ = writeln!(self.places.description, " {end_of_head}");
        counter
    }

    fn add_block(&mut self, start: u32, end: u32) -> Option<u32> {
        (start < end).then(|| self.add(b'b', start, end, None))
    }

    fn find_functions(&mut self, bound: &Bound<'_>) {
        let hir = self.hir;
        let has_legacy_decorators = hir.has_typescript_semantics() && hir.legacy_decorators;
        let mut ranges: Vec<(u32, u32, Result<FnId, ExprId>)> = Vec::new();
        for member in hir.members.iter() {
            if member.kind == MemberKind::Property
                && !member.flags.contains(Flags::STATIC)
                && let Some(initializer) = member.init.some()
            {
                let start = find_start_of_field(hir, member, initializer);
                ranges.push((start, hir[initializer].end, Err(initializer)));
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
                FnKind::StaticBlock
                | FnKind::CallSignature
                | FnKind::ConstructSignature
                | FnKind::FunctionType
                | FnKind::ConstructorType
                | FnKind::IndexSignature => false,
            };
            let start = match bound.fns[id.idx()].owner {
                FnOwner::Member(member)
                    if !has_legacy_decorators
                        && has_decorators(hir, hir[member].modifiers)
                        && !matches!(hir[member].key, PropKey::Private(_)) =>
                {
                    function.start
                }
                _ => function.text_start,
            };
            if is_counted
                && let Some(end) = find_end_of_function(hir, bound, id)
                && start < end
            {
                ranges.push((start, end, Ok(id)));
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
                    match self.places.expressions.get(&initializer) {
                        Some(&counter) => counter,
                        None => continue,
                    }
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
        if statement.is_some()
            && !self.places.statements.contains_key(&statement)
            && let Some(counter) = self.add_block(start, end)
        {
            self.places.statements.insert(statement, counter);
        }
    }

    fn find_statements_behind_exits(&mut self, statements: IdList<StmtId>, end: u32) {
        let hir = self.hir;
        let mut left_at = None;
        for statement in hir.ids(statements) {
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
                    let (start, end) = range(left);
                    if let Some(&counter) = self.places.statements.get(&body) {
                        self.add(b's', start, end, Some(counter));
                    }
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
                if hir.fns[index].flags.contains(Flags::GENERATOR)
                    && !statements.is_empty()
                    && let Some(counter) = self.add_block(hir[hir.id_at(statements, 0)].start, end)
                {
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
            if let Some(counter) = self.add_block(case.pos, case.end) {
                self.places.cases.insert(CaseId(index as u32), counter);
            }
            self.find_statements_behind_exits(case.body, case.end);
        }
    }

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
            if let Some(counter) = self.add_block(hir[base].end, hir[last].end) {
                self.places.rests_of_chains.insert(base, counter);
            }
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

    fn find_text_printed_behind_classes(&mut self) {
        let hir = self.hir;
        if hir.decorators.is_empty() {
            return;
        }
        for index in 0..hir.members.len() {
            let member = hir.members[index];
            let outside = member.loc.pos;
            let function = member.func.some().map(|function| hir[function]);
            let parameters = function.map_or(Span::EMPTY, |function| function.params);
            let mut is_decorated = has_decorators(hir, member.modifiers);
            for parameter in parameters.iter() {
                for decorator in decorators_of(hir, hir.param_modifiers(parameter)) {
                    is_decorated = true;
                    self.add(b'o', hir[decorator].pos, hir[decorator].end, Some(outside));
                }
            }
            if !is_decorated || member.kind == MemberKind::Constructor {
                continue;
            }
            let (start, end) = match function {
                Some(function) => (function.text_start, function.anchor),
                None => (member.name_pos, member.name_pos + 1),
            };
            self.add(b'o', start, end, Some(outside));
        }
    }

    fn find_reads_of_constants(&mut self, bound: &Bound<'_>, compiled: &CompiledModule<'_>) {
        let hir = self.hir;
        let decisions = &compiled.analysis.decisions;
        for read in (0..hir.exprs.len() as u32).map(ExprId) {
            let mut value = read;
            while let ExprKind::Ident(_) = hir[value].kind
                && decisions.is_constant_under_minify_syntax(hir, value)
                && let Binding::Symbol(symbol) = bound.binding(value)
                && let BindingInitializer::Expression(initializer) =
                    bound.binding_initializer(hir, symbol)
            {
                value = initializer;
            }
            if value != read {
                let (value, read) = (hir[value], hir[read]);
                self.add(b'r', value.pos, value.end, Some(read.pos));
            }
        }
    }

    fn find_what_classes_print(
        &mut self,
        bound: &Bound<'_>,
        compiled: &CompiledModule<'_>,
        fields_under_signed_members: &[MemberId],
    ) {
        let hir = self.hir;
        let has_legacy_decorators = hir.has_typescript_semantics() && hir.legacy_decorators;
        for class in (0..hir.classes.len() as u32).map(ClassId) {
            let node = hir[class];
            let signed = fields_under_signed_members;
            if node.flags.contains(Flags::AMBIENT) {
                continue;
            }
            let mut keywords = node.modifiers.iter().filter_map(|modifier| {
                let modifier = hir[modifier];
                matches!(modifier.kind, ModifierKind::Keyword(_)).then_some(modifier.pos)
            });
            let start = keywords.next().unwrap_or(node.text_start);
            let words = (start, node.name_pos.max(start + 1));
            let printed = find_what_is_printed_for_each_object(hir, bound, compiled, signed, class);
            if !has_legacy_decorators {
                self.find_made_accessors(class, words);
                self.find_keys_that_hold_decorators(class, words, &printed.fields_given_a_value);
            }
            self.find_made_constructor(class, words, printed);
        }
    }

    fn find_made_constructor(
        &mut self,
        class: ClassId,
        words: (u32, u32),
        printed: PrintedForEachObject,
    ) {
        let hir = self.hir;
        let Some(first_member) = hir[class].members.iter().next() else {
            return;
        };
        if !printed.makes_constructor && !printed.stands_at_statement {
            return;
        }
        let brace = hir[first_member].loc.pos.saturating_sub(1);
        let written = printed.written_constructor;
        let (counter, position) = match written {
            Some(written) => match self.places.functions.get(&written) {
                Some(&counter) => (counter, hir[written].text_start),
                None => return,
            },
            None if printed.makes_constructor => {
                let around = self.function_at(hir[class].start);
                let range = (brace, brace + 1);
                (self.add_function(b'f', range, around, brace), brace)
            }
            None => (self.add(b'b', brace, brace + 1, None), brace),
        };
        if written.is_none() {
            self.places.made_constructors.insert(class, counter);
        }
        if printed.stands_at_statement {
            self.add(b'o', words.0, words.1, Some(position));
        }
        for field in printed.fields_given_a_value {
            let name = hir[field].name_pos;
            self.add(b's', name, name + 1, Some(counter));
        }
    }

    fn find_made_accessors(&mut self, class: ClassId, words: (u32, u32)) {
        let hir = self.hir;
        let around = self.function_at(hir[class].start);
        for member in runtime_members(hir, class) {
            let node = hir[member];
            if !is_printed_as_getter_and_setter(hir, member) {
                continue;
            }
            let name = node.name_pos;
            if has_decorators(hir, node.modifiers) {
                let getter = self.add_function(b'f', (node.start, name + 1), around, name);
                self.getters_that_only_hold_keys.insert(member, getter);
                continue;
            }
            let mut keywords = node.modifiers.iter().filter_map(|modifier| {
                let modifier = hir[modifier];
                let ModifierKind::Keyword(keyword) = modifier.kind else {
                    return None;
                };
                (keyword == Flags::ACCESSOR).then_some(modifier.pos)
            });
            let Some(keyword) = keywords.next() else {
                continue;
            };
            let getter = self.add_function(b'f', (name, name + 1), around, name);
            let inside_keyword = keyword + 1;
            let range = (inside_keyword, inside_keyword + 1);
            let setter = self.add_function(b'f', range, around, inside_keyword);
            self.add(b'o', name, name + 1, Some(inside_keyword));
            self.add(b'o', words.0, words.1, Some(inside_keyword));
            self.places.made_getters.insert(member, getter);
            self.places.made_setters.insert(member, setter);
        }
    }

    fn find_keys_that_hold_decorators(
        &mut self,
        class: ClassId,
        words: (u32, u32),
        fields_given_a_value: &[MemberId],
    ) {
        let hir = self.hir;
        for key in find_keys_that_hold_decorators(hir, class, fields_given_a_value) {
            let members = || key.private_members.iter();
            let decorators = || members().flat_map(|&it| decorators_of(hir, hir[it].modifiers));
            let function = key.member.and_then(|member| hir[member].func.some());
            let (counter, position) = match (key.member, function) {
                (Some(_), Some(function)) => {
                    let counter = self.places.functions.get(&function);
                    (counter.copied(), hir[function].text_start)
                }
                (Some(member), None) if is_printed_as_getter_and_setter(hir, member) => {
                    let made = self.places.made_getters.get(&member);
                    let getter = made.or_else(|| self.getters_that_only_hold_keys.get(&member));
                    (getter.copied(), hir[member].name_pos)
                }
                (Some(member), None) => {
                    if let Some(first) = decorators().next() {
                        let name = hir[member].name_pos;
                        self.add(b'o', name, name + 1, Some(hir[first].pos));
                    }
                    continue;
                }
                (None, _) => {
                    let Some(first) = decorators().next() else {
                        continue;
                    };
                    let range = (hir[first].pos, hir[first].end);
                    let around = self.function_at(hir[class].start);
                    let made = self.add_function(b'f', range, around, range.0);
                    (Some(made), range.0)
                }
            };
            let Some(counter) = counter else {
                continue;
            };
            for decorator in decorators() {
                self.add(b's', hir[decorator].pos, hir[decorator].end, Some(counter));
            }
            if key.shows_place_of_class() {
                self.add(b'o', words.0, words.1, Some(position));
            }
        }
    }

    fn has_extent_of_function(&self, start: u32, end: u32) -> bool {
        let first = self
            .functions
            .partition_point(|function| function.start < start);
        let mut starting_there = self.functions[first..]
            .iter()
            .take_while(|function| function.start == start);
        starting_there.any(|function| function.end == end)
    }

    fn count_expression(&mut self, expression: ExprId, start: u32, end: u32) {
        if expression.is_none()
            || self.places.expressions.contains_key(&expression)
            || self.has_extent_of_function(start, end)
        {
            return;
        }
        let Some(counter) = self.add_block(start, end) else {
            return;
        };
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

    fn count_part(&mut self, whole: &hir::Expr, part: ExprId) {
        if let Some(part) = part.some()
            && (self.hir[part].pos, self.hir[part].end) != (whole.pos, whole.end)
        {
            self.count_whole_expression(part);
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
            let whole = hir.exprs[index];
            match whole.kind {
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
                    self.count_part(&whole, value);
                }
                ExprKind::Cond { branches, .. } => {
                    let branches = hir.branches(branches);
                    self.count_part(&whole, branches.yes);
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
        for index in 0..hir.members.len() {
            let member = hir.members[index];
            if member.kind == MemberKind::Property
                && let Some(initializer) = member.init.some()
            {
                let start = find_start_of_field(hir, &member, initializer);
                self.count_expression(initializer, start, hir[initializer].end);
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

    pub(in crate::lower) fn count_made_constructor(&mut self, class: ClassId) {
        let places = self.file.counted_places.as_ref();
        if let Some(&counter) = places.and_then(|places| places.made_constructors.get(&class)) {
            self.emit_count(counter);
        }
    }

    pub(in crate::lower) fn count_accessor_function(&mut self, member: MemberId, kind: MethodKind) {
        let Some(places) = self.file.counted_places.as_ref() else {
            return;
        };
        let counter = match kind {
            MethodKind::Getter => places.made_getters.get(&member),
            MethodKind::Setter => places.made_setters.get(&member),
            MethodKind::Method => None,
        };
        if let Some(&counter) = counter {
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
