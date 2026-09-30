// printer/emitresolver.go: the result types of the accessibility checks. The EmitResolver interface belongs to declaration emit and is not part of the port.
use crate::ast::NodeId;

#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum SymbolAccessibility {
    #[default]
    Accessible,
    NotAccessible,
    CannotBeNamed,
    NotResolved,
}

#[derive(Clone, Default, Debug)]
pub struct SymbolAccessibilityResult {
    pub accessibility: SymbolAccessibility,
    // aliases that need to have this symbol visible
    pub aliases_to_make_visible: Vec<NodeId>,
    // Optional - symbol name that results in error
    pub error_symbol_name: Vec<u8>,
    // Optional - node that results in error
    pub error_node: NodeId,
    // Optional - If the symbol is not visible from module, module's name
    pub error_module_name: Vec<u8>,
}
