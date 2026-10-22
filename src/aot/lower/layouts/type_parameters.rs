use bun_sema::check::aot::{ClassRef, TypeArgument, TypeParameterRef};
use bun_sema::hir::ExprId;
use rustc_hash::FxHashSet;

use crate::ir::{LayoutId, LayoutKey};
use crate::lower::{CheckerTypeId, FileLowering, convert};

pub(in crate::lower) fn type_parameter_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    parameter: TypeParameterRef,
) -> LayoutId {
    file.fragment.declare_layout(LayoutKey::TypeParameter(parameter))
}

fn record_type_arguments(
    file: &mut FileLowering<'_, '_, '_, '_>,
    pairs: &[TypeArgument],
    position: u32,
) {
    for pair in pairs {
        convert::record_type_flow(file, pair.argument, pair.parameter, position);
    }
}

pub(in crate::lower) fn record_call_type_arguments(
    file: &mut FileLowering<'_, '_, '_, '_>,
    call: ExprId,
) {
    if let Ok(pairs) = file.queries.call_type_arguments(call) {
        let position = file.hir[call].pos;
        record_type_arguments(file, pairs, position);
    }
}

fn find_class_position(file: &FileLowering<'_, '_, '_, '_>, class: ClassRef) -> u32 {
    match class.file == file.file {
        true => file.hir[class.class].start,
        false => 0,
    }
}

// Type mapping only lists the class types it meets, because a flow asks for layouts and types in turn.
pub(super) fn record_class_type_arguments_of_file(file: &mut FileLowering<'_, '_, '_, '_>) {
    let mut recorded: FxHashSet<(ClassRef, CheckerTypeId)> = FxHashSet::default();
    while !file.layouts.class_types.is_empty() {
        for (class, ty) in core::mem::take(&mut file.layouts.class_types) {
            if !recorded.insert((class, ty)) {
                continue;
            }
            if let Ok(pairs) = file.queries.class_type_arguments(class, ty) {
                let position = find_class_position(file, class);
                record_type_arguments(file, pairs, position);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::compile::testing::lower_program_with_limits;
    use crate::ir::{Id, LayoutKey};
    use crate::lower::Fragment;
    use crate::statistics::LimitValues;

    const NO_PAIRS: [(u32, u32); 0] = [];
    const NO_PARAMETERS: [u32; 0] = [];

    #[track_caller]
    fn lower(source: &str) -> Fragment {
        let files = [("main.ts", source)];
        let mut lowered = lower_program_with_limits(&files, LimitValues::for_host());
        assert_eq!(lowered.len(), 1);
        lowered.remove(0).1.fragment
    }

    // Each pair is a class and a type parameter, by their places among the declarations of the file.
    fn collect_classes_below_type_parameters(fragment: &Fragment) -> Vec<(u32, u32)> {
        let keys = &fragment.layout_keys;
        let mut found = Vec::new();
        for &(layout, supertype) in &fragment.supertype_edges {
            let edge = (keys[layout.index()], keys[supertype.index()]);
            if let (LayoutKey::Class(class), LayoutKey::TypeParameter(parameter)) = edge {
                found.push((class.class.0, parameter.parameter.0));
            }
        }
        found.sort_unstable();
        found
    }

    fn collect_type_parameters_with_members_without_layout(fragment: &Fragment) -> Vec<u32> {
        let layouts = &fragment.family_facts.layouts_with_members_without_layout;
        let mut found = Vec::new();
        for layout in layouts {
            if let LayoutKey::TypeParameter(parameter) = fragment.layout_keys[layout.index()] {
                found.push(parameter.parameter.0);
            }
        }
        found.sort_unstable();
        found
    }

    #[test]
    fn type_arguments_of_a_call_are_below_the_type_parameters() {
        let fragment = lower(
            "class A { a = 1 }
class B { b = 1 }
function create<T>(): T | undefined { return undefined; }
function choose<L, R = B>(): L | R | undefined { return undefined; }
create<A>();
choose<A>();
",
        );
        assert_eq!(collect_classes_below_type_parameters(&fragment), [(0, 0), (0, 1), (1, 2)]);
        assert_eq!(collect_type_parameters_with_members_without_layout(&fragment), NO_PARAMETERS);
    }

    #[test]
    fn type_arguments_of_a_construction_are_below_the_type_parameters() {
        let fragment = lower(
            "class A { a = 1 }
class Box<V> { value: V | undefined = undefined; }
new Box<A>();
",
        );
        assert_eq!(collect_classes_below_type_parameters(&fragment), [(0, 0)]);
    }

    #[test]
    fn type_arguments_of_a_class_type_are_below_the_type_parameters() {
        let fragment = lower(
            "class A { a = 1 }
class B { b = 1 }
class Pair<L, R> { left: L | undefined = undefined; right: R | undefined = undefined; }
export function read(pair: Pair<A, B>, same: Pair<A, B>) {}
",
        );
        assert_eq!(collect_classes_below_type_parameters(&fragment), [(0, 0), (1, 1)]);
    }

    #[test]
    fn primitive_type_argument_is_a_member_without_layout() {
        let fragment = lower(
            "function create<T>(): T | undefined { return undefined; }
create<number>();
",
        );
        assert_eq!(collect_classes_below_type_parameters(&fragment), NO_PAIRS);
        assert_eq!(collect_type_parameters_with_members_without_layout(&fragment), [0]);
    }

    #[test]
    fn type_parameter_without_arguments_has_nothing_below_it() {
        let fragment = lower(
            "class A { a = 1 }
class Box<V> {
  value: V | undefined = undefined;
  copy(): Box<V> { return this; }
}
function create<T>(): T | undefined { return undefined; }
function take(value: A) {}
take(new A());
create();
",
        );
        assert_eq!(collect_classes_below_type_parameters(&fragment), NO_PAIRS);
        assert_eq!(collect_type_parameters_with_members_without_layout(&fragment), NO_PARAMETERS);
    }
}
