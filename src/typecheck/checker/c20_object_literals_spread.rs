// checker.go:13235-13989 (layer T-UIMEMBERS): the functions of 13611-13625 and 13950-13964: the index infos of a union type and the test for a read-only symbol.
use crate::ast::{CheckFlags, ModifierFlags, NodeFlags, NodeId, SymbolFlags, SymbolId};
use crate::checker::{Checker, IndexInfoId, TypeId, get_declaration_modifier_flags_from_symbol};
use crate::core::{List, every, some};

impl<'a> Checker<'a> {
    pub fn get_union_index_infos(&mut self, types: List<'_, TypeId>) -> List<'a, IndexInfoId> {
        let source_infos = self.get_index_infos_of_type(types.at(0usize));
        let mut result: Vec<IndexInfoId> = Vec::new();
        for &info in source_infos.as_slice() {
            let index_type = self.index_infos[info].key_type;
            if every(types.as_slice(), |t| {
                !self.get_index_info_of_type(t, index_type).is_nil()
            }) {
                let mut value_types: Vec<TypeId> = Vec::with_capacity(types.as_slice().len());
                for &t in types.as_slice() {
                    let value_type = self.get_index_type_of_type(t, index_type);
                    value_types.push(value_type);
                }
                let value_type = self.get_union_type(List::from_slice(&value_types));
                let is_readonly = some(types.as_slice(), |t| {
                    let type_info = self.get_index_info_of_type(t, index_type);
                    self.index_infos[type_info].is_readonly
                });
                let index_info = self.new_index_info(
                    index_type,
                    value_type,
                    is_readonly,
                    NodeId::NIL,
                    List::NIL,
                );
                result.push(index_info);
            }
        }
        self.list(&result)
    }

    pub fn is_readonly_symbol(&mut self, symbol: SymbolId) -> bool {
        // The following symbols are considered read-only: Properties with a 'readonly' modifier, Variables declared with 'const', Get accessors without matching set accessors, Enum members, Object.defineProperty assignments with writable false or no setter, Unions and intersections of the above (unions and intersections eagerly set isReadonly on creation)
        let a = self.ast;
        let s = a.sym(symbol);
        s.check_flags.intersects(CheckFlags::READONLY)
            || s.flags.intersects(SymbolFlags::PROPERTY)
                && get_declaration_modifier_flags_from_symbol(a, symbol)
                    .intersects(ModifierFlags::READONLY)
            || s.flags.intersects(SymbolFlags::VARIABLE)
                && self
                    .get_declaration_node_flags_from_symbol(symbol)
                    .intersects(NodeFlags::CONSTANT)
            || s.flags.intersects(SymbolFlags::ACCESSOR)
                && !s.flags.intersects(SymbolFlags::SET_ACCESSOR)
            || s.flags.intersects(SymbolFlags::ENUM_MEMBER)
            || some(s.declarations.as_slice(), |declaration| {
                self.is_readonly_assignment_declaration(declaration)
            })
    }
}
