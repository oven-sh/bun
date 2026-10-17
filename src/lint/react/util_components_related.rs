//! `getRelatedComponent` of `lib/util/Components.js` of eslint-plugin-react, without the list that
//! it adds to: that is `Components::get_related_component`.

use crate::util_ast::name_of_key;
use crate::util_variable::variable_from_context;
use bun_lint::prelude::*;
use bun_lint::types::IdMap;
use bun_lint::utils::{estree_parent, estree_span};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

/// The `componentPath`s of `getRelatedComponent`, so that many of one long `a.b.b.b` take no
/// longer than one.
#[derive(Default)]
struct ComponentPaths<'a> {
    /// The names in each row of member accesses, from the innermost on.
    rows: Vec<Vec<Name<'a>>>,
    /// In which row a member access is, and how many of the names of that row are its path.
    places: IdMap<Expr<'a>, (usize, usize)>,
}

impl<'a> ComponentPaths<'a> {
    /// `componentPath`, reversed as upstream reverses it.
    fn of(&mut self, node: Expr<'a>) -> &[Name<'a>] {
        let mut unknown: SmallVec<[Expr<'a>; 4]> = SmallVec::new();
        let mut known = None;
        let mut node_temp = Some(node);
        while let Some(member) = node_temp {
            known = self.places.get(member).copied();
            if known.is_some() {
                break;
            }
            unknown.push(member);
            // From above the whole of an optional chain is a `ChainExpression`.
            node_temp = member.object().filter(|it| {
                matches!(it.tag(), ExprTag::Dot | ExprTag::Index) && !it.is_chain_root()
            });
        }
        let (row, mut count) = known.unwrap_or_else(|| {
            self.rows.push(Vec::new());
            (self.rows.len() - 1, 0)
        });
        let Some(names) = self.rows.get_mut(row) else {
            return &[];
        };
        for member in unknown.into_iter().rev() {
            // A `MetaProperty` has a `property` too.
            names.extend(member.object().and_then(|object| match object.kind() {
                ExprKind::Ident(name) => Some(name),
                ExprKind::ImportMeta => Some(object.file().name_of("meta")),
                ExprKind::NewTarget => Some(object.file().name_of("target")),
                _ => None,
            }));
            names.extend(match member.kind() {
                ExprKind::Dot { name, .. } if !member.is_private_member() => Some(name.name()),
                ExprKind::Index { index, .. } => index.as_ident(),
                _ => None,
            });
            count = names.len();
            self.places.insert(member, (row, count));
        }
        names.get(..count).unwrap_or_default()
    }
}

/// `defInScope.node` of `getRelatedComponent`
fn node_of_def_in_scope(variable: Variable<'_>) -> Option<Node<'_>> {
    use DeclarationKind::{ClassName, FunctionName, Variable};
    let mut defs = variable.declarations();
    defs.find(|def| matches!(def.kind(), Some(ClassName | FunctionName | Variable)))?
        .node()
}

/// `refId.parent.right`, where `ref_id` is a `MemberExpression`.
fn right_of_parent(ref_id: Expr<'_>) -> Option<Expr<'_>> {
    if ref_id.is_chain_root() || ref_id.jsx_container_span().is_some() {
        return None;
    }
    // A default is the `right` of an `AssignmentPattern`.
    let default = match estree_parent(Node::Expr(ref_id)) {
        Node::Expr(parent) => {
            return match parent.kind() {
                ExprKind::Assign { value, .. } => Some(value),
                ExprKind::Binary { op, right, .. } if op != BinOp::Comma => Some(right),
                _ => None,
            };
        }
        Node::Stmt(statement) => {
            return match statement.kind() {
                StmtKind::ForIn { expr, .. } | StmtKind::ForOf { expr, .. } => Some(expr),
                _ => None,
            };
        }
        Node::Param(param) => param.default(),
        Node::PatProp(prop) => prop.default(),
        Node::PatElem(element) => element.default(),
        _ => None,
    };
    default.filter(|it| *it == ref_id)
}

/// Of a reference: the text of `refId`, and the `componentNode` that upstream takes from it.
fn ref_id_of(reference: Reference<'_>) -> (&[u8], Option<Expr<'_>>) {
    let node = reference.node();
    let file = node.file();
    match node {
        Node::Expr(identifier) if reference.expr().is_some() => match identifier.parent() {
            Node::Expr(parent) if ast_utils::is_member_expression(parent) => {
                (parent.text(), right_of_parent(parent))
            }
            _ => (file.slice(reference.span()), None),
        },
        // The range of an `Identifier` has its type annotation.
        Node::Pat(identifier) => {
            let init = match identifier.parent() {
                Node::VarDecl(declarator) => declarator.init(),
                _ => None,
            };
            let init = init.filter(|it| it.tag() != ExprTag::Ident);
            (file.slice(estree_span(node)), init)
        }
        _ => (file.slice(reference.span()), None),
    }
}

/// By the text of `refId`: what the first reference with that text gives.
type ReferencesByText<'a> = FxHashMap<&'a [u8], Option<Expr<'a>>>;

/// What `getRelatedComponent` finds, without the list.
#[derive(Default)]
pub(crate) struct Related<'a> {
    paths: ComponentPaths<'a>,
    references: FxHashMap<Variable<'a>, ReferencesByText<'a>>,
    /// Of an object literal that is looked into: the first property of each name.
    properties: IdMap<Expr<'a>, FxHashMap<&'a [u8], Prop<'a>>>,
}

impl<'a> Related<'a> {
    /// The `componentNode` that `getRelatedComponent` adds.
    pub(crate) fn component_node(&mut self, node: Expr<'a>) -> Option<Node<'a>> {
        // Get the component path
        let (&variable_name, component_path) = self.paths.of(node).split_first()?;

        // Find the variable in the current scope
        let variable_in_scope = variable_from_context(Node::Expr(node), variable_name)?;

        // Try to find the component using variable references. A `refId` is `a` or `a.b`.
        let mut component_name: SmallVec<[u8; 32]> = SmallVec::from_slice(variable_name.bytes());
        let is_short = match component_path {
            [_] => true,
            [property, _] => {
                component_name.push(b'.');
                component_name.extend_from_slice(property.bytes());
                true
            }
            _ => false,
        };
        if is_short {
            let references = self.references.entry(variable_in_scope).or_insert_with(|| {
                let mut references = ReferencesByText::default();
                for reference in variable_in_scope.references() {
                    let (text_of_ref_id, component_node) = ref_id_of(reference);
                    references.entry(text_of_ref_id).or_insert(component_node);
                }
                references
            });
            if let Some(&Some(component_node)) = references.get(&component_name[..]) {
                return Some(Node::Expr(component_node));
            }
        }

        // Try to find the component using variable declarations
        let mut component_node = match node_of_def_in_scope(variable_in_scope)? {
            Node::VarDecl(declarator) => match declarator.init() {
                Some(init) => init,
                None => return Some(Node::VarDecl(declarator)),
            },
            def_node => return Some(def_node),
        };

        // Traverse the node properties to the component declaration
        for name in component_path {
            let ExprKind::Object(properties) = component_node.kind() else {
                break;
            };
            let by_name = self.properties.get_or_insert_with(component_node, || {
                let mut by_name = FxHashMap::default();
                for property in properties {
                    if let Some(name) = property.key().and_then(name_of_key) {
                        by_name.entry(name).or_insert(property);
                    }
                }
                by_name
            });
            component_node = by_name.get(name.bytes())?.value()?;
        }
        Some(Node::Expr(component_node))
    }
}
