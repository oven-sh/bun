use super::{FileBuild, Fx};
use crate::fragment::{ModulePart, ReferenceCollector, ReferencedIds};
use crate::id::{BlockId, GlobalId, V};
use crate::ir::{CoerceReason, Def, Func, Initialization, Op, Operation, Term};
use bun_sema::hir::{ExprKind, StmtId, StmtKind};
use bun_sema::program::FileId;

pub(crate) struct Mark {
    from: BlockId,
    before: V,
    first_block: u32,
    to: BlockId,
    last: V,
    end_block: u32,
    is_removable: bool,
}

struct Candidate {
    part: ModulePart,
    is_apart: bool,
}

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    fn is_removable(&self, file: FileId, stmt: StmtId) -> bool {
        let (hir, path) = (self.hir(file), self.files.module(file).file_name());
        let Some(statements) = self
            .shared
            .constants
            .statements
            .get(path)
            .filter(|_| self.shared.constants.source_path_to_url.is_none())
        else {
            return false;
        };
        let mut within = statements
            .iter()
            .filter(|it| (hir[stmt].start..hir[stmt].loc.end).contains(&it.0))
            .peekable();
        within.peek().is_some() && within.all(|it| it.1)
    }

    pub(crate) fn begin_part(&mut self, fx: &Fx, stmt: StmtId) -> Option<Mark> {
        let hir = self.hir(fx.file);
        let is_removable = self.is_removable(fx.file, stmt);
        match hir[stmt].kind {
            StmtKind::Var(_) => {}
            StmtKind::ExportDefault(e)
                if !self.default_export_binding(fx.file, e).is_some_and(|sym| {
                    self.c
                        .is_default_export_equivalent_to_binding(fx.file, e, sym)
                }) => {}
            StmtKind::Expr(e) if matches!(hir[e].kind, ExprKind::Assign { op: None, target, .. } if self.c.export_variable_for_expr(fx.file, target).is_some()) =>
                {}
            _ => return None,
        }
        if !fx.b.is_open() {
            return None;
        }
        let from = fx.b.block;
        Some(Mark {
            from,
            before: fx.b.func.blocks[from.idx()]
                .ops
                .last()
                .copied()
                .unwrap_or(V::NONE),
            first_block: fx.b.func.blocks.len() as u32,
            to: from,
            last: V::NONE,
            end_block: 0,
            is_removable,
        })
    }

    pub(crate) fn end_part(&mut self, fx: &mut Fx, mark: Option<Mark>) {
        let Some(mark) = mark.filter(|_| fx.b.is_open()) else {
            return;
        };
        self.modules_touched.2.clear();
        let to = fx.b.block;
        self.marks.push(Mark {
            to,
            last: fx.b.func.blocks[to.idx()]
                .ops
                .last()
                .copied()
                .unwrap_or(V::NONE),
            end_block: fx.b.func.blocks.len() as u32,
            ..mark
        });
        if fx.known_initialized.is_empty() {
            return;
        }
        if fx.false_value.is_none() {
            fx.false_value = fx.b.entry_constant(Op::Bool(false), self.known.no);
        }
        let found: Vec<_> = fx.known_initialized.values().copied().collect();
        for is_known in found {
            fx.b.write(is_known, fx.false_value);
        }
    }

    fn has_no_observable_effects(
        &self,
        func: &Func,
        op: &Op,
        allocated_by: &[u32],
        part: u32,
    ) -> bool {
        let is_constant_key = |key: V| matches!(func.op(key), Some(Op::Str(_) | Op::Int(_)));
        let is_made = |v: V| allocated_by.get(v.idx()) == Some(&part);
        match op {
            Op::Undefined
            | Op::Null
            | Op::Bool(_)
            | Op::Int(_)
            | Op::Double(_)
            | Op::Str(_)
            | Op::BigInt(_)
            | Op::Symbol(_)
            | Op::FuncRef(_)
            | Op::Closure { .. } => true,
            Op::New(_)
            | Op::NewWith { .. }
            | Op::NewObject
            | Op::NewArray(_)
            | Op::GlobalSet(..) => true,
            Op::GlobalGet(global) => !matches!(
                self.out.globals[global.idx()].initialization,
                Initialization::Uninitialized
            ),
            Op::FieldSet { obj, .. } | Op::PropSet { obj, .. } => is_made(*obj),
            Op::Coerce {
                why: CoerceReason::Upcast,
                ..
            } => true,
            Op::Operation {
                which: Operation::DefineField | Operation::DefineGetter | Operation::DefineSetter,
                args,
            } => args.len() >= 3 && is_made(args[0]) && is_constant_key(args[1]),
            _ => false,
        }
    }

    pub(crate) fn parts_of(&self, func: &Func, marks: Vec<Mark>) -> Vec<ModulePart> {
        let inspected_values = if marks.is_empty() {
            0
        } else {
            func.values.len()
        };
        let mut place_of = vec![(u32::MAX, 0u32); inspected_values];
        if !marks.is_empty() {
            for (block, of_block) in func.blocks.iter().enumerate() {
                for (at, &op) in of_block.ops.iter().enumerate().rev() {
                    place_of[op.idx()] = (block as u32, at as u32);
                }
            }
        }
        let position_after = |block: BlockId, v: V| match v.is_none() {
            true => Some(0),
            false => place_of
                .get(v.idx())
                .filter(|place| place.0 == block.0)
                .map(|place| place.1 + 1),
        };
        let mut allocated_by = vec![0u32; inspected_values];
        let mut owner = vec![0u32; func.values.len()];
        let mut owner_of_end = vec![0u32; func.blocks.len()];
        let mut candidates: Vec<Candidate> = Vec::new();
        for (number, mark) in marks.into_iter().enumerate() {
            let number = number as u32 + 1;
            let (Some(start), Some(end)) = (
                position_after(mark.from, mark.before),
                position_after(mark.to, mark.last),
            ) else {
                continue;
            };
            let blocks = (mark.first_block, mark.end_block);
            let is_in_one_block = mark.from == mark.to;
            if if is_in_one_block {
                blocks.0 != blocks.1 || start >= end
            } else {
                !(blocks.0..blocks.1).contains(&mark.to.0)
            } {
                continue;
            }
            let mut part = ModulePart {
                from: (mark.from, start),
                to: (mark.to, end),
                blocks,
                stores: Vec::new(),
                write_only_globals: Vec::new(),
                mentions: ReferencedIds::default(),
                passed_through: Vec::new(),
            };
            part.find_passed_through_values(func);
            let stays = |block: BlockId| (blocks.0..blocks.1).contains(&block.0);
            let ends = (!is_in_one_block).then_some(mark.from).into_iter().chain(
                (blocks.0..blocks.1)
                    .map(BlockId)
                    .filter(|&block| block != mark.to),
            );
            let ends: Vec<BlockId> = ends.collect();
            let is_closed = ends
                .iter()
                .all(|block| match &func.blocks[block.idx()].term {
                    Some(Term::Invoke { normal, unwind }) => {
                        stays(normal.block) && !stays(unwind.block)
                    }
                    Some(Term::Throw { unwind, .. }) => {
                        unwind.as_ref().is_none_or(|unwind| !stays(unwind.block))
                    }
                    Some(Term::Jump(target)) => stays(target.block),
                    Some(Term::Branch {
                        then, otherwise, ..
                    }) => stays(then.block) && stays(otherwise.block),
                    _ => false,
                });
            let values = part.values(func);
            let has_no_observable_effects = mark.is_removable || values.iter().all(|&v| match &func.values[v.idx()].def {
                    Def::Param(..) => true,
                    Def::Op(op) => {
                        let is_fine = self.has_no_observable_effects(func, op, &allocated_by, number);
                        if matches!(op, Op::New(_) | Op::NewWith { .. } | Op::NewObject | Op::NewArray(_)) || matches!(op, Op::Coerce { value, .. } if allocated_by.get(value.idx()) == Some(&number)) {
                            allocated_by[v.idx()] = number;
                        }
                        is_fine
                    }
                });
            if !is_closed || !has_no_observable_effects {
                continue;
            }
            candidates.push(Candidate {
                part,
                is_apart: true,
            });
            let number = candidates.len() as u32;
            for v in values {
                owner[v.idx()] = number;
            }
            for block in ends {
                owner_of_end[block.idx()] = number;
            }
        }
        loop {
            let of = |number: u32| {
                if number != 0 && candidates[number as usize - 1].is_apart {
                    number
                } else {
                    0
                }
            };
            let mut used_elsewhere: Vec<u32> = Vec::new();
            let mut look = |user: u32, used: V| {
                if used.is_some() && of(owner[used.idx()]) != 0 && of(owner[used.idx()]) != of(user)
                {
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
        let mut parts: Vec<ModulePart> = candidates
            .into_iter()
            .filter(|candidate| candidate.is_apart)
            .map(|candidate| candidate.part)
            .collect();
        for part in &mut parts {
            let mut stores: Vec<GlobalId> = part
                .values(func)
                .into_iter()
                .filter_map(|v| match func.op(v) {
                    Some(&Op::GlobalSet(global, _)) => Some(global),
                    _ => None,
                })
                .collect();
            stores.sort_unstable();
            stores.dedup();
            let values = part.values(func);
            part.write_only_globals = stores
                .iter()
                .copied()
                .filter(|&stored| {
                    !values.iter().any(
                        |&v| matches!(func.op(v), Some(&Op::GlobalGet(read)) if read == stored),
                    )
                })
                .collect();
            part.stores = stores;
        }
        parts
    }
}

pub(crate) fn split_referenced_ids(
    mentioning: &mut ReferenceCollector,
    func: &mut Func,
    parts: &mut [ModulePart],
) -> ReferencedIds {
    let mut owner = vec![0u32; func.values.len()];
    for (number, part) in parts.iter().enumerate() {
        for v in part.values(func) {
            owner[v.idx()] = number as u32 + 1;
        }
    }
    let mut by_owner: Vec<u32> = (0..owner.len() as u32).collect();
    by_owner.sort_by_key(|&index| owner[index as usize]);
    let unowned = by_owner.partition_point(|&index| owner[index as usize] == 0);
    let mut start = unowned;
    for (number, part) in parts.iter_mut().enumerate() {
        let end = start
            + by_owner[start..]
                .partition_point(|&index| owner[index as usize] == number as u32 + 1);
        part.mentions = mentioning.of_values(func, false, &by_owner[start..end]);
        start = end;
    }
    mentioning.of_values(func, true, &by_owner[..unowned])
}
