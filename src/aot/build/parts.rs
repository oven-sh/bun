//! The declarations at the top level of a module that need not run.
//!
//! `const table = { a: () => 1 }` makes values and stores them to a variable. Nobody can tell whether it has run but by the variable. So it
//! is kept apart in the body of the module, as a `ModulePart` with mentions of its own, and the link drops it unless code that is reached
//! mentions a variable it stores to: see `link::Reach`. With it goes whatever only it mentions.
//!
//! What is kept apart: a variable statement, or an `export default` of an expression, whose operations only make values (constants, closures, objects, arrays), store to what they
//! have made and to variables; whose code is entered at one place and left at one place, or by throwing; and none of whose values is
//! used by other code.
//!
//! Where there is a bundler it has decided for every statement whether it may be left out if nothing uses what it declares
//! (`Constants::statements`). Its yes stands for the first of these conditions, for an expression statement too.

use super::{FileBuild, Fx};
use crate::fragment::{Mentioning, Mentions, ModulePart};
use crate::id::{BlockId, GlobalId, V};
use crate::ir::{Def, Func, Initialization, Op, Term, Why};
use bun_sema::hir::{ExprKind, StmtId, StmtKind};
use bun_sema::program::FileId;

/// Where the translation of a statement has begun and ended.
pub(crate) struct Mark {
    from: BlockId,
    /// The last operation of `from` that is not of the statement. `NONE`: it has none.
    before: V,
    first_block: u32,
    to: BlockId,
    /// The last operation of `to` that is of the statement. `NONE`: it has none.
    last: V,
    end_block: u32,
    /// The bundler says that it may be left out.
    is_removable: bool,
}

struct Candidate {
    part: ModulePart,
    is_apart: bool,
}

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    /// Whether the bundler has statements that start within the statement, and says of each that it may be left out.
    fn is_removable(&self, file: FileId, stmt: StmtId) -> bool {
        let (hir, path) = (self.hir(file), self.files.module(file).file_name());
        let Some(statements) = self.shared.constants.statements.get(path).filter(|_| self.shared.constants.own_paths.is_none()) else { return false };
        let mut within = statements.iter().filter(|it| (hir[stmt].start..hir[stmt].loc.end).contains(&it.0)).peekable();
        within.peek().is_some() && within.all(|it| it.1)
    }

    /// Before a statement at the top level of a module is translated.
    pub(crate) fn begin_part(&mut self, fx: &Fx, stmt: StmtId) -> Option<Mark> {
        let hir = self.hir(fx.file);
        let is_removable = self.is_removable(fx.file, stmt);
        match hir[stmt].kind {
            StmtKind::Var(_) => {}
            StmtKind::ExportDefault(e) if !self.binding_exported_as_default(fx.file, e).is_some_and(|sym| self.c.is_default_export_as_good_as_binding(fx.file, e, sym)) => {}
            // `exports.name = value`, where that is a store to a variable.
            StmtKind::Expr(e) if matches!(hir[e].kind, ExprKind::Assign { op: None, target, .. } if self.c.export_variable_named_by(fx.file, target).is_some()) => {}
            _ => return None,
        }
        if !fx.b.is_open() {
            return None;
        }
        let from = fx.b.block;
        Some(Mark {
            from,
            before: fx.b.func.blocks[from.idx()].ops.last().copied().unwrap_or(V::NONE),
            first_block: fx.b.func.blocks.len() as u32,
            to: from,
            last: V::NONE,
            end_block: 0,
            is_removable,
        })
    }

    pub(crate) fn end_part(&mut self, fx: &mut Fx, mark: Option<Mark>) {
        let Some(mark) = mark.filter(|_| fx.b.is_open()) else { return };
        let to = fx.b.block;
        self.marks.push(Mark { to, last: fx.b.func.blocks[to.idx()].ops.last().copied().unwrap_or(V::NONE), end_block: fx.b.func.blocks.len() as u32, ..mark });
        if fx.found_initialized.is_empty() {
            return;
        }
        if fx.false_value.is_none() {
            fx.false_value = fx.b.entry_constant(Op::Bool(false), self.known.no);
        }
        let found: Vec<_> = fx.found_initialized.values().copied().collect();
        for is_known in found {
            fx.b.write(is_known, fx.false_value);
        }
    }

    /// Whether the operation does nothing that can be told but by what it yields, by the variables it stores to and by the objects in `made`,
    /// which are those that the part has made so far.
    fn only_makes_values(&self, func: &Func, op: &Op, made: &[V]) -> bool {
        let is_constant_key = |key: V| matches!(func.op(key), Some(Op::Str(_) | Op::Int(_)));
        match op {
            Op::Undefined | Op::Null | Op::Bool(_) | Op::Int(_) | Op::Double(_) | Op::Str(_) | Op::BigInt(_) | Op::FuncRef(_) | Op::Closure { .. } => true,
            Op::New(_) | Op::NewWith { .. } | Op::NewObject | Op::NewArray(_) | Op::GlobalSet(..) => true,
            Op::GlobalGet(global) => !matches!(self.out.globals[global.idx()].initialization, Initialization::Uninitialized),
            Op::FieldSet { obj, .. } | Op::PropSet { obj, .. } => made.contains(obj),
            Op::Coerce { why: Why::Upcast, .. } => true,
            Op::Operation { name, args } => {
                matches!(self.out.strs.get(*name), b"DefineField" | b"DefineGetter" | b"DefineSetter") && args.len() >= 3 && made.contains(&args[0]) && is_constant_key(args[1])
            }
            _ => false,
        }
    }

    /// The statements that are kept apart, in their order.
    pub(crate) fn parts_of(&self, func: &Func, marks: Vec<Mark>) -> Vec<ModulePart> {
        let position_after = |block: BlockId, v: V| match v.is_none() {
            true => Some(0),
            false => func.blocks[block.idx()].ops.iter().position(|&op| op == v).map(|at| at as u32 + 1),
        };
        // By value and by the end of a block: the candidate it is of, counted from 1.
        let mut owner = vec![0u32; func.values.len()];
        let mut owner_of_end = vec![0u32; func.blocks.len()];
        let mut candidates: Vec<Candidate> = Vec::new();
        for mark in marks {
            let (Some(start), Some(end)) = (position_after(mark.from, mark.before), position_after(mark.to, mark.last)) else { continue };
            let blocks = (mark.first_block, mark.end_block);
            let is_in_one_block = mark.from == mark.to;
            if if is_in_one_block { blocks.0 != blocks.1 || start >= end } else { !(blocks.0..blocks.1).contains(&mark.to.0) } {
                continue;
            }
            let mut part = ModulePart { from: (mark.from, start), to: (mark.to, end), blocks, stores: Vec::new(), only_stores: Vec::new(), mentions: Mentions::default(), handed_through: Vec::new() };
            part.find_what_is_handed_through(func);
            // It goes on within itself, or to whatever catches what it throws.
            let stays = |block: BlockId| (blocks.0..blocks.1).contains(&block.0);
            let ends = (!is_in_one_block).then_some(mark.from).into_iter().chain((blocks.0..blocks.1).map(BlockId).filter(|&block| block != mark.to));
            let ends: Vec<BlockId> = ends.collect();
            let is_closed = ends.iter().all(|block| match &func.blocks[block.idx()].term {
                Some(Term::Invoke { normal, unwind }) => stays(normal.block) && !stays(unwind.block),
                Some(Term::Throw { unwind, .. }) => unwind.as_ref().is_none_or(|unwind| !stays(unwind.block)),
                Some(Term::Jump(target)) => stays(target.block),
                Some(Term::Branch { then, otherwise, .. }) => stays(then.block) && stays(otherwise.block),
                _ => false,
            });
            let values = part.values(func);
            let mut made: Vec<V> = Vec::new();
            let only_makes_values = mark.is_removable || values.iter().all(|&v| match &func.values[v.idx()].def {
                    Def::Param(..) => true,
                    Def::Op(op) => {
                        let is_fine = self.only_makes_values(func, op, &made);
                        // What is looked at as another type is the same object.
                        if matches!(op, Op::New(_) | Op::NewWith { .. } | Op::NewObject | Op::NewArray(_)) || matches!(op, Op::Coerce { value, .. } if made.contains(value)) {
                            made.push(v);
                        }
                        is_fine
                    }
                });
            if !is_closed || !only_makes_values {
                continue;
            }
            candidates.push(Candidate { part, is_apart: true });
            let number = candidates.len() as u32;
            for v in values {
                owner[v.idx()] = number;
            }
            for block in ends {
                owner_of_end[block.idx()] = number;
            }
        }
        // A value that other code uses is no value of a part, and then what that statement uses is used by other code.
        loop {
            let of = |number: u32| if number != 0 && candidates[number as usize - 1].is_apart { number } else { 0 };
            let mut used_elsewhere: Vec<u32> = Vec::new();
            let mut look = |user: u32, used: V| {
                if used.is_some() && of(owner[used.idx()]) != 0 && of(owner[used.idx()]) != of(user) {
                    used_elsewhere.push(owner[used.idx()]);
                }
            };
            for (block, end_owner) in func.blocks.iter().zip(&owner_of_end) {
                for &v in &block.ops {
                    if let Def::Op(op) = &func.values[v.idx()].def {
                        op.for_each_operand(|used| look(owner[v.idx()], used));
                    }
                }
                if let Some(term) = &block.term {
                    term.for_each_operand(|used| look(*end_owner, used));
                }
            }
            if used_elsewhere.is_empty() {
                break;
            }
            for number in used_elsewhere {
                candidates[number as usize - 1].is_apart = false;
            }
        }
        let mut parts: Vec<ModulePart> = candidates.into_iter().filter(|candidate| candidate.is_apart).map(|candidate| candidate.part).collect();
        for part in &mut parts {
            let mut stores: Vec<GlobalId> = part.values(func).into_iter().filter_map(|v| match func.op(v) {
                Some(&Op::GlobalSet(global, _)) => Some(global),
                _ => None,
            }).collect();
            stores.sort_unstable();
            stores.dedup();
            let values = part.values(func);
            part.only_stores = stores.iter().copied().filter(|&stored| !values.iter().any(|&v| matches!(func.op(v), Some(&Op::GlobalGet(read)) if read == stored))).collect();
            part.stores = stores;
        }
        parts
    }
}

/// Finds the mentions of each part, and yields those of the rest of the function.
pub(crate) fn mentions_apart(mentioning: &mut Mentioning, func: &mut Func, parts: &mut [ModulePart]) -> Mentions {
    let mut owner = vec![0u32; func.values.len()];
    for (number, part) in parts.iter().enumerate() {
        for v in part.values(func) {
            owner[v.idx()] = number as u32 + 1;
        }
    }
    for (number, part) in parts.iter_mut().enumerate() {
        part.mentions = mentioning.of_values(func, false, |index| owner[index] == number as u32 + 1);
    }
    mentioning.of_values(func, true, |index| owner[index] == 0)
}
