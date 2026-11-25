use super::binary::{ADD, SHIFT, precedence, should_flatten};
use super::*;

/// For an operand of `parent` that has an operator itself.
pub(in super::super) fn operand_needs_parentheses(parent: T, op: T, is_right: bool) -> bool {
    let (above, own) = (precedence(parent), precedence(op));
    if above <= 3 && own <= 3 {
        return parent != op;
    }
    above > own
        || (above == own && (is_right || !should_flatten(parent, op)))
        || (above < own && op == T::Percent && above == ADD)
        || matches!(above, 4..=6 | SHIFT)
}

impl Emitter<'_, '_> {
    #[inline]
    pub(super) fn needs_parentheses(&self, id: Id) -> bool {
        let node = self.node(id);
        match node.kind {
            K::Ident => node.op != T::Ident && self.identifier_needs_parentheses(id),
            K::This
            | K::Super
            | K::Null
            | K::Bool
            | K::BigInt
            | K::Str
            | K::Regex
            | K::Template
            | K::Meta
            | K::PrivateName
            | K::Array
            | K::Spread => false,
            _ => self.needs_parentheses_in_position(id, node),
        }
    }

    fn identifier_needs_parentheses(&self, id: Id) -> bool {
        let node = self.node(id);
        if !matches!(
            node.op,
            T::Module | T::Using | T::Component | T::Hook | T::Type
        ) {
            return false;
        }
        let mut ancestor = node.parent;
        while matches!(self.kind(ancestor), K::As | K::Satisfies) {
            ancestor = self.node(ancestor).parent;
        }
        ancestor != node.parent && self.kind(ancestor) == K::ExprStmt
    }

    /// Returns the last expression that starts with `id`, and its parent.
    pub(super) fn left_edge_end(&self, id: Id) -> (Id, Id) {
        let mut current = id;
        loop {
            let parent = self.node(current).parent;
            let node = self.node(parent);
            let continues = match node.kind {
                K::Assign => node.a == current && !node.has(flag::TARGET),
                K::Binary | K::Logical | K::Dot | K::Index | K::Cond => node.a == current,
                K::Tagged | K::Call => node.a == current && self.kind(current) != K::Fn,
                K::Update => !node.has(flag::PREFIX),
                K::Seq => self.tree.list_of(node).first() == Some(&current),
                K::NonNull | K::As | K::Satisfies => true,
                _ => false,
            };
            if !continues {
                return (current, parent);
            }
            current = parent;
        }
    }

    fn needs_parentheses_in_position(&self, id: Id, node: &Node) -> bool {
        let parent = self.node(node.parent);
        let is_first = parent.a == id;
        let is_object_or_callee =
            is_first && matches!(parent.kind, K::Dot | K::Index | K::Call | K::New);
        match parent.kind {
            K::Args | K::Declarator | K::Array if !matches!(node.kind, K::Assign | K::Seq) => {
                return false;
            }
            K::Extends => {
                let mut superclass = node;
                while superclass.kind == K::NonNull {
                    superclass = self.node(superclass.a);
                }
                if !matches!(
                    superclass.kind,
                    K::Dot | K::Index | K::Call | K::Ident | K::Class
                ) {
                    return true;
                }
            }
            K::ExportDefault if self.should_wrap_function_for_export_default(id) => return true,
            _ => {}
        }
        match node.kind {
            K::Dot | K::Index | K::Call | K::NonNull if self.is_chain_root(id) => {
                match parent.kind {
                    K::NonNull | K::Tagged | K::New => is_first,
                    K::Dot | K::Index | K::Call => is_first && !parent.has(flag::OPTIONAL),
                    _ => false,
                }
            }
            K::Dot | K::Index | K::Call | K::NonNull | K::Tagged | K::ImportCall => {
                parent.kind == K::New && is_first && self.has_call_on_left_edge(id)
            }
            K::Object if node.has(flag::TARGET) => false,
            K::Object => {
                let (top, end) = self.left_edge_end(id);
                match self.kind(end) {
                    K::ExprStmt => true,
                    K::Arrow => !matches!(self.kind(top), K::Assign | K::Seq),
                    _ => false,
                }
            }
            K::Fn | K::Class => {
                self.kind(self.left_edge_end(id).1) == K::ExprStmt
                    || match node.kind {
                        K::Fn => is_first && matches!(parent.kind, K::Tagged | K::Call | K::New),
                        _ => is_first && parent.kind == K::New,
                    }
            }
            K::Num => match self.is_oxfmt {
                true => parent.kind == K::Dot,
                false => is_first && matches!(parent.kind, K::Dot | K::Index),
            },
            K::Unary | K::Update => match parent.kind {
                K::Unary => match (node.kind, node.op) {
                    (K::Update, _) if !node.has(flag::PREFIX) => false,
                    (_, T::PlusPlus) => parent.op == T::Plus,
                    (_, T::MinusMinus) => parent.op == T::Minus,
                    (_, op @ (T::Plus | T::Minus)) => parent.op == op,
                    _ => false,
                },
                K::Tagged | K::NonNull => true,
                K::Binary => {
                    is_first
                        && match parent.op {
                            T::StarStar => true,
                            T::In | T::Instanceof => node.kind == K::Unary,
                            _ => false,
                        }
                }
                _ => is_object_or_callee,
            },
            K::Seq => !matches!(parent.kind, K::For | K::Arrow),
            K::Binary | K::Logical | K::As | K::Satisfies => {
                self.binary_or_cast_needs_parentheses(id, node, parent)
            }
            K::Yield | K::Await => match parent.kind {
                K::Await => node.kind == K::Yield,
                K::Tagged
                | K::Unary
                | K::Logical
                | K::Binary
                | K::Spread
                | K::As
                | K::Satisfies
                | K::NonNull => true,
                K::Cond => is_first,
                _ => is_object_or_callee,
            },
            K::Assign => self.assignment_needs_parentheses(id, node, parent),
            K::Cond => match parent.kind {
                K::Tagged
                | K::Unary
                | K::Spread
                | K::Binary
                | K::Logical
                | K::Await
                | K::JsxSpreadAttr
                | K::As
                | K::Satisfies
                | K::NonNull => true,
                K::Cond => is_first,
                _ => is_object_or_callee,
            },
            K::Arrow => match parent.kind {
                K::Binary
                | K::As
                | K::Satisfies
                | K::NonNull
                | K::Tagged
                | K::Unary
                | K::Logical
                | K::Await => true,
                K::Cond => is_first,
                _ => is_object_or_callee,
            },
            K::Jsx => self.jsx_needs_parentheses(id, parent),
            _ => false,
        }
    }

    fn should_wrap_function_for_export_default(&self, declaration: Id) -> bool {
        let mut current = declaration;
        loop {
            let node = self.node(current);
            let is_declaration = current == declaration;
            if matches!(node.kind, K::Fn | K::Class) {
                return is_declaration || !self.needs_parentheses(current);
            }
            if !is_declaration && self.needs_parentheses(current) {
                return false;
            }
            current = match node.kind {
                K::Seq => self.tree.list_of(node).first().copied().unwrap_or(NONE),
                K::Update if node.has(flag::PREFIX) => return false,
                K::Binary
                | K::Logical
                | K::Assign
                | K::Cond
                | K::Dot
                | K::Index
                | K::Call
                | K::Tagged
                | K::Update
                | K::As
                | K::Satisfies
                | K::NonNull => node.a,
                _ => return false,
            };
        }
    }

    fn assignment_needs_parentheses(&self, id: Id, node: &Node, parent: &Node) -> bool {
        if node.has(flag::TARGET) {
            return false;
        }
        let is_init_or_update = |parent: &Node, id: Id| parent.a == id || parent.c == id;
        match parent.kind {
            K::For => !is_init_or_update(parent, id),
            K::ExprStmt => self.kind(node.a) == K::Object,
            K::Assign => parent.has(flag::TARGET),
            K::Seq => {
                let above = self.node(parent.parent);
                !(above.kind == K::For && is_init_or_update(above, node.parent))
            }
            _ => true,
        }
    }

    fn binary_or_cast_needs_parentheses(&self, id: Id, node: &Node, parent: &Node) -> bool {
        let is_cast = matches!(node.kind, K::As | K::Satisfies);
        match parent.kind {
            K::As | K::Satisfies => !is_cast,
            K::Cond => is_cast || node.op == T::QuestionQuestion,
            K::Tagged
            | K::JsxSpreadAttr
            | K::Spread
            | K::Await
            | K::NonNull
            | K::Update
            | K::Unary => true,
            K::Assign => is_cast && parent.a == id,
            K::Logical | K::Binary => {
                is_cast || operand_needs_parentheses(parent.op, node.op, parent.b == id)
            }
            K::Dot | K::Index | K::Call | K::New => parent.a == id,
            _ => false,
        }
    }

    fn has_call_on_left_edge(&self, id: Id) -> bool {
        let mut current = id;
        loop {
            if current != id && self.is_chain_root(current) {
                return false;
            }
            let node = self.node(current);
            match node.kind {
                K::Call | K::ImportCall => return true,
                K::Index | K::Dot | K::Tagged | K::NonNull => current = node.a,
                _ => return false,
            }
        }
    }

    fn jsx_needs_parentheses(&self, id: Id, parent: &Node) -> bool {
        match parent.kind {
            K::Binary => parent.op == T::Lt && parent.a == id,
            K::Call | K::New => true,
            kind if self.is_oxfmt => matches!(
                kind,
                K::As
                    | K::Satisfies
                    | K::Await
                    | K::Dot
                    | K::Index
                    | K::Seq
                    | K::Unary
                    | K::NonNull
                    | K::Spread
                    | K::Tagged
                    | K::JsxSpreadAttr
            ),
            kind => !matches!(
                kind,
                K::Assign
                    | K::AssignPattern
                    | K::Param
                    | K::Cond
                    | K::ExprStmt
                    | K::Arrow
                    | K::Jsx
                    | K::JsxContainer
                    | K::Logical
                    | K::Prop
                    | K::Return
                    | K::Throw
                    | K::Yield
                    | K::ExportDefault
            ),
        }
    }

    pub(super) fn type_needs_parentheses(&self, id: Id, node: &Node) -> bool {
        let parent = self.node(node.parent);
        let is_in_operator = match parent.kind {
            K::ArrayType | K::TypeOperator | K::RestType | K::OptionalType => true,
            K::IndexedAccess => parent.a == id,
            _ => false,
        };
        let is_member = matches!(parent.kind, K::Union | K::Intersection);
        match node.kind {
            K::FnType => match parent.kind {
                K::Arrow => node.op != T::New,
                K::Conditional => {
                    parent.a == id || (parent.b == id && self.returns_predicate_or_infer(node))
                }
                _ => is_member || is_in_operator,
            },
            K::Infer => match parent.kind {
                _ if is_member => self.node(node.a).b != NONE || self.is_oxfmt,
                K::RestType => false,
                _ => is_in_operator,
            },
            K::Union | K::Intersection => is_member || is_in_operator,
            K::Conditional => match parent.kind {
                K::Conditional => parent.a == id || parent.b == id,
                K::TypeParam => parent.b == id,
                _ => is_member || is_in_operator,
            },
            K::TypeOperator => is_in_operator,
            K::ImportType if !node.has(flag::TYPEOF) => false,
            K::TypeQuery | K::ImportType => {
                is_in_operator && matches!(parent.kind, K::ArrayType | K::IndexedAccess)
            }
            _ => false,
        }
    }

    fn returns_predicate_or_infer(&self, function: &Node) -> bool {
        let mut returned = self.node(function.c);
        if returned.kind == K::Predicate && returned.b != NONE {
            if self.is_oxfmt {
                return true;
            }
            returned = self.node(returned.b);
        }
        returned.kind == K::Infer && self.node(returned.a).b != NONE
    }
}
