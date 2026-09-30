// checker/pseudotypenodebuilder.go: how a pseudo type becomes a node and how it is compared with the type of the checker. The bodies are not ported yet: each records a stand-in and answers so that the node builder serializes the type of the checker.
use crate::ast::NodeId;
use crate::checker::nodebuilderimpl::NodeBuilderImpl;
use crate::checker::{Checker, TypeId, TypePredicateId};
use crate::pseudochecker::PseudoType;

impl NodeBuilderImpl {
    pub(crate) fn pseudo_type_to_node_with_checker_fallback(
        self,
        c: &mut Checker<'_>,
        _t: &PseudoType,
        fallback: TypeId,
    ) -> NodeId {
        let _: () = c.stand_in("NodeBuilderImpl.pseudoTypeToNodeWithCheckerFallback");
        self.type_to_type_node(c, fallback)
    }

    pub(crate) fn pseudo_type_equivalent_to_type(
        self,
        c: &mut Checker<'_>,
        _t: Option<&PseudoType>,
        _type_: TypeId,
        _is_optional_annotated: bool,
        _report_errors: bool,
    ) -> bool {
        let _: () = c.stand_in("NodeBuilderImpl.pseudoTypeEquivalentToType");
        false
    }

    pub(crate) fn pseudo_return_type_matches_predicate(
        self,
        c: &mut Checker<'_>,
        _t: Option<&PseudoType>,
        _predicate: TypePredicateId,
    ) -> bool {
        let _: () = c.stand_in("NodeBuilderImpl.pseudoReturnTypeMatchesPredicate");
        false
    }

    pub(crate) fn pseudo_type_to_type(
        self,
        c: &mut Checker<'_>,
        _t: Option<&PseudoType>,
    ) -> TypeId {
        let _: () = c.stand_in("NodeBuilderImpl.pseudoTypeToType");
        TypeId::NIL
    }
}
