use bun_sema::atom::{Atom, known};
use bun_sema::bind::Decl;
use bun_sema::erasure::{TypeRanges, find_type_ranges};
use bun_sema::fold::{Constant, FoldedValue, TreeNode, push_children};
use bun_sema::hir::{
    BinOp, Branches, Chain, ExprId, ExprKind, Flags, FnBody, FnId, IdList, PatId, PatKind, PropKey,
    StmtId, StmtKind, VarKind,
};
use bun_sema::import_sites::{
    WORDS_THAT_MOCK_LOOKS_FOR_IN_FACTORY as WORDS, may_spell_word_that_mock_looks_for,
    names_word_that_mock_looks_for as names_word,
};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::ir::StringId;
use crate::ir::generated::SourceRange;
use crate::lower::FileLowering;

#[derive(Default)]
pub(in crate::lower) struct ValuesThatConstsWereFollowedTo {
    number_of_consts: usize,
    values: FxHashMap<ExprId, Option<Constant>>,
}

pub(in crate::lower) struct StatementsThatNest {
    ranges: Vec<(u32, u32)>,
    parents: Vec<Option<u32>>,
}

impl StatementsThatNest {
    fn new(mut ranges: Vec<(u32, u32)>) -> StatementsThatNest {
        ranges.sort_unstable_by_key(|it| (it.0, std::cmp::Reverse(it.1)));
        let mut parents = Vec::with_capacity(ranges.len());
        let mut open: Vec<u32> = Vec::new();
        for (index, range) in ranges.iter().enumerate() {
            while open
                .last()
                .is_some_and(|&it| ranges[it as usize].1 <= range.0)
            {
                open.pop();
            }
            parents.push(open.last().copied());
            open.push(index as u32);
        }
        StatementsThatNest { ranges, parents }
    }

    fn find_smallest_around(&self, place: u32) -> Option<(u32, u32)> {
        let behind = self.ranges.partition_point(|it| it.0 <= place);
        let mut at = Some(behind.checked_sub(1)? as u32);
        while let Some(index) = at {
            let range = self.ranges[index as usize];
            if place < range.1 {
                return Some(range);
            }
            at = self.parents[index as usize];
        }
        None
    }
}

fn find_whether_true(decided: Constant) -> Option<bool> {
    match decided {
        Constant::Boolean(value) => Some(value),
        Constant::Undefined | Constant::Null => Some(false),
        Constant::Number(value) => Some(value != 0.0 && !value.is_nan()),
        Constant::String(_) | Constant::BigInt(_) => None,
    }
}

fn merge_ranges(lists: &[&[(u32, u32)]]) -> Vec<(u32, u32)> {
    let all = lists.iter().flat_map(|it| it.iter());
    let mut sorted: Vec<(u32, u32)> = all.filter(|it| it.0 < it.1).copied().collect();
    sorted.sort_unstable();
    let mut merged: Vec<(u32, u32)> = Vec::with_capacity(sorted.len());
    for range in sorted {
        match merged.last_mut() {
            Some(last) if range.0 <= last.1 => last.1 = last.1.max(range.1),
            _ => merged.push(range),
        }
    }
    merged
}

fn stands_outside(
    written: &[u8],
    start: u32,
    sought: &[u8],
    merged_ranges: &[(u32, u32)],
    types: &TypeRanges,
) -> bool {
    let mut from = 0;
    while let Some(found) = bun_core::strings::index_of(&written[from..], sought) {
        let place = start + (from + found) as u32;
        let behind = merged_ranges.partition_point(|it| it.0 <= place);
        let is_inside = behind > 0 && place < merged_ranges[behind - 1].1;
        if !is_inside && !types.removes(place) {
            return true;
        }
        from += found + 1;
    }
    false
}

#[derive(Clone, Copy)]
struct ConstOfPrefix {
    value: ExprId,
    is_dropped: bool,
    prefix: u32,
}

struct Prefix {
    last_search_that_noted_it: u32,
    number_of_consts: usize,
}

#[derive(Default)]
pub(in crate::lower) struct ConstsOfPrefixes {
    consts: FxHashMap<PatId, ConstOfPrefix>,
    prefixes_of_lists: FxHashMap<IdList<StmtId>, u32>,
    prefixes: Vec<Prefix>,
    search: u32,
    number_in_sight: usize,
}

impl ConstsOfPrefixes {
    fn find(&self, name: PatId) -> Option<ConstOfPrefix> {
        let found = *self.consts.get(&name)?;
        let prefix = &self.prefixes[found.prefix as usize];
        (prefix.last_search_that_noted_it == self.search).then_some(found)
    }
}

#[derive(Default)]
pub(super) struct OriginalsAskedFor {
    pub(super) may_be_own: bool,
    pub(super) names: Vec<StringId>,
}

impl FileLowering<'_, '_, '_, '_> {
    /// `bun run` makes a `let` of a function of a block behind its filter, so a function that is reached is printed.
    fn is_dropped_whole(&self, dead: StmtId, is_branch_of_decided_if: bool) -> bool {
        let hir = self.hir;
        let is_reached_function =
            matches!(hir[dead].kind, StmtKind::Fn(_)) && !is_branch_of_decided_if;
        let is_printed = self.keeps_never_run_code() || is_reached_function;
        if is_printed || !self.never_run().prints_nothing(dead) {
            return false;
        }
        let (start, end) = (hir[dead].loc.pos, hir[dead].loc.end);
        let first = hir.comments.partition_point(|it| it.pos < start);
        let inside = hir.comments[first..].iter().take_while(|it| it.pos < end);
        !{ inside }.any(|it| self.has_mark(it.pos))
    }

    /// Of a `var` that never runs `bun run` prints the names alone: no key and no default.
    fn leave_names_alone(&self, pattern: PatId, not_printed: &mut Vec<(u32, u32)>) {
        let hir = self.hir;
        let mut leave_out = |start: u32, end: u32| {
            if start < end {
                not_printed.push((start, end));
            }
        };
        let mut patterns = vec![pattern];
        while let Some(pattern) = patterns.pop() {
            match hir[pattern].kind {
                PatKind::Missing | PatKind::Ident(_) => {}
                PatKind::Object(properties) => {
                    for property in properties.iter().map(|it| hir[it]) {
                        if property.value.is_some() {
                            leave_out(property.pos, hir[property.value].pos);
                            patterns.push(property.value);
                        }
                        if property.default.is_some() {
                            leave_out(hir[property.default].pos, hir[property.default].end);
                        }
                    }
                }
                PatKind::Array(elements) => {
                    for element in elements.iter().map(|it| hir[it]) {
                        if element.pat.is_some() {
                            patterns.push(element.pat);
                        }
                        if element.default.is_some() {
                            leave_out(hir[element.default].pos, hir[element.default].end);
                        }
                    }
                }
            }
        }
    }

    fn has_mark(&self, comment: u32) -> bool {
        self.hir.text.get(comment as usize + 2) == Some(&b'!')
    }

    fn is_sum_behind_what_is_decided(&self, value: ExprId) -> bool {
        let hir = self.hir;
        let find_constant = |it: ExprId| match self.decisions().constant(hir, it) {
            FoldedValue::Constant(known) | FoldedValue::ConstantOutsideDeadZone(known) => {
                Some(known)
            }
            FoldedValue::Unknown => None,
        };
        let find_truth = |it: ExprId| match find_constant(it)? {
            Constant::String(text) => Some(!self.queries.atom_bytes(text).is_empty()),
            other => find_whether_true(other),
        };
        let mut left_over = hir.skip_type_assertions(value);
        loop {
            let next = match hir[left_over].kind {
                ExprKind::Binary { op: BinOp::Add, .. } => return true,
                ExprKind::Cond { test, branches } => {
                    let Branches { yes, no } = hir.branches(branches);
                    match find_truth(test) {
                        Some(true) => yes,
                        Some(false) => no,
                        None => return true,
                    }
                }
                ExprKind::Binary {
                    op: op @ (BinOp::And | BinOp::Or),
                    left,
                    right,
                } => match (find_truth(left), op) {
                    (Some(true), BinOp::Or) | (Some(false), BinOp::And) => left,
                    (Some(_), _) => right,
                    (None, _) => return true,
                },
                ExprKind::Binary {
                    op: BinOp::Nullish,
                    left,
                    right,
                } => match find_constant(left) {
                    Some(Constant::Undefined | Constant::Null) => right,
                    Some(_) => left,
                    None => return true,
                },
                _ => return false,
            };
            left_over = hir.skip_type_assertions(next);
        }
    }

    fn note_consts_in_front_of_all_else(
        &self,
        list: IdList<StmtId>,
        is_block: bool,
        consts: &mut ConstsOfPrefixes,
    ) {
        if let Some(&read) = consts.prefixes_of_lists.get(&list) {
            let prefix = &mut consts.prefixes[read as usize];
            if prefix.last_search_that_noted_it != consts.search {
                prefix.last_search_that_noted_it = consts.search;
                consts.number_in_sight += prefix.number_of_consts;
            }
            return;
        }
        let prefix = consts.prefixes.len() as u32;
        let number_known = consts.consts.len();
        let hir = self.hir;
        let never_run = self.never_run();
        let mut are_declarations_dropped =
            !is_block || !hir.ids(list).any(|it| never_run.becomes_let(it));
        for statement in hir.ids(list) {
            let declarations = match hir[statement].kind {
                StmtKind::Var(declarations) => declarations,
                StmtKind::Directive { .. }
                | StmtKind::Empty
                | StmtKind::Debugger
                | StmtKind::Interface(_)
                | StmtKind::TypeAlias(_) => continue,
                StmtKind::Enum(it) => {
                    are_declarations_dropped &= hir[it].flags.contains(Flags::AMBIENT);
                    continue;
                }
                _ => break,
            };
            if declarations.iter().any(|it| hir[it].kind != VarKind::Const) {
                break;
            }
            let is_sum_of_texts = |value: ExprId| {
                let (FoldedValue::Constant(folded) | FoldedValue::ConstantOutsideDeadZone(folded)) =
                    self.decisions().constant(hir, value)
                else {
                    return false;
                };
                matches!(folded, Constant::String(_)) && self.is_sum_behind_what_is_decided(value)
            };
            for declaration in declarations.iter().map(|it| hir[it]) {
                if declaration.init.is_none() || is_sum_of_texts(declaration.init) {
                    continue;
                }
                consts.consts.insert(
                    declaration.pat,
                    ConstOfPrefix {
                        value: declaration.init,
                        is_dropped: are_declarations_dropped,
                        prefix,
                    },
                );
            }
        }
        let number_of_consts = consts.consts.len() - number_known;
        consts.prefixes_of_lists.insert(list, prefix);
        consts.prefixes.push(Prefix {
            last_search_that_noted_it: consts.search,
            number_of_consts,
        });
        consts.number_in_sight += number_of_consts;
    }

    fn begin_search_among_consts(&self, function: FnId, consts: &mut ConstsOfPrefixes) {
        let (hir, bound) = (self.hir, self.bound);
        consts.search += 1;
        consts.number_in_sight = 0;
        let mut around = function;
        while around.is_some() {
            if let FnBody::Block(list) = hir[around].body {
                self.note_consts_in_front_of_all_else(list, false, consts);
            }
            around = bound.fns[around.idx()].enclosing;
        }
        self.note_consts_in_front_of_all_else(hir.body, false, consts);
    }

    fn may_word_come_from_outside_function(&mut self) -> bool {
        if let Some(known) = self.names_word_that_mock_looks_for {
            return known;
        }
        let queries = &*self.queries;
        let names = names_word(&self.hir.text)
            || (self.decisions()).folds_text_that(|it| names_word(queries.atom_bytes(it)));
        self.names_word_that_mock_looks_for = Some(names);
        names
    }

    fn find_value_that_printer_prints(
        &mut self,
        written: ExprId,
        consts_that_printer_writes_out: &ConstsOfPrefixes,
    ) -> Option<Constant> {
        let hir = self.hir;
        let decisions = self.decisions();
        let folded = decisions.constant(hir, written);
        if folded != FoldedValue::Unknown
            && !decisions.is_constant_under_minify_syntax(hir, written)
        {
            return None;
        }
        match folded {
            FoldedValue::Constant(printed) => Some(printed),
            FoldedValue::ConstantOutsideDeadZone(printed) => {
                let mut stack = vec![TreeNode::Expr(written)];
                while let Some(node) = stack.pop() {
                    if let TreeNode::Expr(part) = node
                        && let ExprKind::Ident(_) = hir[part].kind
                    {
                        let symbol = self.symbol_named_by(part)?;
                        let mut declarations = self.bound.symbol(symbol).decls.iter();
                        let is_written_out = declarations.all(|it| {
                            matches!(*it, Decl::Var(name) if consts_that_printer_writes_out.find(name).is_some_and(|it| hir[it.value].end <= hir[part].pos))
                        });
                        if !is_written_out {
                            return None;
                        }
                    }
                    push_children(hir, node, &mut stack);
                }
                Some(printed)
            }
            FoldedValue::Unknown => match hir[written].kind {
                ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                    self.find_read_of_enum_member_of_this_file(written)
                }
                _ => {
                    let followed = &mut self.values_that_consts_were_followed_to;
                    if followed.number_of_consts != consts_that_printer_writes_out.number_in_sight {
                        followed.number_of_consts = consts_that_printer_writes_out.number_in_sight;
                        followed.values.clear();
                    }
                    if let Some(&known) = followed.values.get(&written) {
                        return known;
                    }
                    let left_over =
                        self.find_what_is_left_over(written, consts_that_printer_writes_out);
                    let found = left_over.and_then(|it| {
                        self.find_value_that_printer_prints(it, consts_that_printer_writes_out)
                    });
                    let followed = &mut self.values_that_consts_were_followed_to;
                    followed.values.insert(written, found);
                    found
                }
            },
        }
    }

    fn find_what_is_left_over(
        &mut self,
        written: ExprId,
        consts_that_printer_writes_out: &ConstsOfPrefixes,
    ) -> Option<ExprId> {
        let hir = self.hir;
        match hir[written].kind {
            ExprKind::Ident(_) => {
                let symbol = self.symbol_named_by(written)?;
                let [Decl::Var(read)] = *self.bound.symbol(symbol).decls else {
                    return None;
                };
                let value = consts_that_printer_writes_out.find(read)?.value;
                (hir[value].end <= hir[written].pos).then(|| hir.skip_type_assertions(value))
            }
            ExprKind::Cond { test, branches } => {
                let Branches { yes, no } = hir.branches(branches);
                let is_true =
                    self.find_side_that_printer_keeps(test, consts_that_printer_writes_out)?;
                Some(hir.skip_type_assertions(if is_true { yes } else { no }))
            }
            _ => None,
        }
    }

    fn find_member_that_printer_names(
        &mut self,
        printed: ExprId,
        consts_that_printer_writes_out: &ConstsOfPrefixes,
    ) -> Option<Atom> {
        let mut left_over = printed;
        loop {
            if let ExprKind::Dot { name, .. } = self.hir[left_over].kind {
                return self
                    .find_read_of_enum_member_of_this_file(left_over)
                    .map(|_| name);
            }
            left_over = self.find_what_is_left_over(left_over, consts_that_printer_writes_out)?;
        }
    }

    fn find_side_that_printer_keeps(
        &mut self,
        test: ExprId,
        consts_that_printer_writes_out: &ConstsOfPrefixes,
    ) -> Option<bool> {
        let hir = self.hir;
        if let ExprKind::Dot {
            obj,
            name: known::hot,
            chain: Chain::No,
            ..
        } = hir[hir.skip_type_assertions(test)].kind
            && matches!(
                hir[hir.skip_type_assertions(obj)].kind,
                ExprKind::ImportMeta
            )
        {
            return Some(false);
        }
        let decided = self.find_value_that_printer_prints(test, consts_that_printer_writes_out);
        decided.and_then(find_whether_true)
    }

    fn find_name_that_search_reads(
        &mut self,
        argument: ExprId,
        consts_that_printer_writes_out: &ConstsOfPrefixes,
    ) -> Option<Atom> {
        let hir = self.hir;
        let mut first = hir.skip_type_assertions(argument);
        loop {
            match self.find_value_that_printer_prints(first, consts_that_printer_writes_out) {
                Some(Constant::String(name)) => return Some(name),
                Some(_) => return None,
                None => {}
            }
            let ExprKind::Binary {
                op: BinOp::Add,
                left,
                ..
            } = hir[first].kind
            else {
                return None;
            };
            first = left;
        }
    }

    fn note_statements_behind_a_jump(
        &self,
        list: IdList<StmtId>,
        in_dead_flow: &mut FxHashSet<StmtId>,
    ) {
        let hir = self.hir;
        let mut is_behind = false;
        for statement in hir.ids(list) {
            if is_behind {
                in_dead_flow.insert(statement);
            }
            is_behind |= matches!(
                hir[statement].kind,
                StmtKind::Return(_)
                    | StmtKind::Throw(_)
                    | StmtKind::Break(_)
                    | StmtKind::Continue(_)
            );
        }
    }

    pub(super) fn find_originals_asked_for(
        &mut self,
        function: FnId,
        text: SourceRange,
    ) -> OriginalsAskedFor {
        if !self.inputs.modules.is_any_module_named_by_mock() {
            return OriginalsAskedFor::default();
        }
        let mut consts = std::mem::take(&mut self.consts_of_prefixes);
        let asked = self.search_text_for_originals_asked_for(function, text, &mut consts);
        self.consts_of_prefixes = consts;
        asked
    }

    fn search_text_for_originals_asked_for(
        &mut self,
        function: FnId,
        text: SourceRange,
        consts: &mut ConstsOfPrefixes,
    ) -> OriginalsAskedFor {
        let own = OriginalsAskedFor {
            may_be_own: true,
            names: Vec::new(),
        };
        let mut asked = OriginalsAskedFor::default();
        self.values_that_consts_were_followed_to.values.clear();
        let hir = self.hir;
        let Some(written) = hir.text.get(text.start as usize..text.end as usize) else {
            return own;
        };
        if !self.may_word_come_from_outside_function()
            && !may_spell_word_that_mock_looks_for(written)
        {
            return asked;
        }
        let first = hir.comments.partition_point(|it| it.end <= text.start);
        let inside = hir.comments[first..]
            .iter()
            .take_while(|it| it.pos < text.end);
        let comments = inside.filter(|it| !self.has_mark(it.pos));
        let mut not_printed: Vec<(u32, u32)> = comments.map(|it| (it.pos, it.end)).collect();
        let mut lists_of_statements: Vec<(u32, u32)> = Vec::new();
        let mut statements: Vec<(u32, u32)> = Vec::new();
        let mut imports: Vec<u32> = Vec::new();
        let mut dropped: FxHashSet<StmtId> = FxHashSet::default();
        let mut read_by_their_values: Vec<(u32, u32)> = Vec::new();
        self.begin_search_among_consts(function, consts);
        let mut declarations_written_out: Vec<(u32, u32)> = Vec::new();
        let mut has_direct_eval = false;
        let mut printed_as_written: FxHashSet<ExprId> = FxHashSet::default();
        let mut in_dead_flow: FxHashSet<StmtId> = FxHashSet::default();
        let never_run = self.never_run();
        let mut never_run_branches: FxHashSet<StmtId> = FxHashSet::default();
        let mut floor_of_never_run_branch: Option<usize> = None;
        let mut bodies_left_out: FxHashSet<ExprId> = FxHashSet::default();
        not_printed.push((text.start, self.parameters_position(function)));
        let mut stack = vec![TreeNode::Function(function)];
        while let Some(node) = stack.pop() {
            if floor_of_never_run_branch.is_some_and(|floor| stack.len() < floor) {
                floor_of_never_run_branch = None;
            }
            match node {
                TreeNode::Stmt(statement) => {
                    let whole = (hir[statement].start, hir[statement].loc.end);
                    match hir[statement].kind {
                        StmtKind::Block(_) => lists_of_statements.push(whole),
                        _ => statements.push(whole),
                    }
                    let is_directive = matches!(hir[statement].kind, StmtKind::Directive { .. });
                    if is_directive && !self.keeps_never_run_code() {
                        not_printed.push((hir[statement].loc.pos, hir[statement].loc.end));
                        continue;
                    }
                    if in_dead_flow.contains(&statement) {
                        let is_branch = never_run_branches.contains(&statement);
                        if self.is_dropped_whole(statement, is_branch) {
                            not_printed.push((hir[statement].loc.pos, hir[statement].loc.end));
                            continue;
                        }
                        if is_branch {
                            floor_of_never_run_branch = Some(stack.len());
                        }
                        if let StmtKind::Var(declarations) = hir[statement].kind
                            && !self.keeps_never_run_code()
                        {
                            for declaration in declarations.iter().map(|it| hir[it]) {
                                let value = declaration.init;
                                if value.is_some() {
                                    not_printed.push((hir[value].pos, hir[value].end));
                                }
                                self.leave_names_alone(declaration.pat, &mut not_printed);
                            }
                            continue;
                        }
                        let below = stack.len();
                        push_children(hir, node, &mut stack);
                        for child in &stack[below..] {
                            if let TreeNode::Stmt(child) = *child {
                                in_dead_flow.insert(child);
                            }
                        }
                        continue;
                    }
                    if let StmtKind::Block(list) = hir[statement].kind {
                        self.note_statements_behind_a_jump(list, &mut in_dead_flow);
                        self.note_consts_in_front_of_all_else(list, true, consts);
                    }
                    if let StmtKind::Expr(alone) = hir[statement].kind
                        && (self.find_value_that_printer_prints(alone, consts)).is_some()
                    {
                        dropped.insert(statement);
                    }
                    if let StmtKind::Var(declarations) = hir[statement].kind
                        && !dropped.contains(&statement)
                    {
                        for declaration in declarations.iter().map(|it| hir[it]) {
                            let value = declaration.init;
                            if consts.find(declaration.pat).is_some_and(|it| it.is_dropped)
                                && (self.find_value_that_printer_prints(value, consts)).is_some()
                            {
                                let whole = declaration.loc;
                                declarations_written_out.push((whole.pos, whole.end));
                                continue;
                            }
                            stack.push(TreeNode::Pattern(declaration.pat));
                            if value.is_some() {
                                stack.push(TreeNode::Expr(value));
                            }
                        }
                        continue;
                    }
                    if dropped.contains(&statement) {
                        not_printed.push((hir[statement].loc.pos, hir[statement].loc.end));
                        continue;
                    }
                    if let StmtKind::If { test, yes, no } = hir[statement].kind
                        && let Some(is_true) = self.find_side_that_printer_keeps(test, consts)
                    {
                        let (live, dead) = if is_true { (yes, no) } else { (no, yes) };
                        match self.keeps_never_run_code() || never_run.keeps_its_if(dead) {
                            true => stack.push(TreeNode::Expr(test)),
                            false => not_printed.push((hir[test].pos, hir[test].end)),
                        }
                        if dead.is_some() {
                            in_dead_flow.insert(dead);
                            never_run_branches.insert(dead);
                            stack.push(TreeNode::Stmt(dead));
                        }
                        if live.is_some() {
                            stack.push(TreeNode::Stmt(live));
                        }
                        continue;
                    }
                }
                TreeNode::Expr(expr) => {
                    if bodies_left_out.contains(&expr) {
                        continue;
                    }
                    let is_read_by_its_value = !printed_as_written.contains(&expr);
                    if !matches!(hir[expr].kind, ExprKind::String(_))
                        && is_read_by_its_value
                        && let Some(printed) = self.find_value_that_printer_prints(expr, consts)
                    {
                        if matches!(printed, Constant::String(text) if names_word(self.queries.atom_bytes(text)))
                        {
                            return own;
                        }
                        let is_member_of_enum =
                            self.decisions().constant(hir, expr) == FoldedValue::Unknown;
                        match hir[expr].kind {
                            ExprKind::Dot { .. } if is_member_of_enum => {
                                not_printed.push((hir[expr].pos, hir.name_pos(expr)));
                            }
                            ExprKind::Index { .. } if is_member_of_enum => {}
                            _ => {
                                let named = self.find_member_that_printer_names(expr, consts);
                                if named.is_some_and(|it| names_word(self.queries.atom_bytes(it))) {
                                    return own;
                                }
                                not_printed.push((hir[expr].pos, hir[expr].end));
                            }
                        }
                        continue;
                    }
                    match hir[expr].kind {
                        ExprKind::String(value) => {
                            if is_read_by_its_value && names_word(self.queries.atom_bytes(value)) {
                                return own;
                            }
                            read_by_their_values.push((hir[expr].pos, hir[expr].end));
                        }
                        ExprKind::Template { exprs } => {
                            let mut values = hir.ids(hir.template_texts(exprs));
                            if is_read_by_its_value
                                && values.any(|it| names_word(self.queries.atom_bytes(it)))
                            {
                                return own;
                            }
                            let mut start = hir[expr].pos;
                            for hole in hir.ids(exprs) {
                                read_by_their_values.push((start, hir[hole].pos));
                                start = hir[hole].end;
                            }
                            read_by_their_values.push((start, hir[expr].end));
                        }
                        ExprKind::ImportCall { .. } => imports.push(hir[expr].pos),
                        ExprKind::JsxText(value) => {
                            if names_word(self.queries.atom_bytes(value)) {
                                return own;
                            }
                            read_by_their_values.push((hir[expr].pos, hir[expr].end));
                        }
                        ExprKind::Jsx(jsx) => {
                            let attributes = hir[jsx].attrs.iter().map(|it| hir[it].value);
                            let texts = attributes.chain(hir.ids(hir[jsx].children));
                            for text in texts.filter(|it| it.is_some()) {
                                if let ExprKind::String(text) | ExprKind::JsxText(text) =
                                    hir[text].kind
                                    && bun_core::strings::contains(
                                        self.queries.atom_bytes(text),
                                        b"&#",
                                    )
                                {
                                    return own;
                                }
                            }
                        }
                        ExprKind::TaggedTemplate(call) => {
                            printed_as_written.insert(hir.template_of(call));
                        }
                        ExprKind::Regex { .. } => {
                            read_by_their_values.push((hir[expr].pos, hir[expr].end));
                        }
                        ExprKind::Object(properties) => {
                            for property in properties.iter() {
                                let PropKey::Name(name) = hir[property].key else {
                                    continue;
                                };
                                if names_word(self.queries.atom_bytes(name)) {
                                    return own;
                                }
                                let value = hir[property].value;
                                if value.is_some() {
                                    read_by_their_values.push((hir[property].pos, hir[value].pos));
                                }
                            }
                        }
                        ExprKind::Cond { test, branches } => {
                            if let Some(is_true) = self.find_side_that_printer_keeps(test, consts) {
                                let Branches { yes, no } = hir.branches(branches);
                                let (live, dead) = if is_true { (yes, no) } else { (no, yes) };
                                not_printed.push((hir[test].pos, hir[test].end));
                                not_printed.push((hir[dead].pos, hir[dead].end));
                                stack.push(TreeNode::Expr(live));
                                continue;
                            }
                        }
                        _ => {}
                    }
                    if let ExprKind::Call(id) = hir[expr].kind {
                        let callee = hir.skip_type_assertions(hir[id].callee);
                        has_direct_eval |= matches!(hir[callee].kind, ExprKind::Ident(known::eval));
                        let first = hir.ids(hir[id].args).next();
                        if let ExprKind::Ident(name) | ExprKind::Dot { name, .. } = hir[callee].kind
                            && let called = self.queries.atom_bytes(name)
                            && WORDS[1..].iter().any(|word| called.ends_with(word))
                            && hir[id].chain == Chain::No
                            && let Some(first) = first
                            && let Some(module) = self.find_name_that_search_reads(first, consts)
                        {
                            let whole = hir
                                .text
                                .get(hir[callee].pos as usize..hir[callee].end as usize);
                            let place =
                                whole.and_then(|it| bun_core::strings::last_index_of(it, called));
                            let Some(place) = place else {
                                return own;
                            };
                            let place = hir[callee].pos + place as u32;
                            if bun_core::strings::contains_char(
                                self.queries.atom_bytes(module),
                                b'"',
                            ) {
                                return own;
                            }
                            let is_printed_as_written =
                                |&byte: &u8| (b' '..=b'~').contains(&byte) && byte != b'\\';
                            if self
                                .queries
                                .atom_bytes(module)
                                .iter()
                                .all(is_printed_as_written)
                            {
                                let module = self.intern_atom(module);
                                asked.names.push(module);
                            }
                            not_printed.push((place, place + called.len() as u32));
                        }
                    }
                }
                TreeNode::Function(inner) => {
                    let never_runs =
                        floor_of_never_run_branch.is_some() && !self.keeps_never_run_code();
                    match hir[inner].body {
                        FnBody::Block(list) => {
                            let whole = self.compute_text_range(inner);
                            lists_of_statements.push((whole.start, whole.end));
                            if never_runs {
                                in_dead_flow.extend(hir.ids(list));
                            } else {
                                self.note_statements_behind_a_jump(list, &mut in_dead_flow);
                                if inner != function {
                                    self.note_consts_in_front_of_all_else(list, false, consts);
                                }
                            }
                        }
                        FnBody::Expr(value) if never_runs => {
                            not_printed.push((hir[value].pos, hir[value].end));
                            bodies_left_out.insert(value);
                        }
                        FnBody::Expr(_) | FnBody::None => {}
                    }
                }
                TreeNode::Class(class) => {
                    for member in hir[class].members.iter().map(|it| hir[it]) {
                        let (PropKey::Name(name) | PropKey::Private(name)) = member.key else {
                            continue;
                        };
                        if names_word(self.queries.atom_bytes(name)) {
                            return own;
                        }
                        let end = match (member.func.is_some(), member.init.is_some()) {
                            (true, _) => self.parameters_position(member.func),
                            (false, true) => hir[member.init].pos,
                            (false, false) => member.loc.end,
                        };
                        read_by_their_values.push((member.name_pos, end));
                    }
                }
                TreeNode::Pattern(pattern) => {
                    let PatKind::Object(properties) = hir[pattern].kind else {
                        push_children(hir, node, &mut stack);
                        continue;
                    };
                    for property in properties.iter().map(|it| hir[it]) {
                        let PropKey::Name(name) = property.key else {
                            continue;
                        };
                        if names_word(self.queries.atom_bytes(name)) {
                            return own;
                        }
                        if property.value.is_some() {
                            read_by_their_values.push((property.key_pos, hir[property.value].pos));
                        }
                    }
                }
            }
            push_children(hir, node, &mut stack);
        }
        let smallest_around = |ranges: &[(u32, u32)], place: u32| {
            let around = ranges.iter().filter(|it| it.0 <= place && place < it.1);
            around.min_by_key(|it| it.1 - it.0).copied()
        };
        let statements_of_file = self.statements_that_nest.get_or_init(|| {
            let statements = hir
                .stmts
                .iter()
                .filter(|it| !matches!(it.kind, StmtKind::Block(_)));
            StatementsThatNest::new(statements.map(|it| (it.start, it.loc.end)).collect())
        });
        let statement_of_function = statements_of_file.find_smallest_around(text.start);
        let has_mark = |at: u32| hir.text.get(at as usize + 2) == Some(&b'!');
        let first = match statement_of_function {
            Some(statement) => hir.comments.partition_point(|it| it.pos <= statement.0),
            None => hir.comments.partition_point(|it| it.pos < text.start),
        };
        let up_to_end = hir.comments[first..]
            .iter()
            .take_while(|it| it.pos < text.end);
        for comment in up_to_end.filter(|it| has_mark(it.pos)) {
            let whole = (comment.pos, comment.end);
            if text.start <= comment.pos {
                not_printed.push(whole);
            }
            let Some(said) = hir.text.get(comment.pos as usize..comment.end as usize) else {
                return own;
            };
            if !names_word(said) || !lists_of_statements.iter().any(|it| comment.pos < it.1) {
                continue;
            }
            let list = smallest_around(&lists_of_statements, comment.pos);
            let statement = smallest_around(&statements, comment.pos);
            let stands_between_statements = match (list, statement) {
                (Some(list), Some(statement)) => list.1 - list.0 < statement.1 - statement.0,
                (Some(_), None) => true,
                (None, _) => false,
            };
            if !stands_between_statements {
                let opens = lists_of_statements.iter().map(|it| it.0);
                let next_list = opens.filter(|&it| it > comment.pos).min();
                let end = statement.map_or(text.end, |it| it.1);
                let printed_at = next_list.map_or(end, |it| it.min(end));
                if imports
                    .iter()
                    .any(|&it| comment.end <= it && it < printed_at)
                {
                    continue;
                }
            }
            if bun_core::strings::contains(said, WORDS[0]) {
                return own;
            }
            for word in &WORDS[1..] {
                let mut from = 0;
                while let Some(found) = bun_core::strings::index_of(&said[from..], word) {
                    from += found + word.len();
                    let Some(name) = said[from..].strip_prefix(b"(\"") else {
                        return own;
                    };
                    let Some(length) = bun_core::strings::index_of_char_usize(name, b'"') else {
                        return own;
                    };
                    let name = self.intern_bytes(&name[..length]);
                    asked.names.push(name);
                }
            }
        }
        if !has_direct_eval {
            not_printed.append(&mut declarations_written_out);
        }
        let types = self.ranges_of_types.get_or_init(|| find_type_ranges(hir));
        let mut words = WORDS.iter();
        let not_printed_alone = merge_ranges(&[&not_printed]);
        let texts = merge_ranges(&[&not_printed_alone, &read_by_their_values]);
        if words.any(|word| stands_outside(written, text.start, word, &not_printed_alone, types))
            || stands_outside(written, text.start, b"\\", &texts, types)
        {
            return own;
        }
        asked
    }
}
