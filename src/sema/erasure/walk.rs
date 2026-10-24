use super::describe::Side;
use super::{
    ErasureMismatch, ErasureMismatchKind as Kind, Label, Marks, NodeShape, Subtree,
    UntypedTextRanges,
};
use crate::hir::{DecoratorOwner, ExprKind, File, NodeData};
use crate::module_format::{file_esm_syntax, statement_esm_syntax};
use std::mem::{discriminant, take};

pub(super) fn run(typed: &File<'_>, untyped: &File<'_>) -> (Step, UntypedTextRanges) {
    let mut walk = Walk {
        typed: Side::new(typed, true),
        untyped: Side::new(untyped, false),
        stack: Vec::new(),
        ranges: UntypedTextRanges {
            functions: vec![(0, 0); typed.fns.len()],
            classes: vec![(0, 0); typed.classes.len()],
            token_offsets: Vec::new(),
        },
    };
    let result = walk.run();
    walk.ranges.token_offsets.sort_unstable();
    walk.ranges.token_offsets.dedup_by_key(|offsets| offsets.0);
    (result, walk.ranges)
}

type Owners = (NodeData, NodeData);
type Pair = (Subtree, Subtree, Owners);
type Step = Result<(), ErasureMismatch>;

fn mismatch(kind: Kind, nodes: Owners) -> ErasureMismatch {
    ErasureMismatch {
        kind,
        typed: nodes.0,
        untyped: nodes.1,
    }
}

fn ensure(is_same: bool, kind: Kind, nodes: Owners) -> Step {
    match is_same {
        true => Ok(()),
        false => Err(mismatch(kind, nodes)),
    }
}

fn check_labels(typed: &Label<'_>, untyped: &Label<'_>, nodes: Owners) -> Step {
    let has_same_kind = typed.tag == untyped.tag && typed.key_kind == untyped.key_kind;
    ensure(has_same_kind, Kind::NodeKind, nodes)?;
    ensure(typed.names == untyped.names, Kind::Name, nodes)?;
    ensure(typed.literal == untyped.literal, Kind::Literal, nodes)?;
    ensure(typed.operator == untyped.operator, Kind::Operator, nodes)?;
    let has_same_marks =
        untyped.marks.contains(typed.marks) && Marks::PURE.contains(untyped.marks - typed.marks);
    let has_same_flags = typed.flags == untyped.flags
        && typed.expr_flags == untyped.expr_flags
        && typed.chain == untyped.chain
        && typed.form == untyped.form;
    ensure(has_same_marks && has_same_flags, Kind::Flags, nodes)
}

fn node_data(node: Subtree, owner: NodeData) -> NodeData {
    match node {
        Subtree::Stmt(id) => NodeData::Stmt(id),
        Subtree::Expr(id) | Subtree::Accessed(id) | Subtree::AssignmentTarget(id) => {
            NodeData::Expr(id)
        }
        Subtree::Pattern(id) => NodeData::Pat(id),
        Subtree::Prop(id) | Subtree::AssignmentProperty(id) => NodeData::Prop(id),
        Subtree::PatProp(id) => NodeData::PatProp(id),
        Subtree::PatElem(id) => NodeData::PatElem(id),
        Subtree::VarDecl(id) => NodeData::VarDecl(id),
        Subtree::Case(id) => NodeData::Case(id),
        Subtree::Param(id) => NodeData::Param(id),
        Subtree::Member(id) => NodeData::Member(id),
        Subtree::ImportSpec(id) => NodeData::ImportSpec(id),
        Subtree::ExportSpec(id) => NodeData::ExportSpec(id),
        _ => owner,
    }
}

fn text_end(file: &File<'_>, owner: NodeData) -> Option<u32> {
    match owner {
        NodeData::Expr(expression) => Some(file[expression].end),
        NodeData::Stmt(statement) => Some(file[statement].loc.end),
        NodeData::Member(member) => Some(file[member].loc.end),
        _ => None,
    }
}

const NO_OFFSET: u32 = u32::MAX;
const MAX_TOKEN_OFFSETS: usize = 4;

fn last_byte(end: u32) -> u32 {
    end.checked_sub(1).unwrap_or(NO_OFFSET)
}

fn token_offsets(file: &File<'_>, node: Subtree) -> [u32; MAX_TOKEN_OFFSETS] {
    match node {
        Subtree::Expr(written)
        | Subtree::Accessed(written)
        | Subtree::AssignmentTarget(written) => {
            let e = file.skip_type_assertions(written);
            let token_inside = match file[e].kind {
                ExprKind::Dot { .. } => file.name_pos(e),
                ExprKind::Call(call) | ExprKind::New(call) => file[call].close_pos,
                _ => NO_OFFSET,
            };
            [
                file[written].pos,
                file[e].pos,
                token_inside,
                last_byte(file[e].end),
            ]
        }
        Subtree::Stmt(stmt) => {
            let stmt = file[stmt];
            [stmt.start, last_byte(stmt.loc.end), NO_OFFSET, NO_OFFSET]
        }
        Subtree::Function(function) => {
            let function = file[function];
            [
                function.start,
                function.text_start,
                function.name_pos,
                function.anchor,
            ]
        }
        Subtree::Class(class) => {
            let class = file[class];
            [class.start, class.text_start, class.name_pos, NO_OFFSET]
        }
        Subtree::Member(member) => {
            let member = file[member];
            [
                member.start,
                member.name_pos,
                last_byte(member.loc.end),
                NO_OFFSET,
            ]
        }
        Subtree::Prop(prop) | Subtree::AssignmentProperty(prop) => {
            [file[prop].start, file[prop].pos, NO_OFFSET, NO_OFFSET]
        }
        Subtree::Pattern(pattern) => [file[pattern].pos, NO_OFFSET, NO_OFFSET, NO_OFFSET],
        Subtree::PatProp(property) => [file[property].pos, NO_OFFSET, NO_OFFSET, NO_OFFSET],
        Subtree::PatElem(element) => [file[element].start, NO_OFFSET, NO_OFFSET, NO_OFFSET],
        Subtree::VarDecl(declaration) => [
            file[file[declaration].pat].pos,
            NO_OFFSET,
            NO_OFFSET,
            NO_OFFSET,
        ],
        Subtree::Case(case) => [file[case].pos, NO_OFFSET, NO_OFFSET, NO_OFFSET],
        Subtree::Param(parameter) => [file[parameter].pos, NO_OFFSET, NO_OFFSET, NO_OFFSET],
        Subtree::ImportSpec(specifier) => [file[specifier].start, NO_OFFSET, NO_OFFSET, NO_OFFSET],
        Subtree::ExportSpec(specifier) => [file[specifier].start, NO_OFFSET, NO_OFFSET, NO_OFFSET],
        Subtree::Statements(_) | Subtree::Import(_) | Subtree::Export(_) => {
            [NO_OFFSET; MAX_TOKEN_OFFSETS]
        }
    }
}

fn first_decorated_node(file: &File<'_>) -> Option<NodeData> {
    let &(owner, decorator) = file.decorators.first()?;
    Some(match owner {
        DecoratorOwner::Class(_) => NodeData::Expr(decorator),
        DecoratorOwner::Member(member) => NodeData::Member(member),
        DecoratorOwner::Param(param) => NodeData::Param(param),
    })
}

struct Walk<'a, 't, 'u> {
    typed: Side<'a, 't>,
    untyped: Side<'a, 'u>,
    stack: Vec<Pair>,
    ranges: UntypedTextRanges,
}

impl Walk<'_, '_, '_> {
    fn run(&mut self) -> Step {
        self.check_decorators()?;
        let typed = Subtree::Statements(self.typed.file.body);
        let untyped = Subtree::Statements(self.untyped.file.body);
        self.stack
            .push((typed, untyped, (NodeData::File, NodeData::File)));
        while let Some((typed, untyped, owners)) = self.stack.pop() {
            self.check_pair(typed, untyped, owners)?;
        }
        self.check_module_syntax()
    }

    fn check_decorators(&self) -> Step {
        if let Some(node) = first_decorated_node(self.typed.file) {
            return Err(mismatch(Kind::EmitsCode, (node, NodeData::File)));
        }
        if let Some(node) = first_decorated_node(self.untyped.file) {
            return Err(mismatch(Kind::ChildCount, (NodeData::File, node)));
        }
        Ok(())
    }

    fn check_module_syntax(&self) -> Step {
        let (typed, untyped) = (self.typed.file, self.untyped.file);
        let untyped_syntax = file_esm_syntax(untyped);
        if file_esm_syntax(typed) == untyped_syntax {
            return Ok(());
        }
        let mut statements = typed.ids(typed.body);
        let stronger = statements.find(|&it| statement_esm_syntax(typed, it) > untyped_syntax);
        let node = stronger.map_or(NodeData::File, NodeData::Stmt);
        Err(mismatch(Kind::EmitsCode, (node, NodeData::File)))
    }

    fn check_pair(&mut self, typed: Subtree, untyped: Subtree, owners: Owners) -> Step {
        let nodes = (node_data(typed, owners.0), node_data(untyped, owners.1));
        ensure(
            discriminant(&typed) == discriminant(&untyped),
            Kind::NodeKind,
            nodes,
        )?;
        match (self.typed.describe(typed), self.untyped.describe(untyped)) {
            (NodeShape::Absent, NodeShape::Absent) => return Ok(()),
            (NodeShape::EmitsCode, NodeShape::Absent) => {
                return Err(mismatch(Kind::EmitsCode, (nodes.0, owners.1)));
            }
            (NodeShape::Absent, _) | (_, NodeShape::Absent) => {
                return Err(mismatch(Kind::ChildCount, owners));
            }
            (NodeShape::EmitsCode, _) => return Err(mismatch(Kind::EmitsCode, nodes)),
            (NodeShape::Comparable(typed_label), NodeShape::Comparable(untyped_label)) => {
                check_labels(&typed_label, &untyped_label, nodes)?;
                self.record_text_range(typed, untyped, owners.1);
                self.record_token_offsets(typed, untyped);
            }
            (
                NodeShape::NotComparable | NodeShape::TypeAssertion(_) | NodeShape::Comparable(_),
                _,
            ) => return Err(mismatch(Kind::NodeKind, nodes)),
        }
        if self.typed.children.len() != self.untyped.children.len() {
            return Err(match self.find_code_emitting_child() {
                Some(child) => mismatch(Kind::EmitsCode, (node_data(child, nodes.0), nodes.1)),
                None => mismatch(Kind::ChildCount, nodes),
            });
        }
        let (typed, untyped) = (&self.typed.children, &self.untyped.children);
        for (&typed, &untyped) in typed.iter().zip(untyped).rev() {
            self.stack.push((typed, untyped, nodes));
        }
        Ok(())
    }

    fn record_text_range(&mut self, typed: Subtree, untyped: Subtree, untyped_owner: NodeData) {
        let file = self.untyped.file;
        let Some(end) = text_end(file, untyped_owner) else {
            return;
        };
        match (typed, untyped) {
            (Subtree::Function(typed), Subtree::Function(untyped)) => {
                self.ranges.functions[typed.idx()] = (file[untyped].text_start, end);
            }
            (Subtree::Class(typed), Subtree::Class(untyped)) => {
                self.ranges.classes[typed.idx()] = (file[untyped].text_start, end);
            }
            _ => {}
        }
    }

    fn record_token_offsets(&mut self, typed: Subtree, untyped: Subtree) {
        let typed = token_offsets(self.typed.file, typed);
        let untyped = token_offsets(self.untyped.file, untyped);
        let pairs = typed.into_iter().zip(untyped);
        let recorded = pairs.filter(|&(typed, untyped)| typed != NO_OFFSET && untyped != NO_OFFSET);
        self.ranges.token_offsets.extend(recorded);
    }

    fn find_code_emitting_child(&mut self) -> Option<Subtree> {
        let children = take(&mut self.typed.children);
        let mut children = children.into_iter();
        children.find(|&child| matches!(self.typed.describe(child), NodeShape::EmitsCode))
    }
}
