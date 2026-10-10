use crate::rules::parameter_properties::identifier_key;
use bun_lint::prelude::*;

/// Require type annotations in certain places.
pub struct Typedef {
    array_destructuring: bool,
    arrow_parameter: bool,
    member_variable_declaration: bool,
    object_destructuring: bool,
    parameter: bool,
    property_declaration: bool,
    variable_declaration: bool,
    variable_declaration_ignore_function: bool,
}

const EXPECTED_TYPEDEF: Message = Message::new("expectedTypedef", "Expected a type annotation.");
const EXPECTED_TYPEDEF_NAMED: Message =
    Message::new("expectedTypedefNamed", "Expected {{name}} to have a type annotation.");

/// The `typeAnnotation` of an `ObjectPattern` or an `ArrayPattern`. That of `...[a]: T` belongs to
/// the `RestElement`.
fn has_type_annotation(pattern: Pat) -> bool {
    match pattern.parent() {
        Node::VarDecl(declarator) => declarator.ty().is_some(),
        Node::Param(param) => !param.is_rest() && param.ty().is_some(),
        _ => false,
    }
}

/// The range of an `ObjectPattern` or an `ArrayPattern` in a declaration.
fn pattern_span(pattern: Pat) -> Span {
    match pattern.parent() {
        Node::Param(param) if !param.is_rest() => param.binding_span(),
        _ => pattern.span(),
    }
}

/// `node` is a pattern, in a declaration or in an assignment.
fn is_for_of_statement_context(node: Node) -> bool {
    let mut current = node;
    loop {
        current = match current.parent() {
            Node::VarDecl(declarator) => {
                return match declarator.parent() {
                    Node::Stmt(declaration) if declaration.tag() == StmtTag::Var => {
                        matches!(declaration.parent(), Node::Stmt(parent) if parent.tag() == StmtTag::ForOf)
                    }
                    _ => false,
                };
            }
            // One with a default is in an `AssignmentPattern`, a rest in a `RestElement`.
            Node::PatElem(element) if element.default().is_none() && !element.is_rest() => element.parent(),
            Node::PatProp(property) if property.default().is_none() && !property.is_rest() => property.parent(),
            Node::Expr(parent) if parent.tag() == ExprTag::Array => Node::Expr(parent),
            Node::Prop(property) if property.kind() != PropKind::Spread => property.parent(),
            Node::Stmt(parent) => return parent.tag() == StmtTag::ForOf,
            _ => return false,
        };
    }
}

fn is_ancestor_has_type_annotation(node: Node) -> bool {
    node.ancestors().any(|ancestor| matches!(ancestor, Node::Pat(pattern) if has_type_annotation(pattern)))
}

impl Typedef {
    fn report<'a>(cx: &Cx<'a, Self>, location: Span, name: Option<Name<'a>>) {
        match name {
            Some(name) => cx.report(location, EXPECTED_TYPEDEF_NAMED).data("name", name),
            None => cx.report(location, EXPECTED_TYPEDEF),
        };
    }

    fn is_variable_declaration_ignore_function(&self, node: Expr) -> bool {
        self.variable_declaration_ignore_function && node.tag() == ExprTag::Fn
    }

    /// An `ObjectPattern` or an `ArrayPattern` in a declaration.
    fn check_binding_pattern<'a>(&self, node: Pat<'a>, cx: &mut Cx<'a, Self>) {
        if node.tag() == PatTag::Array
            && matches!(node.parent(), Node::Param(rest) if rest.is_rest() && rest.ty().is_some())
        {
            return;
        }
        if !has_type_annotation(node)
            && !is_for_of_statement_context(Node::Pat(node))
            && !is_ancestor_has_type_annotation(Node::Pat(node))
        {
            Self::report(cx, pattern_span(node), None);
        }
    }

    /// An `ObjectPattern` or an `ArrayPattern` in an assignment.
    fn check_assignment_pattern<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if !node.is_assignment_target() {
            return;
        }
        // An assignment that is itself part of a pattern is an `AssignmentPattern`.
        if node.tag() == ExprTag::Array
            && matches!(node.parent(), Node::Expr(parent) if parent.tag() == ExprTag::Assign && !parent.is_assignment_target())
        {
            return;
        }
        if !is_for_of_statement_context(Node::Expr(node)) && !is_ancestor_has_type_annotation(Node::Expr(node)) {
            Self::report(cx, node.span(), None);
        }
    }

    fn check_parameters<'a>(&self, node: Func<'a>, cx: &mut Cx<'a, Self>) {
        let is_checked = match node.kind() {
            FnKind::Arrow => self.arrow_parameter,
            FnKind::Decl | FnKind::Expr | FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor => {
                self.parameter && node.has_body()
            }
            _ => false,
        };
        if !is_checked {
            return;
        }
        for param in node.params_with_this() {
            if param.ty().is_some() {
                continue;
            }
            if param.is_parameter_property() {
                Self::report(cx, param.span(), None);
                continue;
            }
            let is_identifier = param.default().is_none() && !param.is_rest();
            let name = param.pat().as_ident().filter(|_| is_identifier);
            Self::report(cx, param.span_without_modifiers(), name);
        }
    }

    fn check_member<'a>(&self, node: Member<'a>, cx: &mut Cx<'a, Self>) {
        match node.kind() {
            MemberKind::IndexSignature if self.property_declaration => {
                if node.func().is_some_and(|signature| signature.return_type().is_none()) {
                    Self::report(cx, node.span(), None);
                }
            }
            MemberKind::Property if node.ty().is_some() => {}
            MemberKind::Property if node.is_signature() => {
                if self.property_declaration {
                    Self::report(cx, node.span(), identifier_key(node));
                }
            }
            // The others are a `TSAbstractPropertyDefinition` and an `AccessorProperty`.
            MemberKind::Property if !node.flags().intersects(Flags::ABSTRACT | Flags::ACCESSOR) => {
                if self.member_variable_declaration
                    && !node.init().is_some_and(|value| self.is_variable_declaration_ignore_function(value))
                {
                    Self::report(cx, node.span(), identifier_key(node));
                }
            }
            _ => {}
        }
    }

    fn check_variable_declarator<'a>(&self, node: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        let id = node.pat();
        if node.ty().is_some()
            || (id.tag() == PatTag::Array && !self.array_destructuring)
            || (id.tag() == PatTag::Object && !self.object_destructuring)
            || node.init().is_some_and(|init| self.is_variable_declaration_ignore_function(init))
        {
            return;
        }
        // The parameter of a `catch` is not a `VariableDeclarator`.
        let Node::Stmt(declaration) = node.parent() else {
            return;
        };
        if declaration.tag() != StmtTag::Var
            || matches!(declaration.parent(), Node::Stmt(parent) if matches!(parent.tag(), StmtTag::ForOf | StmtTag::ForIn))
        {
            return;
        }
        Self::report(cx, node.span(), id.as_ident());
    }
}

impl Rule for Typedef {
    const META: Meta = Meta::typescript("typedef", Kind::Suggestion).deprecated();
    const ON: On = On::new()
        .pats(&[PatTag::Array, PatTag::Object])
        .exprs(&[ExprTag::Array, ExprTag::Object])
        .funcs()
        .members()
        .var_decls();
    no_state!();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        Typedef {
            array_destructuring: options.bool_or("arrayDestructuring", false),
            arrow_parameter: options.bool_or("arrowParameter", false),
            member_variable_declaration: options.bool_or("memberVariableDeclaration", false),
            object_destructuring: options.bool_or("objectDestructuring", false),
            parameter: options.bool_or("parameter", false),
            property_declaration: options.bool_or("propertyDeclaration", false),
            variable_declaration: options.bool_or("variableDeclaration", false),
            variable_declaration_ignore_function: options.bool_or("variableDeclarationIgnoreFunction", false),
        }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let mut on = On::new();
        if self.array_destructuring {
            on = on.pats(&[PatTag::Array]).exprs(&[ExprTag::Array]);
        }
        if self.object_destructuring {
            on = on.pats(&[PatTag::Object]).exprs(&[ExprTag::Object]);
        }
        if self.arrow_parameter || self.parameter {
            on = on.funcs();
        }
        if self.member_variable_declaration || self.property_declaration {
            on = on.members();
        }
        if self.variable_declaration {
            on = on.var_decls();
        }
        on
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.check_assignment_pattern(node, cx);
    }

    fn pat<'a>(&self, node: Pat<'a>, cx: &mut Cx<'a, Self>) {
        self.check_binding_pattern(node, cx);
    }

    fn func<'a>(&self, node: Func<'a>, cx: &mut Cx<'a, Self>) {
        self.check_parameters(node, cx);
    }

    fn member<'a>(&self, node: Member<'a>, cx: &mut Cx<'a, Self>) {
        self.check_member(node, cx);
    }

    fn var_decl<'a>(&self, node: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        self.check_variable_declarator(node, cx);
    }
}
