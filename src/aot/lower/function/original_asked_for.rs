use bun_sema::atom::{Atom, known};
use bun_sema::bind::Decl;
use bun_sema::erasure::{TypeRanges, find_type_ranges};
use bun_sema::fold::{Constant, FoldedValue, TreeNode, push_children};
use bun_sema::hir::{
    BinOp, Branches, Chain, ExprId, ExprKind, FnBody, FnId, IdList, PatId, PatKind, PropKey,
    StmtId, StmtKind, VarKind,
};
use bun_sema::import_sites::{
    WORDS_THAT_MOCK_LOOKS_FOR_IN_FACTORY as WORDS, may_spell_word_that_mock_looks_for,
    names_word_that_mock_looks_for as names_word,
};

use crate::ir::StringId;
use crate::ir::generated::SourceRange;
use crate::lower::FileLowering;

fn find_whether_true(decided: Constant) -> Option<bool> {
    match decided {
        Constant::Boolean(value) => Some(value),
        Constant::Undefined | Constant::Null => Some(false),
        Constant::Number(value) => Some(value != 0.0 && !value.is_nan()),
        Constant::String(_) | Constant::BigInt(_) => None,
    }
}

fn stands_outside(
    written: &[u8],
    start: u32,
    sought: &[u8],
    ranges: &[&[(u32, u32)]],
    types: &TypeRanges,
) -> bool {
    let mut from = 0;
    while let Some(found) = bun_core::strings::index_of(&written[from..], sought) {
        let place = start + (from + found) as u32;
        let mut all = ranges.iter().flat_map(|it| it.iter());
        if !all.any(|it| it.0 <= place && place < it.1) && !types.removes(place) {
            return true;
        }
        from += found + 1;
    }
    false
}

#[derive(Default)]
pub(super) struct OriginalsAskedFor {
    pub(super) may_be_own: bool,
    pub(super) names: Vec<StringId>,
}

impl FileLowering<'_, '_, '_, '_> {
    fn is_dropped_whole(&self, dead: StmtId) -> bool {
        let hir = self.hir;
        let mut stack = vec![dead];
        while let Some(statement) = stack.pop() {
            if statement.is_none() {
                continue;
            }
            match hir[statement].kind {
                StmtKind::Empty
                | StmtKind::Expr(_)
                | StmtKind::Throw(_)
                | StmtKind::Return(_)
                | StmtKind::Break(_)
                | StmtKind::Continue(_)
                | StmtKind::Class(_)
                | StmtKind::Debugger
                | StmtKind::Interface(_)
                | StmtKind::TypeAlias(_) => {}
                StmtKind::Fn(_) if statement != dead => {}
                StmtKind::Var(declarations) => {
                    if declarations.iter().any(|it| hir[it].kind == VarKind::Var) {
                        return false;
                    }
                }
                StmtKind::Block(statements) => stack.extend(hir.ids(statements)),
                StmtKind::Try {
                    block,
                    handler,
                    finalizer,
                    ..
                } => stack.extend([block, handler, finalizer]),
                StmtKind::If { yes, no, .. } => stack.extend([yes, no]),
                StmtKind::While { body, .. }
                | StmtKind::DoWhile { body, .. }
                | StmtKind::Labeled { body, .. } => stack.push(body),
                StmtKind::For { init, body, .. } => stack.extend([init, body]),
                StmtKind::ForIn { left, body, .. } | StmtKind::ForOf { left, body, .. } => {
                    stack.extend([left, body]);
                }
                _ => return false,
            }
        }
        let (start, end) = (hir[dead].loc.pos, hir[dead].loc.end);
        let mut comments = hir.comments.iter();
        !comments.any(|it| start <= it.pos && it.pos < end && self.has_mark(it.pos))
    }

    fn has_mark(&self, comment: u32) -> bool {
        self.hir.text.get(comment as usize + 2) == Some(&b'!')
    }

    fn note_consts_in_front_of_all_else(&self, list: IdList<StmtId>, names: &mut Vec<PatId>) {
        let hir = self.hir;
        for statement in hir.ids(list) {
            let declarations = match hir[statement].kind {
                StmtKind::Var(declarations) => declarations,
                StmtKind::Directive { .. }
                | StmtKind::Empty
                | StmtKind::Debugger
                | StmtKind::Interface(_)
                | StmtKind::TypeAlias(_)
                | StmtKind::Enum(_) => continue,
                _ => break,
            };
            if declarations.iter().any(|it| hir[it].kind != VarKind::Const) {
                break;
            }
            let may_be_written_out = |value: ExprId| {
                value.is_some()
                    && !matches!(
                        hir[hir.skip_type_assertions(value)].kind,
                        ExprKind::Binary { op: BinOp::Add, .. }
                    )
            };
            let written_out = (declarations.iter()).filter(|&it| may_be_written_out(hir[it].init));
            names.extend(written_out.map(|it| hir[it].pat));
        }
    }

    fn find_consts_that_printer_writes_out(&self, function: FnId) -> Vec<PatId> {
        let (hir, bound) = (self.hir, self.bound);
        let mut names = Vec::new();
        let mut around = function;
        while around.is_some() {
            if let FnBody::Block(list) = hir[around].body {
                self.note_consts_in_front_of_all_else(list, &mut names);
            }
            around = bound.fns[around.idx()].enclosing;
        }
        self.note_consts_in_front_of_all_else(hir.body, &mut names);
        names
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
        consts_that_printer_writes_out: &[PatId],
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
                            matches!(*it, Decl::Var(name) if consts_that_printer_writes_out.contains(&name))
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
                    self.find_enum_member_read(written)
                }
                _ => None,
            },
        }
    }

    fn find_side_that_printer_keeps(
        &mut self,
        test: ExprId,
        consts_that_printer_writes_out: &[PatId],
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
        consts_that_printer_writes_out: &[PatId],
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

    fn note_statements_behind_a_jump(&self, list: IdList<StmtId>, in_dead_flow: &mut Vec<StmtId>) {
        let hir = self.hir;
        let mut is_behind = false;
        for statement in hir.ids(list) {
            if is_behind {
                in_dead_flow.push(statement);
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
        let own = OriginalsAskedFor {
            may_be_own: true,
            names: Vec::new(),
        };
        let mut asked = OriginalsAskedFor::default();
        if !self.inputs.modules.is_any_module_named_by_mock() {
            return asked;
        }
        let hir = self.hir;
        let Some(written) = hir.text.get(text.start as usize..text.end as usize) else {
            return own;
        };
        if !self.may_word_come_from_outside_function()
            && !may_spell_word_that_mock_looks_for(written)
        {
            return asked;
        }
        let comments = hir.comments.iter().filter(|it| !self.has_mark(it.pos));
        let mut not_printed: Vec<(u32, u32)> = comments.map(|it| (it.pos, it.end)).collect();
        let mut lists_of_statements: Vec<(u32, u32)> = Vec::new();
        let mut statements: Vec<(u32, u32)> = Vec::new();
        let mut imports: Vec<u32> = Vec::new();
        let mut dropped: Vec<StmtId> = Vec::new();
        let mut read_by_their_values: Vec<(u32, u32)> = Vec::new();
        let mut consts = self.find_consts_that_printer_writes_out(function);
        let mut declarations_written_out: Vec<(u32, u32)> = Vec::new();
        let mut has_direct_eval = false;
        let mut printed_as_written: Vec<ExprId> = Vec::new();
        let mut in_dead_flow: Vec<StmtId> = Vec::new();
        not_printed.push((text.start, self.parameters_position(function)));
        let mut stack = vec![TreeNode::Function(function)];
        while let Some(node) = stack.pop() {
            match node {
                TreeNode::Stmt(statement) => {
                    let whole = (hir[statement].start, hir[statement].loc.end);
                    match hir[statement].kind {
                        StmtKind::Block(_) => lists_of_statements.push(whole),
                        _ => statements.push(whole),
                    }
                    if in_dead_flow.contains(&statement) {
                        if self.is_dropped_whole(statement) {
                            not_printed.push((hir[statement].loc.pos, hir[statement].loc.end));
                            continue;
                        }
                        if let StmtKind::Var(declarations) = hir[statement].kind {
                            for declaration in declarations.iter().map(|it| hir[it]) {
                                let value = declaration.init;
                                if value.is_some() {
                                    not_printed.push((hir[value].pos, hir[value].end));
                                }
                                stack.push(TreeNode::Pattern(declaration.pat));
                            }
                            continue;
                        }
                        let below = stack.len();
                        push_children(hir, node, &mut stack);
                        for child in &stack[below..] {
                            if let TreeNode::Stmt(child) = *child {
                                in_dead_flow.push(child);
                            }
                        }
                        continue;
                    }
                    if let StmtKind::Block(list) = hir[statement].kind {
                        self.note_statements_behind_a_jump(list, &mut in_dead_flow);
                        self.note_consts_in_front_of_all_else(list, &mut consts);
                    }
                    if let StmtKind::Expr(alone) = hir[statement].kind
                        && (self.find_value_that_printer_prints(alone, &consts)).is_some()
                    {
                        dropped.push(statement);
                    }
                    if let StmtKind::Var(declarations) = hir[statement].kind
                        && !dropped.contains(&statement)
                    {
                        for declaration in declarations.iter().map(|it| hir[it]) {
                            let value = declaration.init;
                            if consts.contains(&declaration.pat)
                                && (self.find_value_that_printer_prints(value, &consts)).is_some()
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
                        && let Some(is_true) = self.find_side_that_printer_keeps(test, &consts)
                    {
                        let (live, dead) = if is_true { (yes, no) } else { (no, yes) };
                        not_printed.push((hir[test].pos, hir[test].end));
                        if dead.is_some() {
                            in_dead_flow.push(dead);
                            stack.push(TreeNode::Stmt(dead));
                        }
                        if live.is_some() {
                            stack.push(TreeNode::Stmt(live));
                        }
                        continue;
                    }
                }
                TreeNode::Expr(expr) => {
                    let is_read_by_its_value = !printed_as_written.contains(&expr);
                    if !matches!(hir[expr].kind, ExprKind::String(_))
                        && is_read_by_its_value
                        && let Some(printed) = self.find_value_that_printer_prints(expr, &consts)
                    {
                        if matches!(printed, Constant::String(text) if names_word(self.queries.atom_bytes(text)))
                        {
                            return own;
                        }
                        not_printed.push((hir[expr].pos, hir[expr].end));
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
                            printed_as_written.push(hir.template_of(call));
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
                            if let Some(is_true) = self.find_side_that_printer_keeps(test, &consts)
                            {
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
                            && let Some(module) = self.find_name_that_search_reads(first, &consts)
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
                            let is_printed_as_written = |&byte: &u8| {
                                (b' '..=b'~').contains(&byte) && byte != b'"' && byte != b'\\'
                            };
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
                    if let FnBody::Block(list) = hir[inner].body {
                        let whole = self.compute_text_range(inner);
                        lists_of_statements.push((whole.start, whole.end));
                        self.note_statements_behind_a_jump(list, &mut in_dead_flow);
                        if inner != function {
                            self.note_consts_in_front_of_all_else(list, &mut consts);
                        }
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
        let statement_of_function = || {
            let statements = hir
                .stmts
                .iter()
                .filter(|it| !matches!(it.kind, StmtKind::Block(_)));
            let ranges: Vec<_> = statements.map(|it| (it.start, it.loc.end)).collect();
            smallest_around(&ranges, text.start)
        };
        let has_mark = |at: u32| hir.text.get(at as usize + 2) == Some(&b'!');
        for comment in hir.comments.iter().filter(|it| has_mark(it.pos)) {
            if comment.pos >= text.end {
                break;
            }
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
            if comment.pos < text.start
                && !statement_of_function().is_some_and(|it| it.0 < comment.pos)
            {
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
        let texts = [&not_printed[..], &read_by_their_values[..]];
        if words.any(|word| stands_outside(written, text.start, word, &texts[..1], types))
            || stands_outside(written, text.start, b"\\", &texts, types)
        {
            return own;
        }
        asked
    }
}
