#[cfg(test)]
mod tests;

use bun_sema::check::aot::SchemaTypeUse;
use bun_sema::hir::{ExprId, NodeData, TypeNodeId};
use bun_sema::program::FileId;

use super::ValidatedFile;
use super::expected_result::ValidatingFunction;
use super::json_schema::{
    Source, WrittenSchema, accepts_only_valid_values, refuses_only_invalid_values,
};
use super::nodes::validation_nodes;
use super::written_value::read_written_value;
use crate::diagnostic_codes::Code;
use crate::diagnostics::Span;
use crate::ir::generated::LimitId;

const TRANSLATION: &[u8] = b"Schema.FromJSONSchema";
const NAMES_TOO_MANY_TYPES: &[u8] = b"the type argument names more types than the build reads, and one of them may be made from a schema";
const IS_INTERSECTED: &[u8] = b"the type stands in an intersection or under an interface, where what the other types declare counts as declared by the schema. Write Schema.AllOf<[A, B]>, which checks each type by itself";
const TYPE_IS_NOT_COMPUTED: &[u8] = b"the type that it describes can't be computed";

enum Refusal {
    NotRead { at: Span },
    NotCompiled { reason: Vec<u8> },
}

fn not_compiled(reason: &[u8]) -> Refusal {
    Refusal::NotCompiled {
        reason: reason.to_vec(),
    }
}

fn span_of_type_node<'c, 'p: 'c, 's: 'p>(
    file: &impl ValidatedFile<'c, 'p, 's>,
    written_in: FileId,
    node: TypeNodeId,
) -> Span {
    let written = &file.files().hir(written_in)[node];
    Span {
        file: written_in,
        start: written.pos,
        end: written.end,
    }
}

/// Whether each `Schema.FromJSONSchema<typeof schema>` that the type argument of `validate<T>()` | `JSON.parse<T>()` is written with accepts what its schema accepts and nothing else.
/// What is not shown is reported as an error.
pub(super) fn shows_schemas_of_type_argument<'c, 'p: 'c, 's: 'p>(
    file: &mut impl ValidatedFile<'c, 'p, 's>,
    call: ExprId,
    written: TypeNodeId,
    function: ValidatingFunction,
) -> bool {
    let max_declarations = file.limit(LimitId::MaxValidationNodes) as usize;
    let found = file
        .queries()
        .schema_types_written_under(written, max_declarations);
    let mut is_shown = !found.is_cut_short;
    if found.is_cut_short {
        let arguments = [TRANSLATION, NAMES_TOO_MANY_TYPES];
        file.report_at(call, Code::ValidatorSchemaIsNotCompiled, &arguments);
    }
    for used in &found.uses {
        let Err(refusal) = show_schema_type(file, used, call, written, function) else {
            continue;
        };
        is_shown = false;
        match refusal {
            Refusal::NotRead { at } => {
                let arguments: [&[u8]; 2] = [TRANSLATION, b"the schema"];
                file.report_for_call(call, at, Code::ValidatorSchemaIsNotRead, &arguments);
            }
            Refusal::NotCompiled { reason } => {
                let at = span_of_type_node(file, used.file, used.reference);
                let arguments = [TRANSLATION, reason.as_slice()];
                file.report_for_call(call, at, Code::ValidatorSchemaIsNotCompiled, &arguments);
            }
        }
    }
    is_shown
}

fn show_schema_type<'c, 'p: 'c, 's: 'p>(
    file: &mut impl ValidatedFile<'c, 'p, 's>,
    used: &SchemaTypeUse,
    call: ExprId,
    written: TypeNodeId,
    function: ValidatingFunction,
) -> Result<(), Refusal> {
    let Some(schema) = used.schema else {
        let at = span_of_type_node(file, used.file, used.reference);
        return Err(Refusal::NotRead { at });
    };
    if used.is_intersected {
        return Err(not_compiled(IS_INTERSECTED));
    }
    let value = read_written_value(file, used.file, schema).map_err(|place| {
        let hir = file.files().hir(place.file);
        let at = Span::of_node(hir, place.file, NodeData::Expr(place.expression));
        Refusal::NotRead { at }
    })?;
    let Ok(ty) = used.ty else {
        return Err(not_compiled(TYPE_IS_NOT_COMPUTED));
    };
    let position = file.hir()[call].pos;
    // The nodes of a type hang on the type, so these stand for it in the list of the whole type argument too. `Schema.DeepStrict` above it closes objects there and opens nothing.
    let Ok(nodes) = validation_nodes(file, ty, written, position) else {
        let mut reason = b"there is no check for the type that it describes, ".to_vec();
        reason.extend_from_slice(&file.queries().type_text(ty));
        return Err(Refusal::NotCompiled { reason });
    };
    let (tree, literal) = file.queries().tree_of_written_value(&value);
    let schema = WrittenSchema {
        hir: tree,
        schema: literal,
        options: None,
    };
    let source = match function {
        ValidatingFunction::Parse => Source::Text,
        ValidatingFunction::Validate => Source::Value,
    };
    // A type that the type is handed to may turn its answer round: `Schema.Not<T>`.
    let refused_from = match used.is_operand {
        true => source,
        false => Source::Text,
    };
    accepts_only_valid_values(file, &schema, &nodes, source)
        .and_then(|()| refuses_only_invalid_values(file, &schema, &nodes, refused_from))
        .map_err(|no_proof| Refusal::NotCompiled {
            reason: no_proof.describe(),
        })
}
