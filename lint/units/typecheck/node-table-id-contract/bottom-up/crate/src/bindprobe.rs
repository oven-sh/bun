// Stands in for the binder in the measurements: it writes every kind of field that the binder writes.
use crate::ast::ast_generated::Def;
use crate::ast::factory::{Factory, NodeSink};
use crate::ast::flags_generated::{FlowFlags, NodeFlags, SymbolFlags};
use crate::ast::kind_generated::Kind;
use crate::ast::reader::Ast;
use crate::tscore::golang::List;
use crate::tscore::ids::{FlowNodeId, NodeId, SymbolId, SymbolTableId};

#[derive(Default, Debug, Clone, Copy, PartialEq, Eq)]
pub struct BindStats {
    pub nodes: u32,
    pub symbols: u32,
    pub declarations: u32,
    pub tables: u32,
    pub flow_nodes: u32,
    pub flow_data_nodes: u32,
    pub private_names: u32,
}

// ast.GetLocals: the table of a container, made at the first use.
fn get_locals(a: Ast<'_>, container: NodeId) -> SymbolTableId {
    let locals = a.locals(container);
    if !locals.is_nil() {
        return locals;
    }
    let locals = a.new_table();
    a.set_locals(container, locals);
    locals
}

// binder.GetSymbolNameForPrivateIdentifier
pub fn get_symbol_name_for_private_identifier<'a>(
    a: Ast<'a>,
    containing_class_symbol: SymbolId,
    description: &[u8],
) -> &'a [u8] {
    let mut name = Vec::new();
    name.extend_from_slice(b"\xFE#");
    name.extend_from_slice(
        a.get_symbol_id(containing_class_symbol)
            .to_string()
            .as_bytes(),
    );
    name.push(b'@');
    name.extend_from_slice(description);
    a.open().arena.alloc_slice_copy(&name)
}

pub fn bind_probe<'a>(a: Ast<'a>, root: NodeId) -> BindStats {
    let mut stats = BindStats::default();
    let mut factory = Factory::new(a);
    let mut stack: Vec<(NodeId, NodeId, SymbolId)> = vec![(root, NodeId::NIL, SymbolId::NIL)];
    let mut last_container = NodeId::NIL;
    let mut current_flow = a.new_flow_node(FlowFlags::START, NodeId::NIL, FlowNodeId::NIL);
    stats.flow_nodes += 1;
    let mut children: Vec<NodeId> = Vec::new();
    while let Some((node, mut container, mut class_symbol)) = stack.pop() {
        stats.nodes += 1;
        let kind = a.kind(node);
        // The symbol of a declaration goes into the container around it, not into its own locals.
        let outer = container;
        if a.has_locals_container_data(node) {
            if !last_container.is_nil() {
                a.set_next_container(last_container, node);
            }
            last_container = node;
            container = node;
        }
        if a.has_declaration_data(node) {
            let name_node = a.name(node);
            let private = a.kind(name_node) == Kind::PrivateIdentifier;
            if matches!(
                a.kind(name_node),
                Kind::Identifier | Kind::PrivateIdentifier
            ) && !outer.is_nil()
            {
                let mut name = a.text(name_node);
                if private && !class_symbol.is_nil() {
                    name = get_symbol_name_for_private_identifier(a, class_symbol, name);
                    stats.private_names += 1;
                }
                let locals = get_locals(a, outer);
                let mut symbol = a.table_get(locals, name);
                if symbol.is_nil() {
                    symbol = a.new_symbol(SymbolFlags::NONE, name);
                    a.table_set(locals, name, symbol);
                    stats.symbols += 1;
                }
                // addDeclarationToSymbol
                let mut declarations = a.sym(symbol).declarations.as_slice().to_vec();
                declarations.push(node);
                let declarations = List::from_slice(a.open().arena.alloc_slice_copy(&declarations));
                a.update_symbol(symbol, |s| {
                    s.flags |= SymbolFlags::PROPERTY;
                    s.declarations = declarations;
                    if s.value_declaration.is_nil() {
                        s.value_declaration = node;
                    }
                });
                a.set_symbol(node, symbol);
                stats.declarations += 1;
                if a.has_exportable_data(node) {
                    a.set_local_symbol(node, symbol);
                }
                if matches!(kind, Kind::ClassDeclaration | Kind::ClassExpression) {
                    class_symbol = symbol;
                }
            }
        }
        if a.has_flow_node_data(node) {
            current_flow = a.new_flow_node(FlowFlags::ASSIGNMENT, node, current_flow);
            a.set_flow_node(node, current_flow);
            stats.flow_nodes += 1;
        }
        if kind == Kind::SwitchStatement {
            // createFlowSwitchClause: the data of the flow node is a node of kind Unknown.
            let data = factory.alloc_node(
                Def::FlowSwitchClauseData,
                Kind::Unknown,
                NodeFlags::NONE,
                &[node.0, 0, 1],
            );
            current_flow = a.new_flow_node(FlowFlags::SWITCH_CLAUSE, data, current_flow);
            stats.flow_nodes += 1;
            stats.flow_data_nodes += 1;
        }
        if a.body_data(node).is_some() {
            a.set_flags(node, a.flags(node) | NodeFlags::HAS_IMPLICIT_RETURN);
            a.set_end_flow_node(node, current_flow);
        }
        children.clear();
        children.extend(a.jsdoc(node).iter());
        children.extend(a.iter_children(node));
        stack.extend(
            children
                .iter()
                .rev()
                .map(|child| (*child, container, class_symbol)),
        );
    }
    stats.tables = a.open().table_count();
    stats
}
