#![allow(dead_code)] // until every rule of the plugin is written
//! `getRelatedComponent` of `lib/util/Components.js` of eslint-plugin-react, without the list that
//! it adds to: that is `Components::get_related_component`.

use crate::util_ast::name_of_key;
use crate::util_variable::get_variable_from_context;
use bun_lint::prelude::*;
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
    places: FxHashMap<Expr<'a>, (usize, usize)>,
}

impl<'a> ComponentPaths<'a> {
    /// `componentPath`, reversed as upstream reverses it.
    fn of(&mut self, node: Expr<'a>) -> &[Name<'a>] {
        let mut unknown: SmallVec<[Expr<'a>; 4]> = SmallVec::new();
        let mut known = None;
        let mut node_temp = Some(node);
        while let Some(member) = node_temp {
            known = self.places.get(&member).copied();
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

/// A variable of ESLint.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Variable<'a> {
    Declared(Symbol<'a>),
    /// ESLint has two for the name of a class declaration: one in the scope of the class
    /// (`true`), which is for what is in the class, and one around it.
    OfClass(Symbol<'a>, Class<'a>, bool),
    /// What the configuration, a comment or the language defines: it has no `defs`.
    Global(Name<'a>),
}

impl<'a> Variable<'a> {
    /// `variableUtil.getVariableFromContext(context, node, name)`
    fn get_from_context(node: Node<'a>, name: Name<'a>) -> Option<Variable<'a>> {
        let Some(symbol) = get_variable_from_context(node, name) else {
            let global = node.file().global_named(name);
            return global.map(|_| Variable::Global(name));
        };
        let class = symbol.declarations().find_map(|it| match it {
            Declaration::Class(class) if matches!(class.owner(), Node::Stmt(_)) => Some(class),
            _ => None,
        });
        Some(match class {
            Some(class) => {
                let is_in_class = class.scope().is_some_and(|it| it.contains(node.scope()));
                Variable::OfClass(symbol, class, is_in_class)
            }
            None => Variable::Declared(symbol),
        })
    }

    /// `variable.references`
    fn for_each_reference(self, file: &'a File<'a>, visit: &mut dyn FnMut(Reference<'a>)) {
        match self {
            Variable::Declared(symbol) => symbol.references().for_each(visit),
            Variable::OfClass(symbol, class, is_in_class) => {
                let scope = class.scope();
                (symbol.references())
                    .filter(|it| {
                        scope.is_some_and(|scope| scope.contains(it.scope())) == is_in_class
                    })
                    .for_each(visit);
            }
            Variable::Global(name) => (file.unresolved_references_to(name.bytes()))
                .filter(|it| it.global().is_some())
                .for_each(visit),
        }
    }

    /// `defInScope.node` of `getRelatedComponent`
    fn node_of_def_in_scope(self) -> Option<Node<'a>> {
        use DeclarationKind::{ClassName, FunctionName, Variable as VariableKind};
        match self {
            Variable::Declared(symbol) | Variable::OfClass(symbol, _, false) => symbol
                .declarations()
                .find(|def| matches!(def.kind(), Some(ClassName | FunctionName | VariableKind)))?
                .node(),
            Variable::OfClass(_, class, true) => Some(Node::Class(class)),
            Variable::Global(_) => None,
        }
    }
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
}

impl<'a> Related<'a> {
    /// The `componentNode` that `getRelatedComponent` adds.
    pub(crate) fn component_node(&mut self, node: Expr<'a>) -> Option<Node<'a>> {
        // Get the component path
        let (&variable_name, component_path) = self.paths.of(node).split_first()?;

        // Find the variable in the current scope
        let variable_in_scope = Variable::get_from_context(Node::Expr(node), variable_name)?;

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
                variable_in_scope.for_each_reference(node.file(), &mut |reference| {
                    let (text_of_ref_id, component_node) = ref_id_of(reference);
                    references.entry(text_of_ref_id).or_insert(component_node);
                });
                references
            });
            if let Some(&Some(component_node)) = references.get(&component_name[..]) {
                return Some(Node::Expr(component_node));
            }
        }

        // Try to find the component using variable declarations
        let mut component_node = match variable_in_scope.node_of_def_in_scope()? {
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
            let property = properties
                .iter()
                .find(|it| it.key().and_then(name_of_key) == Some(name.bytes()))?;
            component_node = property.value()?;
        }
        Some(Node::Expr(component_node))
    }
}
