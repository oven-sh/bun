// checker.go:29449-30162 (layer E-DECOR): the functions of 29924-29930: the contextual type of a decorator.
use crate::ast::NodeId;
use crate::checker::{Checker, TypeId};

impl<'a> Checker<'a> {
    pub fn get_contextual_type_for_decorator(&mut self, decorator: NodeId) -> TypeId {
        let signature = self.get_decorator_call_signature(decorator);
        if !signature.is_nil() {
            return self.get_or_create_type_from_signature(signature);
        }
        TypeId::NIL
    }
}
