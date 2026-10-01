// checker/utilities.go 360-416 and 660-709: sortSymbols, compareSymbolsWorker, compareNodes, compareTypeLists, compareTypeMappers.
use crate::checker::checker::Checker;
use crate::checker::flags_generated::TypeMapperKind;
use crate::checker::mapper::{Targets, TypeMapper};
use crate::tscore::golang::{List, compare_strings};
use crate::tscore::ids::{NodeId, SymbolId, TypeId, TypeMapperId};
use crate::tscore::slices::sort_func;

impl<'a> Checker<'a> {
    pub fn sort_symbols(&mut self, symbols: &mut [SymbolId]) {
        sort_func(symbols, |a, b| self.compare_symbols(a, b));
    }

    // The field `compareSymbols` holds the method value `compareSymbolsWorker` (checker.go 918).
    pub fn compare_symbols(&mut self, s1: SymbolId, s2: SymbolId) -> isize {
        self.compare_symbols_worker(s1, s2)
    }

    pub fn compare_symbols_worker(&mut self, s1: SymbolId, s2: SymbolId) -> isize {
        if s1 == s2 {
            return 0;
        }
        if s1.is_nil() {
            return 1;
        }
        if s2.is_nil() {
            return -1;
        }
        let (sym1, sym2) = (self.ast.sym(s1), self.ast.sym(s2));
        if sym1.declarations.len() != 0 && sym2.declarations.len() != 0 {
            let r = self.compare_nodes(sym1.declarations.at(0usize), sym2.declarations.at(0usize));
            if r != 0 {
                return r;
            }
        } else if sym1.declarations.len() != 0 {
            return -1;
        } else if sym2.declarations.len() != 0 {
            return 1;
        }
        let r = compare_strings(sym1.name, sym2.name);
        if r != 0 {
            return r;
        }
        // Fall back to symbol IDs. This is a last resort that should happen only when symbols have no declaration and duplicate names. The ids are assigned here, s1 first, when neither has one.
        let id1 = self.ast.get_symbol_id(s1);
        let id2 = self.ast.get_symbol_id(s2);
        (id1 as isize).wrapping_sub(id2 as isize)
    }

    pub fn compare_nodes(&mut self, n1: NodeId, n2: NodeId) -> isize {
        if n1 == n2 {
            return 0;
        }
        if n1.is_nil() {
            return 1;
        }
        if n2.is_nil() {
            return -1;
        }
        let s1 = self.ast.source_file_of(n1);
        let s2 = self.ast.source_file_of(n2);
        if s1 != s2 {
            let f1 = self.file_index_map.get(&s1);
            let f2 = self.file_index_map.get(&s2);
            // Order by index of file in the containing program
            return f1 - f2;
        }
        // In the same file, order by source position
        (self.ast.pos(n1) - self.ast.pos(n2)) as isize
    }
}

// utilities.go 660-709: free functions upstream. CompareTypes reads the checker of its arguments, so they take it.

pub fn compare_type_lists<'a>(
    c: &mut Checker<'a>,
    s1: List<'a, TypeId>,
    s2: List<'a, TypeId>,
) -> isize {
    if s1.len() != s2.len() {
        return s1.len() - s2.len();
    }
    for (i, t1) in s1.iter().enumerate() {
        let r = c.compare_types(t1, s2.at(i));
        if r != 0 {
            return r;
        }
    }
    0
}

// compareTypeLists over the targets of two array mappers: a live list compares by its values at this time.
fn compare_targets<'a>(c: &mut Checker<'a>, s1: Targets<'a>, s2: Targets<'a>) -> isize {
    if s1.len() != s2.len() {
        return s1.len() - s2.len();
    }
    for i in 0..s1.len() {
        let r = c.compare_types(s1.at(i), s2.at(i));
        if r != 0 {
            return r;
        }
    }
    0
}

// Merged mappers nest as deep as the instantiation that made them: the entry tests the stack.
pub fn compare_type_mappers(c: &mut Checker<'_>, m1: TypeMapperId, m2: TypeMapperId) -> isize {
    if !c.stack_check.is_safe_to_recurse() {
        return c.stack_limit();
    }
    if m1 == m2 {
        return 0;
    }
    if m1.is_nil() {
        return 1;
    }
    if m2.is_nil() {
        return -1;
    }
    let kind1 = c.mapper_kind(m1);
    let kind2 = c.mapper_kind(m2);
    if kind1 != kind2 {
        return (kind1.0 - kind2.0) as isize;
    }
    if kind1 == TypeMapperKind::SIMPLE {
        if let (
            TypeMapper::Simple {
                source: source1,
                target: target1,
            },
            TypeMapper::Simple {
                source: source2,
                target: target2,
            },
        ) = (&c.type_mappers[m1], &c.type_mappers[m2])
        {
            let (source1, target1, source2, target2) = (*source1, *target1, *source2, *target2);
            let r = c.compare_types(source1, source2);
            if r != 0 {
                return r;
            }
            return c.compare_types(target1, target2);
        }
    } else if kind1 == TypeMapperKind::ARRAY {
        if let (
            TypeMapper::Array {
                sources: sources1,
                targets: targets1,
            },
            TypeMapper::Array {
                sources: sources2,
                targets: targets2,
            },
        ) = (&c.type_mappers[m1], &c.type_mappers[m2])
        {
            let (sources1, targets1, sources2, targets2) =
                (*sources1, *targets1, *sources2, *targets2);
            let r = compare_type_lists(c, sources1, sources2);
            if r != 0 {
                return r;
            }
            return compare_targets(c, targets1, targets2);
        }
    } else if kind1 == TypeMapperKind::MERGED {
        if let (TypeMapper::Merged { m1: a1, m2: a2 }, TypeMapper::Merged { m1: b1, m2: b2 }) =
            (&c.type_mappers[m1], &c.type_mappers[m2])
        {
            let (a1, a2, b1, b2) = (*a1, *a2, *b1, *b2);
            let r = compare_type_mappers(c, a1, b1);
            if r != 0 {
                return r;
            }
            return compare_type_mappers(c, a2, b2);
        }
    }
    0
}
