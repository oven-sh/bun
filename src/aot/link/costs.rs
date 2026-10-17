use super::by_name::{Access, Chain};
use crate::declared::Part;
use crate::id::{LayoutId, StrId, TyId};
use crate::ir::{Def, Func, FuncKind, Layout, LayoutKind, Op, Prediction, Program, Term, class_flags, field_flags, func_flags};
use crate::positions::access_pos;
use bun_sema::aot_rules::Rule;
use bun_sema::check::{CompilerDiagnostic, Place, Program as Checked, compute_ecma_line_starts};
use bun_sema::hir::{ClassId, ExprId, ExprKind};
use bun_sema::messages;
use bun_sema::program::FileId;
use bun_sema::resolve::get_relative_path_from_directory;
use bun_sema::util::{InParallel, for_each_mut};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::{SmallVec, smallvec};
use std::fmt::Write;

const FUNCTIONS_PER_TASK: usize = 256;
const MAX_ROWS_SHOWN: usize = 20;
const MAX_STEPS_SHOWN: usize = 6;
const MAX_NAMES_SHOWN: usize = 4;
const MAX_EXAMPLES_KEPT: usize = 3;
const MAX_SOURCE_SHOWN: usize = 120;
const MAX_HANDOVERS_FOLLOWED: usize = 8;
const MAX_LOOP_DEPTH_COUNTED: u32 = 2;
const STEPS_LEFT_OUT: u32 = 100071;
const RUNTIME_DECLARATIONS: [&[u8]; 3] = [b"node", b"bun", b"bun-types"];
const SPECIALIZED_BY_ARGUMENT: [(&str, &str, &str); 2] = [("JSON", "stringify", "JSON.stringify"), ("Response", "json", "Response.json")];
const WEIGHT_OF_A_LOOP: f64 = 8.0;
const WEIGHT_AT_START: f64 = 1.0 / 64.0;

#[derive(Copy, Clone, PartialEq, Eq)]
enum Kind {
    Read,
    Store,
    Call,
    Check,
    CheckThatMayCopy,
    CheckOfParameters,
    GuardedAccess,
    UnspecializedCall,
}

impl Kind {
    fn weight(self) -> f64 {
        match self {
            Kind::Read | Kind::Store => 10.0,
            Kind::Call => 20.0,
            Kind::Check | Kind::CheckOfParameters => 5.0,
            Kind::CheckThatMayCopy => 30.0,
            Kind::GuardedAccess => 2.0,
            Kind::UnspecializedCall => 1000.0,
        }
    }
}

#[derive(Default, Clone)]
struct Tally {
    reads: u32,
    stores: u32,
    calls: u32,
    checks: u32,
    checks_that_may_copy: u32,
    checks_of_parameters: u32,
    guarded_accesses: u32,
    unspecialized_calls: u32,
    weight: f64,
    functions: FxHashSet<u32>,
    functions_after_start: FxHashSet<u32>,
}

impl Tally {
    fn add(&mut self, kind: Kind, at: Occurrence) {
        *match kind {
            Kind::Read => &mut self.reads,
            Kind::Store => &mut self.stores,
            Kind::Call => &mut self.calls,
            Kind::Check => &mut self.checks,
            Kind::CheckThatMayCopy => &mut self.checks_that_may_copy,
            Kind::CheckOfParameters => &mut self.checks_of_parameters,
            Kind::GuardedAccess => &mut self.guarded_accesses,
            Kind::UnspecializedCall => &mut self.unspecialized_calls,
        } += 1;
        self.weight += kind.weight() * at.frequency;
        self.functions.insert(at.function);
        if !at.is_at_start {
            self.functions_after_start.insert(at.function);
        }
    }

    fn absorb(&mut self, other: &Tally) {
        self.reads += other.reads;
        self.stores += other.stores;
        self.calls += other.calls;
        self.checks += other.checks;
        self.checks_that_may_copy += other.checks_that_may_copy;
        self.checks_of_parameters += other.checks_of_parameters;
        self.guarded_accesses += other.guarded_accesses;
        self.unspecialized_calls += other.unspecialized_calls;
        self.weight += other.weight;
        self.functions.extend(&other.functions);
        self.functions_after_start.extend(&other.functions_after_start);
    }

    fn is_empty(&self) -> bool {
        self.functions.is_empty()
    }

    fn parts(&self) -> Vec<String> {
        [
            counted(self.reads, "read by name", "reads by name"),
            counted(self.stores, "store by name", "stores by name"),
            counted(self.calls, "call by name", "calls by name"),
            counted(self.checks, "check of a type", "checks of a type"),
            counted(self.checks_that_may_copy, "check that may copy the object into another layout", "checks that may copy the object into another layout"),
            counted(self.checks_of_parameters, "function that checks its parameters when it is entered", "functions that check their parameters when they are entered"),
            counted(self.guarded_accesses, "field access that tests the object first", "field accesses that test the object first"),
            counted(self.unspecialized_calls, "call of a built-in that is not specialized for its argument", "calls of built-ins that are not specialized for their arguments"),
        ]
        .into_iter()
        .flatten()
        .collect()
    }
}

#[derive(Copy, Clone)]
struct Occurrence {
    function: u32,
    frequency: f64,
    is_at_start: bool,
    may_be_copied: bool,
}

impl Occurrence {
    fn join(&mut self, other: Occurrence) {
        let may_be_copied = self.may_be_copied || other.may_be_copied;
        if self.frequency < other.frequency {
            *self = other;
        }
        self.may_be_copied = may_be_copied;
    }
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct FunctionHandedOver {
    to: u32,
    as_argument: u32,
    function: u32,
}

#[derive(Default)]
struct Counted {
    by_position: FxHashMap<(u32, u32), Occurrence>,
    checked_values: FxHashMap<(u32, u32), u32>,
    read_through: FxHashMap<(u32, u32), u32>,
    functions_handed_over: Vec<FunctionHandedOver>,
    unspecialized_calls: Vec<(u32, u32, &'static str, Occurrence)>,
    through_layout: FxHashMap<u32, Tally>,
    stores_testing_integrity: Tally,
    through_records_of_any_prototype: Tally,
    in_untyped_module: FxHashMap<u32, Tally>,
}

fn successors(term: &Term, mut visit: impl FnMut(usize)) {
    match term {
        Term::Jump(target) => visit(target.block.idx()),
        Term::Branch { then, otherwise, .. } => {
            visit(then.block.idx());
            visit(otherwise.block.idx());
        }
        Term::Switch { cases, default, .. } => {
            for case in cases {
                visit(case.1.block.idx());
            }
            visit(default.block.idx());
        }
        Term::Invoke { normal, unwind } => {
            visit(normal.block.idx());
            visit(unwind.block.idx());
        }
        Term::Throw { unwind: Some(unwind), .. } => visit(unwind.block.idx()),
        Term::Throw { unwind: None, .. } | Term::Return(_) | Term::Unreachable => {}
    }
}

fn loop_depths(func: &Func) -> Vec<u32> {
    let count = func.blocks.len();
    let mut depths = vec![0; count];
    if count == 0 {
        return depths;
    }
    let mut following: Vec<Vec<usize>> = vec![Vec::new(); count];
    let mut preceding: Vec<Vec<usize>> = vec![Vec::new(); count];
    for (block, contents) in func.blocks.iter().enumerate() {
        if let Some(term) = &contents.term {
            successors(term, |next| {
                following[block].push(next);
                preceding[next].push(block);
            });
        }
    }
    let (mut is_entered, mut is_open) = (vec![false; count], vec![false; count]);
    let mut latches_of: FxHashMap<usize, Vec<usize>> = FxHashMap::default();
    let mut path: Vec<(usize, usize)> = vec![(0, 0)];
    (is_entered[0], is_open[0]) = (true, true);
    while let Some(&mut (block, ref mut next)) = path.last_mut() {
        let Some(&target) = following[block].get(*next) else {
            is_open[block] = false;
            path.pop();
            continue;
        };
        *next += 1;
        if is_open[target] {
            latches_of.entry(target).or_default().push(block);
        } else if !std::mem::replace(&mut is_entered[target], true) {
            is_open[target] = true;
            path.push((target, 0));
        }
    }
    for (head, latches) in latches_of {
        let mut is_inside = vec![false; count];
        is_inside[head] = true;
        let mut pending = latches;
        while let Some(block) = pending.pop() {
            if !std::mem::replace(&mut is_inside[block], true) {
                pending.extend_from_slice(&preceding[block]);
            }
        }
        for (depth, _) in depths.iter_mut().zip(is_inside).filter(|block| block.1) {
            *depth += 1;
        }
    }
    depths
}

fn find_functions_running_only_at_start(program: &Program) -> Vec<bool> {
    let mut is_held_as_value: Vec<bool> = program.funcs.iter().map(|func| func.has(func_flags::IS_VALUE)).collect();
    let mut callees: Vec<Vec<u32>> = vec![Vec::new(); program.funcs.len()];
    let mut is_called = vec![false; program.funcs.len()];
    for (caller, func) in program.funcs.iter().enumerate() {
        for value in &func.values {
            match value.def {
                Def::Op(Op::Closure { func, .. } | Op::ClosureOnce { func, .. } | Op::FuncRef(func)) => is_held_as_value[func.idx()] = true,
                Def::Op(Op::CallDirect { func, .. }) => {
                    callees[caller].push(func.idx() as u32);
                    is_called[func.idx()] = true;
                }
                _ => {}
            }
        }
    }
    for layout in &program.layouts {
        for func in layout.methods.iter().map(|method| method.func).chain([layout.constructor]).filter(|func| func.is_some()) {
            is_held_as_value[func.idx()] = true;
        }
    }
    let mut is_only_at_start: Vec<bool> = (0..program.funcs.len()).map(|func| program.funcs[func].kind == FuncKind::Module || is_called[func] && !is_held_as_value[func]).collect();
    let mut pending: Vec<usize> = (0..program.funcs.len()).filter(|&func| !is_only_at_start[func]).collect();
    while let Some(caller) = pending.pop() {
        for &callee in &callees[caller] {
            if program.funcs[callee as usize].kind != FuncKind::Module && std::mem::replace(&mut is_only_at_start[callee as usize], false) {
                pending.push(callee as usize);
            }
        }
    }
    is_only_at_start
}

fn count(program: &Program, in_parallel: InParallel<'_>) -> Counted {
    let is_only_at_start = find_functions_running_only_at_start(program);
    let mut gives_up_its_layout_instead: Vec<bool> = (program.layouts.iter())
        .map(|layout| layout.kind != LayoutKind::Environment && layout.is_allocated && layout.accepts_untyped && !layout.is_relaxed_for_logging && !layout.accepts_only_other_layouts)
        .collect();
    for member in program.layouts.iter().filter(|view| !view.accepts_untyped).flat_map(|view| &view.members) {
        gives_up_its_layout_instead[member.idx()] = false;
    }
    let tests_integrity: Vec<bool> = program.layouts.iter().map(|view| view.members.iter().any(|member| program.layouts[member.idx()].may_be_frozen && !gives_up_its_layout_instead[member.idx()])).collect();
    let is_record_of_any_prototype = |layout: LayoutId| program.layouts[layout.idx()].kind == LayoutKind::Record && program.layouts[layout.idx()].class_flags & class_flags::MAY_HAVE_OTHER_PROTOTYPE != 0;
    let holds_records_of_any_prototype: Vec<bool> = program.layouts.iter().map(|view| view.members.iter().any(|&member| is_record_of_any_prototype(member))).collect();
    let mut tasks: Vec<(usize, &[Func], Counted)> = program.funcs.chunks(FUNCTIONS_PER_TASK).enumerate().map(|(task, funcs)| (task * FUNCTIONS_PER_TASK, funcs, Counted::default())).collect();
    for_each_mut(&mut tasks, in_parallel, &|(first, funcs, counted)| {
        let mut asks_the_prototype: FxHashMap<(u32, StrId), bool> = FxHashMap::default();
        let is_of_program = |func: &Func| func.flags & (func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE) == 0 && func.module.is_some();
        for (index, func) in funcs.iter().enumerate().filter(|func| is_of_program(func.1)) {
            let function = (*first + index) as u32;
            let (module, is_typed, is_at_start) = (func.module.idx() as u32, func.has(func_flags::IS_TYPED), is_only_at_start[function as usize]);
            let depths = loop_depths(func);
            for (block, contents) in func.blocks.iter().enumerate() {
                let frequency = WEIGHT_OF_A_LOOP.powi(depths[block].min(MAX_LOOP_DEPTH_COUNTED) as i32) * if is_at_start { WEIGHT_AT_START } else { 1.0 };
                let at = Occurrence { function, frequency, is_at_start, may_be_copied: false };
                for value in contents.ops.iter().map(|v| &func.values[v.idx()]) {
                    let Def::Op(op) = &value.def else { continue };
                    if !is_typed {
                        let kind = match op {
                            Op::PropGet { .. } | Op::ElemGet { .. } => Kind::Read,
                            Op::PropSet { .. } | Op::ElemSet { .. } => Kind::Store,
                            Op::CallMethod { .. } | Op::Call { .. } | Op::Construct { .. } => Kind::Call,
                            _ => continue,
                        };
                        counted.in_untyped_module.entry(module).or_default().add(kind, at);
                        continue;
                    }
                    let mut at = at;
                    if let Op::Coerce { value: mut checked, to, .. } = *op {
                        let is_layout = |part: &Part| matches!(part, Part::Class(_));
                        let is_open_layout = |part: &Part| matches!(*part, Part::Class(layout) if program.layouts[layout.idx()].accepts_untyped);
                        let may_hold_an_untyped_object = func.ty(checked).is_none() || program.tys.get(func.ty(checked)).any_object || program.tys.get(func.ty(checked)).parts.iter().any(is_open_layout);
                        at.may_be_copied = may_hold_an_untyped_object && to.is_some() && program.tys.get(to).parts.iter().any(is_layout);
                        while let Some(&(Op::Coerce { value: inner, .. } | Op::Await(inner))) = func.op(checked) {
                            checked = inner;
                        }
                        if let Some(Op::PropGet { .. } | Op::CallMethod { .. } | Op::Call { .. } | Op::CallDirect { .. } | Op::Construct { .. } | Op::FieldGet { .. }) = func.op(checked) {
                            counted.checked_values.entry((module, value.pos)).or_insert_with(|| func.values[checked.idx()].pos);
                        }
                    }
                    let member_called = match op {
                        Op::CallMethod { obj, name, args, .. } => Some((*obj, *name, args)),
                        Op::Call { callee, args, .. } => match func.op(*callee) {
                            Some(&Op::PropGet { obj, name }) => Some((obj, name, args)),
                            _ => None,
                        },
                        _ => None,
                    };
                    if let Some((holder, name, args)) = member_called
                        && let Some(&Op::FreeGet { name: global, .. }) = func.op(holder)
                        && let Some(&(_, _, shown)) = SPECIALIZED_BY_ARGUMENT.iter().find(|known| known.0.as_bytes() == program.strs.get(global) && known.1.as_bytes() == program.strs.get(name))
                        && let Some(&argument) = args.first()
                        && (func.ty(argument).is_none() || func.ty(argument) == program.tys.anything || program.tys.get(func.ty(argument)).any_object)
                    {
                        counted.unspecialized_calls.push((module, value.pos, shown, at));
                    }
                    let called = match op {
                        Op::CallDirect { func: called, args } => Some((*called, args)),
                        Op::Call { callee, args, .. } => match (func.prediction(*callee), func.op(*callee)) {
                            (Prediction::Closure(called), _) => Some((called, args)),
                            (_, Some(&Op::GlobalGet(variable))) if program.globals[variable.idx()].single_function.is_some() => Some((program.globals[variable.idx()].single_function, args)),
                            _ => None,
                        },
                        _ => None,
                    };
                    for (as_argument, &argument) in called.iter().flat_map(|called| called.1.iter().enumerate()) {
                        let mut handed_over = argument;
                        while let Some(&Op::Coerce { value: inner, .. }) = func.op(handed_over) {
                            handed_over = inner;
                        }
                        if let (Some(&(Op::Closure { func: function, .. } | Op::ClosureOnce { func: function, .. } | Op::FuncRef(function))), Some((to, _))) = (func.op(handed_over), called) {
                            counted.functions_handed_over.push(FunctionHandedOver { to: to.idx() as u32, as_argument: as_argument as u32, function: function.idx() as u32 });
                        }
                    }
                    let (layouts, name, is_store): (SmallVec<[LayoutId; 2]>, StrId, bool) = match *op {
                        Op::PropGet { obj, name } | Op::PropSet { obj, name, .. } | Op::CallMethod { obj, name, .. } if func.ty(obj).is_some() => {
                            let of_receiver = program.tys.get(func.ty(obj)).parts.iter().filter_map(|part| match *part {
                                Part::Class(layout) => Some(layout),
                                _ => None,
                            });
                            (of_receiver.collect(), name, matches!(op, Op::PropSet { .. }))
                        }
                        Op::FieldGet { layout, field, .. } => (smallvec![layout], program.layouts[layout.idx()].fields[field as usize].name, false),
                        Op::FieldSet { layout, field, .. } => (smallvec![layout], program.layouts[layout.idx()].fields[field as usize].name, true),
                        _ => (SmallVec::new(), StrId::NONE, false),
                    };
                    for layout in layouts.iter().filter(|layout| program.layouts[layout.idx()].accepts_untyped) {
                        counted.through_layout.entry(layout.idx() as u32).or_default().add(Kind::GuardedAccess, at);
                        counted.read_through.entry((module, value.pos)).or_insert_with(|| layout.idx() as u32);
                    }
                    if is_store && layouts.iter().any(|layout| tests_integrity[layout.idx()]) {
                        counted.stores_testing_integrity.add(Kind::GuardedAccess, at);
                    }
                    let mut may_ask_the_prototype = |view: LayoutId| {
                        holds_records_of_any_prototype[view.idx()]
                            && *asks_the_prototype.entry((view.idx() as u32, name)).or_insert_with(|| {
                                let is_always_there = |member: &Layout| member.field(name).is_some_and(|field| member.fields[field as usize].flags & field_flags::NEVER_OBSERVED_ABSENT != 0);
                                program.layouts[view.idx()].members.iter().any(|&member| is_record_of_any_prototype(member) && !is_always_there(&program.layouts[member.idx()]))
                            })
                    };
                    if layouts.iter().any(|&layout| may_ask_the_prototype(layout)) {
                        counted.through_records_of_any_prototype.add(Kind::GuardedAccess, at);
                    }
                    match *op {
                        Op::PropGet { .. } | Op::PropSet { .. } | Op::CallMethod { .. } | Op::Coerce { .. } => {
                            counted.by_position.entry((module, value.pos)).or_insert(at).join(at);
                        }
                        Op::Call { callee, .. } if !matches!(func.prediction(callee), Prediction::Closure(_)) => {
                            counted.by_position.entry((module, value.pos)).or_insert(at);
                        }
                        _ => {}
                    }
                }
            }
        }
    });
    let mut all = Counted::default();
    for (_, _, counted) in tasks {
        for (position, at) in counted.by_position {
            all.by_position.entry(position).or_insert(at).join(at);
        }
        for (position, produced_at) in counted.checked_values {
            all.checked_values.entry(position).or_insert(produced_at);
        }
        for (position, layout) in counted.read_through {
            all.read_through.entry(position).or_insert(layout);
        }
        for (layout, tally) in counted.through_layout {
            all.through_layout.entry(layout).or_default().absorb(&tally);
        }
        for (module, tally) in counted.in_untyped_module {
            all.in_untyped_module.entry(module).or_default().absorb(&tally);
        }
        all.functions_handed_over.extend(counted.functions_handed_over);
        all.unspecialized_calls.extend(counted.unspecialized_calls);
        all.stores_testing_integrity.absorb(&counted.stores_testing_integrity);
        all.through_records_of_any_prototype.absorb(&counted.through_records_of_any_prototype);
    }
    all.functions_handed_over.sort_unstable();
    all.functions_handed_over.dedup();
    all.unspecialized_calls.sort_by_key(|call| (call.0, call.1));
    all.unspecialized_calls.dedup_by_key(|call| (call.0, call.1));
    all
}

struct Row {
    cause: CompilerDiagnostic,
    steps: Vec<CompilerDiagnostic>,
    steps_are_of_rule: Rule,
    weight_by_rule: [f64; Rule::COUNT],
    findings_by_rule: [u32; Rule::COUNT],
    affected: Vec<Vec<u8>>,
    examples: Vec<(FileId, u32)>,
    other_causes: Vec<(FileId, u32)>,
    fix: Option<Vec<u8>>,
    tally: Tally,
}

fn is_where_a_chain_ends(code: u32) -> bool {
    matches!(code, 100063..=100065 | 100072 | 100075..=100079 | 100085)
}

fn cause_and_steps(finding: &CompilerDiagnostic) -> (&CompilerDiagnostic, &[CompilerDiagnostic]) {
    let end = finding.related.iter().position(|step| is_where_a_chain_ends(step.code)).or_else(|| finding.related.len().checked_sub(1));
    match end {
        Some(end) => (&finding.related[end], &finding.related[..end]),
        None => (finding, &[]),
    }
}

fn rule_of_cause(code: u32) -> Option<Rule> {
    match code {
        100041 | 100063..=100074 => Some(Rule::ExternalType),
        100040 | 100042..=100048 => Some(Rule::OpenLayout),
        100075..=100079 => Some(Rule::ByName),
        100018 | 100086 => Some(Rule::CanThrow),
        100087..=100090 => Some(Rule::ByName),
        100085 => Some(Rule::LostLayout),
        _ => Rule::of_code(code),
    }
}

impl Row {
    fn rule(&self) -> Rule {
        if let Some(rule) = rule_of_cause(self.cause.code) {
            return rule;
        }
        let heaviest = (0..Rule::COUNT).filter(|&rule| self.findings_by_rule[rule] > 0).max_by(|&a, &b| self.weight_by_rule[a].total_cmp(&self.weight_by_rule[b]).then(b.cmp(&a)));
        bun_sema::aot_rules::RULES[heaviest.unwrap_or(0)].rule
    }
}

#[derive(Default)]
struct Table<'a> {
    rows: Vec<Row>,
    row_at: FxHashMap<(FileId, u32), usize>,
    earlier_cause: FxHashMap<(FileId, u32), &'a CompilerDiagnostic>,
}

impl<'a> Table<'a> {
    fn add<'c>(&mut self, mut cause: &'c CompilerDiagnostic, steps: &'c [CompilerDiagnostic], rule: Rule, affected: Option<&[u8]>, fix: Option<&[u8]>, tally: &Tally) -> usize
    where
        'a: 'c,
    {
        let mut handovers = Vec::new();
        while let Some(&earlier) = self.earlier_cause.get(&(cause.file, cause.start)).filter(|_| handovers.len() < MAX_HANDOVERS_FOLLOWED) {
            handovers.push(cause);
            cause = earlier;
        }
        let row = *self.row_at.entry((cause.file, cause.start)).or_insert_with(|| {
            self.rows.push(Row {
                cause: CompilerDiagnostic { related: Vec::new(), ..copy_of(cause) },
                steps: steps.iter().chain(handovers.iter().copied()).map(copy_of).collect(),
                steps_are_of_rule: rule,
                weight_by_rule: [0.0; Rule::COUNT],
                findings_by_rule: [0; Rule::COUNT],
                affected: Vec::new(),
                examples: Vec::new(),
                other_causes: Vec::new(),
                fix: None,
                tally: Tally::default(),
            });
            self.rows.len() - 1
        });
        self.add_to(row, rule, tally);
        let row_added_to = &mut self.rows[row];
        if row_added_to.steps_are_of_rule != rule && rule_of_cause(cause.code) == Some(rule) {
            row_added_to.steps = steps.iter().chain(handovers.iter().copied()).map(copy_of).collect();
            row_added_to.steps_are_of_rule = rule;
        }
        if let Some(affected) = affected.filter(|affected| !row_added_to.affected.iter().any(|known| known.as_slice() == *affected)) {
            row_added_to.affected.push(affected.to_vec());
        }
        if row_added_to.fix.is_none() {
            row_added_to.fix = fix.map(<[u8]>::to_vec);
        }
        row
    }

    fn add_example(&mut self, row: usize, finding: &CompilerDiagnostic) {
        let row = &mut self.rows[row];
        if row.examples.len() < MAX_EXAMPLES_KEPT && (finding.file, finding.start) != (row.cause.file, row.cause.start) {
            row.examples.push((finding.file, finding.start));
        }
    }

    fn add_to(&mut self, row: usize, rule: Rule, tally: &Tally) {
        let row = &mut self.rows[row];
        row.weight_by_rule[rule as usize] += tally.weight;
        row.findings_by_rule[rule as usize] += 1;
        row.tally.absorb(tally);
    }
}

fn fix_for(code: u32) -> &'static str {
    match code {
        100041 | 100063 => "check the value where it enters the program and build a new object from it in typed code, instead of asserting its type",
        100040 | 100042 | 100043 | 100044 | 100066 | 100067 | 100068 => "give the value its type before it gets here, or copy its fields into a new object literal of the declared type",
        100045 => "create the objects in typed code, or compile the package that creates them with its types",
        100046 | 100047 | 100065 => "pass a copy, or only the fields that are needed, to the JavaScript code",
        100075 | 100076 => "annotate the declaration with the type of the objects it holds",
        100077 => "declare the return type of the function that is called",
        100078 => "use a Map, or declare the keys that are known as properties",
        100079 => "constrain the type parameter to a type that declares the properties that are read",
        100080 => "apply it to the object literal itself or to a value of a declared object type, not to 'any'",
        100081 => "make the object with its prototype (a class, or Object.create at its creation), or give the operand a declared object type",
        100025 => "generate the code when the program is built, or keep it away from code that has to be fast",
        100026 => "use a version of the package that ships TypeScript sources, or add a typed version of it",
        100083 => "turn the file into TypeScript",
        100087 => "make the call where the type of the value is known, or give the value a declared type",
        100090 => "check or convert the value where it enters typed code: a parameter that untyped code passes, a field of data from outside, the result of an untyped call",
        100086 => "declare that parameter with concrete parameter types; where the code has to be fast, call the function directly, for example from a loop in place of the helper",
        100009 | 100010 | 100011 | 100084 => "fix the type errors that the build lists for it",
        100022 => "create every object of this type in typed code",
        100023 | 100024 | 100027 => "remove what the lines above name",
        _ => "",
    }
}

struct Locations<'a, 's> {
    checked: &'a Checked<'s>,
    shown_from: &'a [u8],
    line_starts: FxHashMap<FileId, Vec<u32>>,
}

impl Locations<'_, '_> {
    fn path(&self, file: FileId) -> String {
        const INSTALLED_IN: &[u8] = b"/node_modules/";
        let name = self.checked.files.module(file).file_name();
        let shown = match bun_core::strings::last_index_of(name, INSTALLED_IN) {
            Some(at) if self.checked.files.module(file).is_dependency => name[at + 1..].to_vec(),
            _ if name.starts_with(b"/") => get_relative_path_from_directory(self.shown_from, name, self.checked.files.is_case_sensitive),
            _ => name.to_vec(),
        };
        bstr::BStr::new(&shown).to_string()
    }

    fn line_and_column(&mut self, file: FileId, pos: u32) -> (usize, usize) {
        let text = &self.checked.files.hir(file).text;
        let starts = self.line_starts.entry(file).or_insert_with(|| compute_ecma_line_starts(text));
        let line = starts.partition_point(|&start| start <= pos).max(1) - 1;
        let before = &text[(starts[line] as usize).min(text.len())..(pos as usize).min(text.len())];
        (line + 1, bstr::BStr::new(before).to_string().encode_utf16().count() + 1)
    }
}

impl Locations<'_, '_> {
    fn source_line(&mut self, file: FileId, pos: u32) -> String {
        let line = self.line_and_column(file, pos).0 - 1;
        let text = &self.checked.files.hir(file).text;
        let starts = &self.line_starts[&file];
        let end = starts.get(line + 1).map_or(text.len(), |&next| next as usize).min(text.len());
        let written = bstr::BStr::new(text[(starts[line] as usize).min(end)..end].trim_ascii()).to_string();
        if written.chars().count() <= MAX_SOURCE_SHOWN { written } else { written.chars().take(MAX_SOURCE_SHOWN).chain(" ..".chars()).collect() }
    }
}

fn copy_of(found: &CompilerDiagnostic) -> CompilerDiagnostic {
    CompilerDiagnostic { file: found.file, start: found.start, end: found.end, code: found.code, args: found.args.clone(), related: found.related.iter().map(copy_of).collect() }
}

fn text_of(found: &CompilerDiagnostic) -> String {
    let mut text = Vec::new();
    if let Some((_, template)) = messages::message(found.code) {
        messages::format(&mut text, template, &found.args);
    }
    bstr::BStr::new(&text).to_string()
}

fn counted(count: u32, one: &str, many: &str) -> Option<String> {
    (count > 0).then(|| format!("{count} {}", if count == 1 { one } else { many }))
}

fn quoted(text: &str) -> String {
    let mut out = String::new();
    let _ = bun_core::fmt::encode_json_string(&mut out, text.as_bytes());
    out
}

pub(super) struct Sources<'a, 's> {
    pub program: &'a Program,
    pub checked: &'a Checked<'s>,
    pub modules: &'a [FileId],
    pub shown_from: &'a [u8],
    pub found: &'a [CompilerDiagnostic],
    pub open_layouts: &'a [(LayoutId, usize)],
    pub chains: &'a [Chain],
    pub checks_of_parameters: &'a FxHashSet<(FileId, u32)>,
    pub accesses_without_known_cause: &'a [(Place, Option<CompilerDiagnostic>)],
    pub classes_without_layout: &'a FxHashSet<(FileId, ClassId)>,
    pub other_places_where_external_data_enters: &'a [(Place, CompilerDiagnostic)],
}

pub(super) fn explain(sources: &Sources<'_, '_>, as_json: bool, in_parallel: InParallel<'_>) -> Vec<String> {
    let Sources { program, checked, modules, shown_from, found, open_layouts, chains, checks_of_parameters, accesses_without_known_cause, classes_without_layout, other_places_where_external_data_enters } = *sources;
    let counted_in_code = count(program, in_parallel);
    let module_of: FxHashMap<FileId, u32> = modules.iter().enumerate().map(|(module, &file)| (file, module as u32)).collect();
    let chain_at: FxHashMap<(FileId, u32), &Chain> = chains.iter().map(|chain| ((chain.file, chain.name_pos), chain)).collect();
    let layout_of_finding: FxHashMap<usize, LayoutId> = open_layouts.iter().map(|&(layout, finding)| (finding, layout)).collect();
    let checker = checked.checker();
    let fallen = checked.compiled_untyped.lock();
    let fallen_package = |package: &[u8]| fallen.iter().find(|record| checker.name_of_package_holding(record.file).is_some_and(|holding| holding == package));
    let mut untyped_by_package: FxHashMap<Vec<u8>, Tally> = FxHashMap::default();
    let mut untyped_files: Vec<(FileId, &Tally)> = Vec::new();
    for (&module, tally) in &counted_in_code.in_untyped_module {
        let file = modules[module as usize];
        if !checked.files.module(file).is_untyped() || bun_core::strings::contains(checked.files.module(file).path.text, b"/.bun-aot-prelude/") {
            continue;
        }
        match checker.name_of_package_holding(file) {
            Some(package) => untyped_by_package.entry(package).or_default().absorb(tally),
            None => untyped_files.push((file, tally)),
        }
    }
    untyped_files.sort_unstable_by_key(|untyped| untyped.0);

    let mut table = Table::default();
    for finding in found.iter().filter(|finding| Rule::of_code(finding.code) == Some(Rule::ByName)) {
        let (Some(chain), (cause, _)) = (chain_at.get(&(finding.file, finding.start)), cause_and_steps(finding)) else { continue };
        let handed_over_at = (chain.file, checked.files.hir(chain.file)[chain.receiver].pos);
        if handed_over_at != (cause.file, cause.start) {
            table.earlier_cause.insert(handed_over_at, cause);
        }
    }
    let tally_of = |chain: &Chain| {
        let mut tally = Tally::default();
        for site in &chain.sites {
            if let Some(&at) = counted_in_code.by_position.get(&(site.module, site.pos)) {
                let kind = match site.access {
                    Access::Read => Kind::Read,
                    Access::Call => Kind::Call,
                    Access::Store => Kind::Store,
                };
                tally.add(kind, at);
            }
        }
        tally
    };
    let mut row_of_site: FxHashMap<(u32, u32), usize> = FxHashMap::default();
    let mut row_of_layout: FxHashMap<u32, usize> = FxHashMap::default();
    let mut row_of_package: FxHashMap<Vec<u8>, usize> = FxHashMap::default();
    for finding in found.iter().filter(|finding| matches!(Rule::of_code(finding.code), Some(Rule::LostLayout | Rule::UntypedBase))) {
        table.add(finding, &finding.related, Rule::of_code(finding.code).unwrap_or(Rule::LostLayout), None, None, &Tally::default());
    }
    for (index, finding) in found.iter().enumerate() {
        let Some(rule) = Rule::of_code(finding.code) else { continue };
        let mut tally = Tally::default();
        let (last, before_last) = cause_and_steps(finding);
        let affected = finding.args.first().map(Vec::as_slice);
        match rule {
            Rule::ByName => {
                let Some(chain) = chain_at.get(&(finding.file, finding.start)) else { continue };
                tally.absorb(&tally_of(chain));
                let row = table.add(last, before_last, rule, None, None, &tally);
                table.add_example(row, finding);
                row_of_site.extend(chain.sites.iter().map(|site| ((site.module, site.pos), row)));
            }
            Rule::OpenLayout => {
                let layout = layout_of_finding.get(&index).map(|layout| layout.idx() as u32);
                if let Some(through) = layout.and_then(|layout| counted_in_code.through_layout.get(&layout)) {
                    tally.absorb(through);
                }
                let (cause, steps) = if last.start == 0 { (finding, &[][..]) } else { (last, before_last) };
                let row = table.add(cause, steps, rule, affected, None, &tally);
                row_of_layout.extend(layout.map(|layout| (layout, row)));
            }
            Rule::ExternalType => {
                table.add(last, before_last, rule, affected, None, &tally);
            }
            Rule::CanThrow | Rule::LostLayout | Rule::UntypedBase => {}
            Rule::ReshapedLayout => {
                tally.absorb(if finding.code == 100080 { &counted_in_code.stores_testing_integrity } else { &counted_in_code.through_records_of_any_prototype });
                let row = table.add(finding, &[], rule, None, None, &tally);
                table.rows[row].other_causes.extend(finding.related.iter().map(|other| (other.file, other.start)));
            }
            Rule::UntypedPackage => {
                if let Some(inside) = finding.args.first().and_then(|package| untyped_by_package.get(package)) {
                    tally.absorb(inside);
                }
                let row = table.add(finding, &[], rule, None, None, &tally);
                row_of_package.extend(finding.args.first().map(|package| (package.clone(), row)));
            }
            Rule::Interpreted | Rule::UntypedFile => {
                table.add(finding, &finding.related, rule, None, None, &tally);
            }
        }
    }
    for (reported, other) in other_places_where_external_data_enters {
        if let Some(&row) = table.row_at.get(&(reported.file, reported.pos)) {
            table.rows[row].other_causes.push((other.file, other.start));
        }
    }
    let mut rows_by_file: FxHashMap<FileId, FxHashMap<u32, usize>> = FxHashMap::default();
    for (&(file, start), &row) in &table.row_at {
        rows_by_file.entry(file).or_default().insert(start, row);
    }
    for (file, row_starting_at) in rows_by_file {
        let (Some(&module), hir) = (module_of.get(&file), checked.files.hir(file)) else { continue };
        for (index, node) in hir.exprs.iter().enumerate().filter(|node| matches!(node.1.kind, ExprKind::Call(_) | ExprKind::Dot { .. })) {
            if let Some(&row) = row_starting_at.get(&node.pos) {
                let produced_by = match node.kind {
                    ExprKind::Call(call) => hir[call].callee,
                    _ => ExprId(index as u32),
                };
                row_of_site.entry((module, access_pos(hir, produced_by))).or_insert(row);
            }
        }
    }
    for finding in found.iter().filter(|finding| Rule::of_code(finding.code) == Some(Rule::CanThrow)) {
        let Some(&module) = module_of.get(&finding.file) else { continue };
        let mut tally = Tally::default();
        if let Some(&at) = counted_in_code.by_position.get(&(module, finding.start)) {
            let is_of_parameters = checks_of_parameters.contains(&(finding.file, finding.start));
            tally.add(if is_of_parameters { Kind::CheckOfParameters } else if at.may_be_copied { Kind::CheckThatMayCopy } else { Kind::Check }, at);
        }
        let row_of_value_at = |pos: u32| row_of_site.get(&(module, pos)).or_else(|| row_of_layout.get(counted_in_code.read_through.get(&(module, pos))?));
        if let Some(&row) = row_of_value_at(finding.start).or_else(|| row_of_value_at(*counted_in_code.checked_values.get(&(module, finding.start))?)) {
            table.add_to(row, Rule::CanThrow, &tally);
            table.add_example(row, finding);
            continue;
        }
        let fix = finding.related.iter().find(|related| related.code == 100049).and_then(|fix| fix.args.first());
        let origin = finding.related.iter().find(|related| related.code == 100018);
        table.add(origin.unwrap_or(finding), &[], Rule::CanThrow, None, fix.map(Vec::as_slice), &tally);
    }
    let mut row_of_maker: FxHashMap<Vec<u8>, usize> = FxHashMap::default();
    for (at, declaration) in accesses_without_known_cause {
        let Some(chain) = chain_at.get(&(at.file, at.pos)) else { continue };
        let access = CompilerDiagnostic { file: chain.file, start: chain.name_pos, end: chain.name_pos, code: 100030, args: vec![chain.name.clone()], related: Vec::new() };
        let Some(declared) = declaration else {
            table.add(&access, &[], Rule::ByName, None, None, &tally_of(chain));
            continue;
        };
        if declared.code != 100088 {
            let row = table.add(declared, &[], Rule::ByName, None, None, &tally_of(chain));
            table.add_example(row, &access);
            continue;
        }
        let package = checker.name_of_package_holding(declared.file).filter(|_| !checked.files.module(declared.file).is_lib);
        let package = package.map(|name| name.strip_prefix(b"@types/").map_or_else(|| name.clone(), <[u8]>::to_vec)).filter(|name| !RUNTIME_DECLARATIONS.contains(&name.as_slice()));
        let row = match package.as_ref().and_then(|package| row_of_package.get(package)) {
            Some(&row) => {
                table.add_to(row, Rule::ByName, &tally_of(chain));
                row
            }
            None => {
                let shown = package.as_ref().map_or_else(|| b"the runtime and the standard library".to_vec(), |package| [b"the package '".as_slice(), package, b"'".as_slice()].concat());
                let mut tally = tally_of(chain);
                if package.is_none() {
                    tally.weight = 0.0;
                }
                match row_of_maker.get(&shown) {
                    Some(&row) => {
                        table.add_to(row, Rule::ByName, &tally);
                        row
                    }
                    None => {
                        let fix = package.is_some().then(|| fix_for(100026).as_bytes());
                        let row = table.add(&CompilerDiagnostic { file: declared.file, start: 0, end: 0, code: 100088, args: vec![shown.clone()], related: Vec::new() }, &[], Rule::ByName, None, fix, &tally);
                        row_of_maker.insert(shown, row);
                        row
                    }
                }
            }
        };
        table.add_example(row, &access);
    }
    let stored_to: Vec<&Chain> = chains.iter().filter(|chain| chain.begins_with_a_store).collect();
    let receivers: Vec<(FileId, ExprId)> = stored_to.iter().map(|chain| (chain.file, chain.receiver)).collect();
    for (chain, reasons) in stored_to.iter().zip(checked.checker().explain_untyped_values(&receivers, classes_without_layout)) {
        let store = CompilerDiagnostic { file: chain.file, start: chain.name_pos, end: chain.name_pos, code: 100030, args: vec![chain.name.clone()], related: reasons };
        let (cause, steps) = cause_and_steps(&store);
        let row = table.add(cause, steps, Rule::ByName, None, None, &tally_of(chain));
        table.add_example(row, &store);
    }
    let mut arguments: Vec<(FileId, ExprId)> = Vec::new();
    let mut calls: Vec<(&'static str, Occurrence)> = Vec::new();
    for of_module in counted_in_code.unspecialized_calls.chunk_by(|a, b| a.0 == b.0) {
        let file = modules[of_module[0].0 as usize];
        let hir = checked.files.hir(file);
        for node in hir.exprs.iter() {
            let ExprKind::Call(call) = node.kind else { continue };
            let Some(&(_, _, shown, at)) = of_module.iter().find(|known| known.1 == access_pos(hir, hir[call].callee)) else { continue };
            if let Some(argument) = hir.ids(hir[call].args).next() {
                arguments.push((file, argument));
                calls.push((shown, at));
            }
        }
    }
    let reasons = checked.checker().explain_untyped_values(&arguments, classes_without_layout);
    for ((&(file, argument), (shown, at)), reasons) in arguments.iter().zip(calls).zip(&reasons) {
        let pos = checked.files.hir(file)[argument].pos;
        let call = CompilerDiagnostic { file, start: pos, end: pos, code: 100087, args: vec![shown.as_bytes().to_vec()], related: reasons.iter().map(copy_of).collect() };
        let mut tally = Tally::default();
        tally.add(Kind::UnspecializedCall, at);
        let (cause, steps) = cause_and_steps(&call);
        let row = table.add(cause, steps, Rule::ByName, None, None, &tally);
        table.add_example(row, &call);
    }
    let says_nothing_of_parameters = |ty: TyId| ty.is_none() || ty == program.tys.anything || program.tys.get(ty).any_function;
    for handed_to_one in counted_in_code.functions_handed_over.chunk_by(|a, b| a.to == b.to) {
        let taker = &program.funcs[handed_to_one[0].to as usize];
        if taker.flags & (func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE | func_flags::HAS_THIS) != 0 || taker.module.is_none() {
            continue;
        }
        let mut tally = Tally::default();
        for handed_over in handed_to_one.iter().filter(|handed_over| taker.params.get(handed_over.as_argument as usize).is_some_and(|&ty| says_nothing_of_parameters(ty))) {
            let function = &program.funcs[handed_over.function as usize];
            if !tally.functions.contains(&handed_over.function) && function.has(func_flags::IS_TYPED) && function.params.iter().any(|&ty| ty.is_some() && ty != program.tys.anything) {
                tally.add(Kind::CheckOfParameters, Occurrence { function: handed_over.function, frequency: 1.0, is_at_start: false, may_be_copied: false });
            }
        }
        if !tally.is_empty() {
            let name: &[u8] = if taker.name.is_some() { program.strs.get(taker.name) } else { b"" };
            let shown = if name.is_empty() { b"This function".to_vec() } else { [b"'".as_slice(), name, b"'".as_slice()].concat() };
            table.add(&CompilerDiagnostic { file: modules[taker.module.idx()], start: taker.pos, end: taker.pos, code: 100086, args: vec![shown], related: Vec::new() }, &[], Rule::CanThrow, None, None, &tally);
        }
    }
    let mut fallen_packages: Vec<(&CompilerDiagnostic, &Tally)> = untyped_by_package.iter().filter_map(|(package, tally)| Some((fallen_package(package)?, tally))).collect();
    fallen_packages.sort_unstable_by_key(|package| (package.0.file, package.0.start));
    for (record, tally) in fallen_packages {
        table.add(record, &[], Rule::UntypedFile, None, None, tally);
    }
    for (file, tally) in untyped_files {
        if let Some(record) = fallen.iter().find(|record| record.file == file) {
            table.add(record, &[], Rule::UntypedFile, None, None, tally);
            continue;
        }
        let module = checked.files.module(file);
        let name = get_relative_path_from_directory(shown_from, module.file_name(), checked.files.is_case_sensitive);
        let (code, rule) = if module.hir.is_js { (100083, Rule::UntypedPackage) } else { (100084, Rule::UntypedFile) };
        table.add(&CompilerDiagnostic { file, start: 0, end: 0, code, args: vec![name], related: Vec::new() }, &[], rule, None, None, tally);
    }
    let mut rows = table.rows;
    rows.sort_by(|a, b| b.tally.weight.total_cmp(&a.tally.weight).then_with(|| (checked.files.rank_of_file(a.cause.file), a.cause.start).cmp(&(checked.files.rank_of_file(b.cause.file), b.cause.start))));

    let mut locations = Locations { checked, shown_from, line_starts: FxHashMap::default() };
    let mut lines = Vec::new();
    if !as_json {
        let costly = rows.iter().filter(|row| !row.tally.is_empty()).count();
        lines.push(match counted(rows.len() as u32, "place", "places") {
            Some(places) => format!("{places} where the compiler gives something up, {costly} with a cost that can be counted. The most expensive first:"),
            None => "there is no place where the compiler gives something up".to_owned(),
        });
    }
    let shown = if as_json { rows.len() } else { rows.len().min(MAX_ROWS_SHOWN) };
    for (rank, row) in rows.iter().take(shown).enumerate() {
        let (line, column) = locations.line_and_column(row.cause.file, row.cause.start);
        let (path, rule, tally) = (locations.path(row.cause.file), row.rule(), &row.tally);
        let source = if row.cause.start == 0 { String::new() } else { locations.source_line(row.cause.file, row.cause.start) };
        let costs_only_unspecialized_calls = tally.unspecialized_calls > 0 && tally.reads + tally.stores + tally.calls == 0;
        let fix = match (fix_for(row.cause.code), &row.fix) {
            _ if costs_only_unspecialized_calls && row.cause.code == 100079 => fix_for(100087).to_owned(),
            ("", Some(fix)) => bstr::BStr::new(fix).to_string(),
            (fix, _) => fix.to_owned(),
        };
        let is_in_dependency = checked.files.module(row.cause.file).is_dependency;
        let mut steps_from_the_cause: Vec<&CompilerDiagnostic> = row.steps.iter().filter(|step| !as_json || step.code != STEPS_LEFT_OUT).collect();
        steps_from_the_cause.reverse();
        let steps_left_out = if as_json { 0 } else { steps_from_the_cause.len().saturating_sub(MAX_STEPS_SHOWN) };
        steps_from_the_cause.truncate(steps_from_the_cause.len() - steps_left_out);
        let steps: Vec<(String, usize, usize, String)> = (steps_from_the_cause.into_iter())
            .map(|step| {
                let (line, column) = locations.line_and_column(step.file, step.start);
                (locations.path(step.file), line, column, if step.code == STEPS_LEFT_OUT { String::new() } else { text_of(step) })
            })
            .collect();
        let affected: Vec<String> = row.affected.iter().map(|name| bstr::BStr::new(name).to_string()).collect();
        let mut located = |places: &[(FileId, u32)]| -> Vec<(String, usize, usize)> {
            (places.iter())
                .map(|&(file, pos)| {
                    let (line, column) = locations.line_and_column(file, pos);
                    (locations.path(file), line, column)
                })
                .collect()
        };
        let (examples, other_causes) = (located(&row.examples), located(&row.other_causes));
        if as_json {
            let because: Vec<String> = steps.iter().map(|(path, line, column, text)| format!("{{\"file\":{},\"line\":{line},\"column\":{column},\"message\":{}}}", quoted(path), quoted(text))).collect();
            let types: Vec<String> = affected.iter().map(|name| quoted(name)).collect();
            let as_objects = |places: &[(String, usize, usize)]| places.iter().map(|(path, line, column)| format!("{{\"file\":{},\"line\":{line},\"column\":{column}}}", quoted(path))).collect::<Vec<String>>().join(",");
            lines.push(format!(
                "{{\"rank\":{},\"rule\":\"{}\",\"file\":{},\"line\":{line},\"column\":{column},\"inDependency\":{is_in_dependency},\"source\":{},\"message\":{},\"because\":[{}],\"types\":[{}],\"examples\":[{}],\"otherCauses\":[{}],\"cost\":{{\"score\":{:.0},\"readsByName\":{},\"storesByName\":{},\"callsByName\":{},\"checks\":{},\"checksThatMayCopy\":{},\"checksOfParameters\":{},\"guardedAccesses\":{},\"unspecializedCalls\":{},\"functions\":{},\"functionsAfterStart\":{}}},\"fix\":{}}}",
                rank + 1,
                rule.name(),
                quoted(&path),
                quoted(&source),
                quoted(&text_of(&row.cause)),
                because.join(","),
                types.join(","),
                as_objects(&examples),
                as_objects(&other_causes),
                tally.weight,
                tally.reads,
                tally.stores,
                tally.calls,
                tally.checks,
                tally.checks_that_may_copy,
                tally.checks_of_parameters,
                tally.guarded_accesses,
                tally.unspecialized_calls,
                tally.functions.len(),
                tally.functions_after_start.len(),
                quoted(&fix)
            ));
            continue;
        }
        lines.push(String::new());
        lines.push(format!(" {:>2}. {path}:{line}:{column} [{}]{}", rank + 1, rule.name(), if is_in_dependency { " (in a dependency)" } else { "" }));
        if !source.is_empty() {
            lines.push(format!("     | {source}"));
        }
        lines.push(format!("     {}", text_of(&row.cause)));
        let parts = tally.parts();
        if !parts.is_empty() {
            let functions = tally.functions.len() as u32;
            let at_start = functions - tally.functions_after_start.len() as u32;
            let mut cost = format!("     cost: {} in {}", parts.join(", "), counted(functions, "function", "functions").unwrap_or_default());
            if at_start > 0 {
                let _ = write!(cost, " ({at_start} {} only while the program starts)", if at_start == 1 { "runs" } else { "run" });
            }
            lines.push(cost);
        }
        if !affected.is_empty() {
            let more = affected.len().saturating_sub(MAX_NAMES_SHOWN);
            let named = affected.iter().take(MAX_NAMES_SHOWN).map(|name| format!("'{name}'")).collect::<Vec<String>>().join(", ");
            lines.push(format!("     types: {named}{}", if more > 0 { format!(" and {more} more") } else { String::new() }));
        }
        if !examples.is_empty() {
            lines.push(format!("     for example at {}", examples.iter().map(|(path, line, column)| format!("{path}:{line}:{column}")).collect::<Vec<String>>().join(", ")));
        }
        for (path, line, column, text) in &steps {
            lines.push(if text.is_empty() { "     ..".to_owned() } else { format!("     {path}:{line}:{column}: {text}") });
        }
        if steps_left_out > 0 {
            lines.push(format!("     and {steps_left_out} more"));
        }
        if !other_causes.is_empty() {
            lines.push(format!("     {} the same, and the cost stays until all of them are fixed:", if other_causes.len() == 1 { "1 other place does" } else { "other places do" }));
            for (path, line, column) in other_causes.iter().take(MAX_STEPS_SHOWN) {
                lines.push(format!("       {path}:{line}:{column}"));
            }
            if other_causes.len() > MAX_STEPS_SHOWN {
                lines.push(format!("       and {} more", other_causes.len() - MAX_STEPS_SHOWN));
            }
        }
        if !fix.is_empty() {
            lines.push(format!("     fix: {fix}"));
        }
    }
    if !as_json && !rows.is_empty() {
        lines.push(String::new());
        lines.push(" In all, by rule:".to_owned());
        for info in &bun_sema::aot_rules::RULES {
            let mut of_rule = Tally::default();
            let places = rows.iter().filter(|row| row.rule() == info.rule).map(|row| of_rule.absorb(&row.tally)).count() as u32;
            if let Some(places) = counted(places, "place", "places") {
                let parts = of_rule.parts();
                lines.push(format!("     {}: {places}{}{}", info.name, if parts.is_empty() { "" } else { ": " }, parts.join(", ")));
            }
        }
    }
    if !as_json && rows.len() > shown {
        lines.push(String::new());
        lines.push(format!(" {} more: --aot-explain=costs-json prints every one, one object a line", rows.len() - shown));
    }
    lines
}
