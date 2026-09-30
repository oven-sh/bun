// pseudochecker/lookup.go: the entry points of the pseudochecker. Their bodies are not ported yet: each records a stand-in on the tree context and gives no pseudo type, so the node builder prints the type of the checker.
use crate::ast::{Ast, NodeId};
use crate::pseudochecker::checker::PseudoChecker;
use crate::pseudochecker::r#type::{PseudoType, PseudoTypeRef};

impl PseudoChecker {
    pub fn get_return_type_of_signature(
        &self,
        a: Ast<'_>,
        signature_node: NodeId,
    ) -> PseudoTypeRef {
        let _ = (self.strict_null_checks, self.exact_optional_property_types);
        a.unhandled::<()>("PseudoChecker.GetReturnTypeOfSignature", signature_node);
        None
    }

    pub fn get_type_of_accessor(&self, a: Ast<'_>, accessor: NodeId) -> PseudoTypeRef {
        a.unhandled::<()>("PseudoChecker.GetTypeOfAccessor", accessor);
        None
    }

    pub fn get_type_of_declaration(&self, a: Ast<'_>, node: NodeId) -> PseudoTypeRef {
        a.unhandled::<()>("PseudoChecker.GetTypeOfDeclaration", node);
        None
    }
}

pub fn could_already_refer_to_undefined_type(a: Ast<'_>, _t: Option<&PseudoType>) -> bool {
    a.unhandled::<()>(
        "pseudochecker.CouldAlreadyReferToUndefinedType",
        NodeId::NIL,
    );
    false
}
