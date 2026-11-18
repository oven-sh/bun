//! Telling the type of a value from its bits and from the header of its cell.

use bun_engine_asm::Cond;
use bun_engine_codegen::ir::{Access, AccessFlags, Type, Value as Ssa};
use bun_engine_vm::{CellType, JsCell, JsString, SpeculatedType as T, TypeFlags, Value};
use smallvec::SmallVec;

use super::{Lowering, Odds};
use crate::graph::{TypeCheck, heaps};

static TYPES_OF_CELLS: [T; 256] = {
    let (mut types, mut cell_type) = ([T::empty(); 256], 0);
    while cell_type < types.len() {
        types[cell_type] = T::of_cell_type(CellType(cell_type as u8));
        cell_type += 1;
    }
    types
};

const OTHERS: T = T::BOOLEAN.union(T::NULLISH);

/// What one comparison tells, the cheapest first.
const GROUPS: [T; 11] = [
    T::EMPTY,
    T::INT32,
    T::FULL_NUMBER,
    T::CELL.union(T::EMPTY),
    T::UNDEFINED,
    T::NULL,
    OTHERS.union(T::EMPTY),
    T::NULLISH,
    T::BOOLEAN,
    OTHERS,
    T::FULL_DOUBLE,
];

/// Groups that between them have what `known` has of `wanted` and nothing else, if there are such.
fn cover(wanted: T, known: T) -> Option<SmallVec<[T; 4]>> {
    let (mut found, mut left) = (SmallVec::new(), wanted);
    while !left.is_empty() {
        let fitting = GROUPS.iter().filter(|&&it| wanted.contains(it & known));
        let best = fitting.min_by_key(|&&it| classes_in(left - it))?;
        if !best.intersects(left) {
            return None;
        }
        found.push(*best);
        left -= *best;
    }
    Some(found)
}

fn classes_in(ty: T) -> usize {
    let classes = [
        T::EMPTY,
        T::CELL,
        T::INT32,
        T::FULL_DOUBLE,
        T::BOOLEAN,
        T::NULL,
        T::UNDEFINED,
    ];
    classes.iter().filter(|it| it.intersects(ty)).count()
}

/// The least and the greatest type of cell that has some of `inside`, if none between them has some of `outside`.
fn range_of(inside: T, outside: T) -> Option<(u8, u8)> {
    let first = TYPES_OF_CELLS.iter().position(|it| it.intersects(inside))?;
    let last = TYPES_OF_CELLS
        .iter()
        .rposition(|it| it.intersects(inside))?;
    let between = &TYPES_OF_CELLS[first..=last];
    (!between.iter().any(|it| it.intersects(outside))).then_some((first as u8, last as u8))
}

impl Lowering<'_> {
    fn is_in_group(&mut self, value: Ssa, group: T) -> Ssa {
        let mut ir = self.ir();
        let (mask, expected) = match group {
            T::EMPTY => return ir.is_zero(value),
            T::INT32 => return ir.compare(Cond::AboveEq, value, Value::NUMBER_TAG),
            T::FULL_NUMBER => {
                let tag = ir.and(value, Value::NUMBER_TAG);
                return ir.is_not_zero(tag);
            }
            T::UNDEFINED => return ir.equal(value, Value::UNDEFINED.to_bits()),
            T::NULL => return ir.equal(value, Value::NULL.to_bits()),
            T::NULLISH => (!Value::UNDEFINED_TAG, Value::NULL.to_bits()),
            T::BOOLEAN => (!1, Value::FALSE.to_bits()),
            OTHERS => {
                let less = ir.sub(value, 1);
                return ir.compare(Cond::Below, less, Value::UNDEFINED.to_bits());
            }
            T::FULL_DOUBLE => {
                let bits = ir.sub(value, Value::DOUBLE_OFFSET);
                return ir.compare(Cond::Below, bits, Value::NUMBER_TAG - Value::DOUBLE_OFFSET);
            }
            _ if group.contains(T::CELL) => (Value::NOT_CELL_MASK, 0),
            _ => return ir.compare(Cond::BelowEq, value, Value::UNDEFINED.to_bits()),
        };
        let bits = ir.and(value, mask);
        ir.equal(bits, expected)
    }

    fn is_in_any(&mut self, value: Ssa, groups: &[T]) -> Ssa {
        let mut any = self.is_in_group(value, groups[0]);
        for &group in &groups[1..] {
            let holds = self.is_in_group(value, group);
            any = self.ir().or(any, holds);
        }
        any
    }

    /// `wanted` is a part of `known` that has all its cells or none, and is neither all of it nor empty.
    fn test_bits(&mut self, value: Ssa, wanted: T, known: T) -> Ssa {
        match (cover(wanted, known), cover(known - wanted, known)) {
            (Some(groups), others) if others.as_ref().is_none_or(|it| groups.len() <= it.len()) => {
                self.is_in_any(value, &groups)
            }
            (_, Some(others)) => {
                let is_other = self.is_in_any(value, &others);
                self.not(is_other)
            }
            _ => unreachable!("one of the two has no cell"),
        }
    }

    pub(super) fn cell_type(&mut self, cell: Ssa) -> Ssa {
        let access = Access::new(heaps::OTHER_FIELDS, AccessFlags::IMMUTABLE);
        self.load_byte(cell, JsCell::OFFSET_OF_TYPE, access)
    }

    pub(super) fn has_cell_type(&mut self, cell: Ssa, wanted: CellType) -> Ssa {
        let cell_type = self.cell_type(cell);
        self.ir().equal(cell_type, i32::from(wanted.0))
    }

    fn is_in_range(&mut self, cell: Ssa, (first, last): (u8, u8)) -> Ssa {
        let cell_type = self.cell_type(cell);
        let mut ir = self.ir();
        if first == last {
            ir.equal(cell_type, i32::from(first))
        } else if last == u8::MAX {
            ir.compare(Cond::AboveEq, cell_type, i32::from(first))
        } else {
            let distance = ir.sub(cell_type, i32::from(first));
            ir.compare(Cond::BelowEq, distance, i32::from(last - first))
        }
    }

    /// Both are types of cells. `wanted` is a part of `known` that has all its strings or none.
    fn test_cell(&mut self, cell: Ssa, wanted: T, known: T) -> Ssa {
        if let Some(range) = range_of(wanted, known - wanted) {
            return self.is_in_range(cell, range);
        }
        if let Some(range) = range_of(known - wanted, wanted) {
            let is_other = self.is_in_range(cell, range);
            return self.not(is_other);
        }
        let cell_type = self.cell_type(cell);
        let table = self.word(TYPES_OF_CELLS.as_ptr().addr() as u64);
        let mut ir = self.ir();
        let index = ir.zero_extend(cell_type);
        let offset = ir.shl(index, 3);
        let address = ir.add(table, offset);
        let access = Access::new(heaps::OTHER_FIELDS, AccessFlags::IMMUTABLE);
        let found = ir.load(Type::I64, address, 0, access);
        let common = ir.and(found, wanted.bits());
        ir.is_not_zero(common)
    }

    pub(super) fn is_rope(&mut self, fiber: Ssa) -> Ssa {
        let bit = self.ir().and(fiber, JsString::IS_ROPE as u64);
        self.ir().is_not_zero(bit)
    }

    pub(super) fn is_atom(&mut self, string: Ssa) -> Ssa {
        let flags = self.load_byte(string, JsCell::OFFSET_OF_FLAGS, heaps::STRING_FIBER);
        let bit = (self.ir()).and(flags, TypeFlags::PER_CELL_BIT.bits() as i32);
        self.ir().is_not_zero(bit)
    }

    /// Of a string.
    fn test_kind_of_string(&mut self, string: Ssa, wanted: T) -> Ssa {
        if wanted == T::ATOM_STRING {
            return self.is_atom(string);
        }
        assert!(wanted == T::ATOM_STRING | T::RESOLVED_STRING);
        let fiber = self.fiber(string);
        let is_rope = self.is_rope(fiber);
        self.not(is_rope)
    }

    pub(super) fn check_type(&mut self, value: Ssa, check: TypeCheck) {
        let known = check.known & T::BYTECODE_TOP;
        let wanted = check.wanted & known;
        let exit = self.exit_blaming(value, check.failure);
        let require = |this: &mut Self, holds: Ssa| {
            let fails = this.not(holds);
            this.ir().check(fails, exit);
        };
        let (wanted_cells, cells) = (wanted & T::CELL, known & T::CELL);
        if wanted == known {
            return;
        }
        if wanted.is_empty() {
            let never = self.int32(0);
            return require(self, never);
        }
        if wanted == wanted_cells {
            // Two branches are less work than two tests and a branch.
            for group in [T::CELL | T::EMPTY, T::HEAP_TOP] {
                if !group.contains(known) {
                    let holds = self.test_bits(value, group & known, known);
                    require(self, holds);
                }
            }
            let whole = if wanted.intersects(T::STRING) {
                wanted | cells & T::STRING
            } else {
                wanted
            };
            if whole != cells {
                let holds = self.test_cell(value, whole, cells);
                require(self, holds);
            }
            if whole != wanted {
                let holds = self.test_kind_of_string(value, check.wanted);
                require(self, holds);
            }
        } else if wanted_cells.is_empty() || wanted_cells == cells {
            let holds = self.test_bits(value, wanted, known);
            require(self, holds);
        } else {
            let is_cell = self.test_bits(value, cells, known);
            let of_cell = |this: &mut Self| {
                let holds = this.test_cell(value, wanted_cells, cells);
                require(this, holds);
                Ssa::NONE
            };
            let of_other = |this: &mut Self| {
                if wanted - cells != known - cells {
                    let holds = this.test_bits(value, wanted - cells, known - cells);
                    require(this, holds);
                }
                Ssa::NONE
            };
            self.choose(is_cell, Odds::Even, Type::Void, of_cell, of_other);
        }
    }

    pub(super) fn is_type(&mut self, value: Ssa, check: TypeCheck) -> Ssa {
        let known = check.known & T::BYTECODE_TOP;
        let wanted = check.wanted & known;
        let (wanted_cells, cells) = (wanted & T::CELL, known & T::CELL);
        if wanted == known || wanted.is_empty() {
            self.int32((!wanted.is_empty()).into())
        } else if wanted_cells.is_empty() || wanted_cells == cells {
            self.test_bits(value, wanted, known)
        } else if known == cells {
            self.test_cell(value, wanted, known)
        } else {
            let is_cell = self.test_bits(value, cells, known);
            let (wanted, known) = (wanted - cells, known - cells);
            self.choose(
                is_cell,
                Odds::Even,
                Type::I32,
                |this| this.test_cell(value, wanted_cells, cells),
                |this| {
                    this.is_type(
                        value,
                        TypeCheck {
                            wanted,
                            known,
                            ..check
                        },
                    )
                },
            )
        }
    }

    pub(super) fn has_type(&mut self, value: Ssa, wanted: T, known: T) -> Ssa {
        self.is_type(value, TypeCheck::describing(wanted, known))
    }

    /// As far as the graph tells without regard to the place.
    pub(super) fn is_cell(&mut self, value: Ssa) -> Ssa {
        let known = self.graph.inherent_type(self.graph.root(value)) | T::HEAP_TOP;
        self.test_bits(value, T::CELL, known)
    }

    pub(super) fn is_cell_of_type(&mut self, value: Ssa, cell_type: u32) -> Ssa {
        let is_cell = self.is_cell(value);
        self.choose(
            is_cell,
            Odds::Even,
            Type::I32,
            |this| this.has_cell_type(value, CellType(cell_type as u8)),
            |this| this.int32(0),
        )
    }
}
