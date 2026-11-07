mod members;
mod parts;

use bun_sema::check::aot::{ShapeKind, TypeArgument};
use bun_sema::hir::ExprId;
use rustc_hash::FxHashMap;
use smallvec::{SmallVec, smallvec};

use self::parts::find_value_type;
use super::edges::find_function_shape;
use crate::ir::{FunctionId, TypeFlags, TypeId, TypeRef};
use crate::lower::{CheckerTypeId, FileLowering};

#[derive(Copy, Clone)]
struct FlowTarget {
    ty: CheckerTypeId,
    mapped: TypeId,
    names_layouts: bool,
    names_function_types: bool,
}

type Flow = (CheckerTypeId, CheckerTypeId);

#[derive(Default)]
pub(super) struct RecordedFlows {
    levels_followed: FxHashMap<Flow, u8>,
}

impl RecordedFlows {
    fn covers(&self, flow: Flow, levels: u8) -> bool {
        let followed = self.levels_followed.get(&flow);
        followed.is_some_and(|&followed| followed > levels)
    }

    fn note(&mut self, flow: Flow, levels: u8) {
        let followed = self.levels_followed.entry(flow).or_insert(0);
        *followed = (levels + 1).max(*followed);
    }
}

fn may_name_family(ty: &TypeRef<'_>) -> bool {
    !(ty.layouts.is_empty() && ty.functions.is_empty() && ty.classes.is_empty())
}

fn find_flow_target(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> Option<FlowTarget> {
    let mapped = file.map_type_at(ty).ty;
    let types = &file.fragment.types;
    let named = types.get(mapped);
    let target = FlowTarget {
        ty,
        mapped,
        names_layouts: !named.layouts.is_empty(),
        names_function_types: !named.functions.is_empty(),
    };
    let mut held = named.classes.iter().flat_map(|part| &part.contents);
    let is_target = target.names_layouts
        || target.names_function_types
        || held.any(|&held| may_name_family(&types.get(held)));
    is_target.then_some(target)
}

fn collect_function_types(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> SmallVec<[FunctionId; 4]> {
    let mut function_types = SmallVec::new();
    let mut opened: SmallVec<[CheckerTypeId; 4]> = SmallVec::new();
    let mut pending: SmallVec<[CheckerTypeId; 4]> = smallvec![ty];
    while let Some(ty) = pending.pop() {
        let Ok(shape) = file.queries.type_shape(ty) else {
            continue;
        };
        match shape.kind {
            ShapeKind::Union(_)
            | ShapeKind::TypeVariable {
                constraint: Some(_),
            } if opened.contains(&ty) => {}
            ShapeKind::Union(members) => {
                opened.push(ty);
                pending.extend_from_slice(members);
            }
            ShapeKind::TypeVariable {
                constraint: Some(constraint),
            } => {
                opened.push(ty);
                pending.push(constraint);
            }
            ShapeKind::Function(signatures) => {
                function_types.extend(file.find_function_type(signatures));
            }
            ShapeKind::ClassConstructor(class) => {
                function_types.push(file.find_class_function_type(class));
            }
            ShapeKind::Anything(_)
            | ShapeKind::TypeVariable { constraint: None }
            | ShapeKind::Never
            | ShapeKind::Undefined
            | ShapeKind::Null
            | ShapeKind::Boolean
            | ShapeKind::BooleanLiteral(_)
            | ShapeKind::Number
            | ShapeKind::NumberLiteral(_)
            | ShapeKind::NumericEnumMember(_)
            | ShapeKind::BigInt
            | ShapeKind::BigIntLiteral { .. }
            | ShapeKind::String
            | ShapeKind::StringLiteral(_)
            | ShapeKind::TemplateLiteral { .. }
            | ShapeKind::Symbol
            | ShapeKind::Int32 { .. }
            | ShapeKind::AnyObject
            | ShapeKind::Array { .. }
            | ShapeKind::Tuple { .. }
            | ShapeKind::Builtin { .. }
            | ShapeKind::Class(_)
            | ShapeKind::Object => {}
        }
    }
    function_types
}

fn record_function_type_edges(
    file: &mut FileLowering<'_, '_, '_, '_>,
    source: CheckerTypeId,
    target: CheckerTypeId,
) {
    let targets = collect_function_types(file, target);
    for function_type in collect_function_types(file, source) {
        if targets.contains(&function_type) {
            continue;
        }
        for &target in &targets {
            file.fragment.add_function_type_edge(function_type, target);
        }
    }
}

fn record_value_flow(
    file: &mut FileLowering<'_, '_, '_, '_>,
    source: CheckerTypeId,
    target: FlowTarget,
) {
    if !target.names_layouts && !target.names_function_types {
        return;
    }
    if !target.names_function_types && find_function_shape(file, source).is_some() {
        return;
    }
    let mapped = file.map_type_at(source).ty;
    let named = file.fragment.types.get(mapped);
    let brings_layouts = target.names_layouts && !named.layouts.is_empty();
    let brings_functions = target.names_function_types && !named.functions.is_empty();
    if target.names_layouts && named.flags.contains(TypeFlags::ANY_OBJECT) {
        file.note_layouts_of_objects(target.mapped);
    }
    if brings_layouts && !file.flows_into_container(source, target.ty) {
        members::record_layout_flow(file, source, mapped, target);
    }
    if brings_functions {
        record_function_type_edges(file, source, target.ty);
    }
}

fn begins_following_parts(
    file: &mut FileLowering<'_, '_, '_, '_>,
    source: CheckerTypeId,
    target: CheckerTypeId,
    levels: u8,
) -> bool {
    let followed_parts = &mut file.types.conversions.followed_parts;
    let followed = followed_parts.entry((source, target)).or_insert(0);
    let goes_further = *followed < levels;
    *followed = levels.max(*followed);
    goes_further
}

fn record_flow_at(
    file: &mut FileLowering<'_, '_, '_, '_>,
    source: CheckerTypeId,
    target: FlowTarget,
    levels: u8,
) {
    if source == target.ty {
        return;
    }
    let flow = (source, target.ty);
    if file.types.conversions.recorded_flows.covers(flow, levels) {
        return;
    }
    let unstable_answers = file.queries.count_unstable_answers();
    record_value_flow(file, source, target);
    if levels > 0 && begins_following_parts(file, source, target.ty, levels) {
        parts::record_flows_of_parts(file, source, target.ty, levels - 1);
    }
    if file.queries.count_unstable_answers() == unstable_answers {
        file.types.conversions.recorded_flows.note(flow, levels);
    }
}

fn is_container(file: &mut FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId) -> bool {
    let shape = file.queries.type_shape(ty);
    shape.is_ok_and(|shape| {
        matches!(
            shape.kind,
            ShapeKind::Array { .. } | ShapeKind::Builtin { .. }
        )
    })
}

impl FileLowering<'_, '_, '_, '_> {
    fn record_type_flow(&mut self, source: CheckerTypeId, target: CheckerTypeId) {
        if let Some(target) = find_flow_target(self, target) {
            record_flow_at(self, source, target, parts::LEVELS_BELOW_FLOW);
        }
    }

    pub(in crate::lower) fn record_flow_into_written_type(
        &mut self,
        source: ExprId,
        written: CheckerTypeId,
    ) {
        if find_flow_target(self, written).is_none() {
            return;
        }
        if let Ok(source) = self.queries.expression_type(source) {
            self.record_type_flow(source, written);
        }
    }

    pub(in crate::lower) fn record_type_arguments(&mut self, pairs: &[TypeArgument]) {
        for pair in pairs {
            if let Some((bound, _)) = find_value_type(self, pair.parameter) {
                self.record_type_flow(pair.argument, bound);
            }
        }
    }

    pub(crate) fn record_heritage_flow(
        &mut self,
        instance: CheckerTypeId,
        inherited: CheckerTypeId,
    ) {
        self.record_type_flow(instance, inherited);
        self.record_base_class_flow(instance, inherited);
    }

    pub(crate) fn record_base_class_flow(&mut self, instance: CheckerTypeId, base: CheckerTypeId) {
        if begins_following_parts(self, instance, base, 1) {
            parts::record_member_flows(self, instance, base);
        }
    }

    fn flows_into_container(&mut self, source: CheckerTypeId, target: CheckerTypeId) -> bool {
        let shapes = (
            self.queries.type_shape(source),
            self.queries.type_shape(target),
        );
        let (Ok(source_shape), Ok(target_shape)) = shapes else {
            return false;
        };
        let ShapeKind::Union(members) = target_shape.kind else {
            return false;
        };
        source_shape.has_members()
            && members.iter().any(|&member| {
                is_container(self, member)
                    && matches!(self.queries.is_assignable(source, member), Ok(true))
            })
    }
}

#[cfg(test)]
mod tests {
    use crate::compile::testing::lower_program;
    use crate::ir::{Id, LayoutId, LayoutKey};
    use crate::load::host_platform;
    use crate::lower::{CheckerTypeId, Fragment, LoweringOptions};

    use super::RecordedFlows;

    #[test]
    fn flow_is_looked_at_again_only_to_follow_its_parts_further() {
        let flow = (CheckerTypeId(3), CheckerTypeId(4));
        let mut recorded = RecordedFlows::default();
        assert!(!recorded.covers(flow, 0));
        recorded.note(flow, 0);
        assert!(recorded.covers(flow, 0));
        assert!(!recorded.covers(flow, 2));
        recorded.note(flow, 2);
        recorded.note(flow, 1);
        assert!((0..=2).all(|levels| recorded.covers(flow, levels)));
        assert!(!recorded.covers((flow.1, flow.0), 0));
    }

    #[track_caller]
    fn lower(source: &str) -> Fragment {
        let options = LoweringOptions {
            platform: host_platform(),
            embeds_function_text: false,
            reads_function_texts_back: false,
            removable: Default::default(),
            minifies_identifiers: false,
            obfuscates: false,
            counts_executions: false,
            runs_tests: false,
        };
        let mut lowered = lower_program(&[("main.ts", source)], options);
        assert_eq!(lowered.len(), 1);
        lowered.remove(0).1.fragment
    }

    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    enum Member {
        Class(u32),
        ObjectType,
    }

    fn collect_layout_pairs(fragment: &Fragment) -> Vec<(Member, Member)> {
        let tables = fragment.tables.take();
        let describe = |layout: LayoutId| match tables.layout_keys[layout.index()] {
            LayoutKey::Class(class) => Member::Class(class.class.0),
            _ => Member::ObjectType,
        };
        let mut pairs = Vec::new();
        for &(source, target) in &fragment.family_facts.conversions {
            for &from in tables.types.get(source).layouts {
                let targets = tables.types.get(target).layouts.iter();
                pairs.extend(targets.map(|&to| (describe(from), describe(to))));
            }
        }
        fragment.tables.put_back(tables);
        pairs
    }

    #[test]
    fn class_joins_what_it_implements_and_nothing_that_it_only_flows_into() {
        let fragment = lower(
            "interface Shape { side: number }
class Square implements Shape { side = 1; corners = 4 }
class Plate { side = 2 }
function measure(shape: Shape) { return shape.side; }
export function probe() { return [measure(new Square()), measure(new Plate())]; }
",
        );
        let pairs = collect_layout_pairs(&fragment);
        let shape = Member::ObjectType;
        assert!(pairs.contains(&(Member::Class(0), shape)), "{pairs:?}");
        assert!(!pairs.contains(&(Member::Class(1), shape)), "{pairs:?}");
    }

    #[test]
    fn operand_of_a_cast_joins_the_type_that_is_written() {
        let fragment = lower(
            "interface Marked { mark: number }
class Plate { side = 2 }
export function probe(plate: Plate) { return (plate as Plate & Marked as Marked).mark; }
",
        );
        let pairs = collect_layout_pairs(&fragment);
        let marked = Member::ObjectType;
        assert!(pairs.contains(&(Member::Class(0), marked)), "{pairs:?}");
    }
}
