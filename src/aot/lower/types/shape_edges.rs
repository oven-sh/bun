use bun_sema::check::aot::{ShapeKind, TupleElementKind};

use super::{EdgeKind, TypeEdge, TypeEdges};
use crate::builtins::type_name_of;
use crate::lower::{CheckerTypeId, FileLowering};

pub(super) fn collect_edges(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> TypeEdges {
    let mut edges = TypeEdges::new();
    let Ok(shape) = file.queries.type_shape(ty) else {
        return edges;
    };
    match shape.kind {
        ShapeKind::Union(members) => {
            edges.extend(
                members
                    .iter()
                    .map(|&member| edge(EdgeKind::Transparent, member)),
            );
        }
        ShapeKind::TypeVariable {
            parameter: None,
            constraint: Some(constraint),
        } => edges.push(edge(EdgeKind::Transparent, constraint)),
        ShapeKind::Array { element, .. } => edges.push(edge(EdgeKind::Contents, element)),
        ShapeKind::Tuple { elements, .. } => {
            for element in elements {
                match element.kind {
                    TupleElementKind::Required
                    | TupleElementKind::Optional
                    | TupleElementKind::Rest => edges.push(edge(EdgeKind::Contents, element.ty)),
                    TupleElementKind::Variadic => {}
                }
            }
        }
        ShapeKind::Builtin { class, arguments } => {
            if let Some(type_name) = type_name_of(class) {
                for (slot, &argument) in type_name.type_arguments.iter().zip(arguments) {
                    if slot.is_some() {
                        edges.push(edge(EdgeKind::Contents, argument));
                    }
                }
            }
        }
        // A type parameter is a layout of its own, whatever its constraint is.
        ShapeKind::Anything(_)
        | ShapeKind::TypeVariable {
            parameter: Some(_), ..
        }
        | ShapeKind::TypeVariable {
            parameter: None,
            constraint: None,
        }
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
        | ShapeKind::Function(_)
        | ShapeKind::ClassConstructor(_)
        | ShapeKind::Class(_)
        | ShapeKind::Object => {}
    }
    edges
}

fn edge(kind: EdgeKind, target: CheckerTypeId) -> TypeEdge {
    TypeEdge { kind, target }
}

#[cfg(test)]
mod tests {
    use crate::compile::testing::lower_program_with_limits;
    use crate::ir::{DeclaredType, PositionFlags, Primitives, Type};
    use crate::statistics::LimitValues;

    const DECLARATIONS: &str = "declare module \"bun\" {\n\
        type int32 = number & { readonly \"bun.int32\"?: true };\n\
        }\n";

    /// The type of each parameter, and whether the build has to prove that it is an `int32`.
    #[track_caller]
    fn lower_parameters(types: [&str; 2]) -> Vec<(Type, bool)> {
        let [first, second] = types;
        let main = format!(
            "/// <reference path=\"./bun-declarations.d.ts\" />
import type {{ int32 }} from \"bun\";
export function probe(first: {first}, second: {second}): void {{}}
"
        );
        let files = [
            ("main.ts", &main[..]),
            ("bun-declarations.d.ts", DECLARATIONS),
        ];
        let lowered = lower_program_with_limits(&files, LimitValues::for_host());
        let [(_, lowered)] = &lowered[..] else {
            panic!("only the entry point has code");
        };
        let fragment = &lowered.fragment;
        let mut functions = fragment.functions.iter().map(|(_, function)| function);
        let probe = functions.find(|function| {
            let text = function.name.map(|name| fragment.strings.get(name));
            text == Some(&b"probe"[..])
        });
        let parameters = &probe.expect("the fragment defines the function").parameters;
        let describe = |parameter: &DeclaredType| {
            let is_promise = parameter.flags.contains(PositionFlags::IS_INT32_PROMISE);
            (fragment.types.get(parameter.ty).clone(), is_promise)
        };
        parameters.iter().map(describe).collect()
    }

    #[test]
    fn int32_is_found_beside_other_parts() {
        let types = lower_parameters(["{ brand?: true } & int32", "int32 & { brand?: true }"]);
        let int32 = Type::integers(i32::MIN.into(), i32::MAX.into());
        assert_eq!(types, vec![(int32, true); 2]);
    }

    #[test]
    fn other_brands_are_not_int32() {
        let types = lower_parameters(["number & { brand?: true }", "number"]);
        assert_eq!(
            types,
            vec![(Type::primitives(Primitives::NUMBER), false); 2]
        );
    }
}
