use bun_sema::atom::known;
use bun_sema::hir::{ExprId, ExprKind, TemplatePart};
use smallvec::SmallVec;

use super::FunctionLowering;
use super::call::{self, Arguments};
use super::expression::{self, Tail};
use crate::ir::ValueId;
use crate::ir::generated::TemplateString;

pub(in crate::lower) fn lower_template_literal(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    template: ExprId,
) -> ValueId {
    let hir = lowering.file.hir;
    let ExprKind::Template { exprs } = hir[template].kind else {
        unreachable!("lower_template_literal takes a Template expression");
    };
    let mut parts = hir.template_parts(template).iter();
    let mut strings: SmallVec<[ValueId; 8]> = SmallVec::new();
    for substitution in hir.ids(exprs) {
        strings.extend(emit_cooked_string(lowering, parts.next()));
        let value = expression::lower_expression(lowering, substitution);
        lowering.set_position(hir[substitution].pos);
        strings.push(lowering.builder.to_string(value));
    }
    strings.extend(emit_cooked_string(lowering, parts.next()));
    if let [string] = strings[..] {
        return string;
    }
    lowering.set_position(hir[template].pos);
    lowering.builder.strcat(&strings)
}

pub(in crate::lower) fn lower_tagged_template(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    tail: Tail<'_>,
) -> ValueId {
    let hir = lowering.file.hir;
    let ExprKind::TaggedTemplate(tagged) = hir[expression].kind else {
        unreachable!("lower_tagged_template takes a TaggedTemplate expression");
    };
    let site = hir[tagged];
    let callee = call::lower_callee(lowering, site.callee, None);
    let template = hir.template_of(tagged);
    lowering.set_position(hir[template].pos);
    let strings = collect_template_strings(lowering, template);
    let mut arguments: SmallVec<[ValueId; 4]> = SmallVec::with_capacity(site.args.len() + 1);
    arguments.push(lowering.builder.new_template_object(&strings));
    for substitution in hir.ids(site.args) {
        arguments.push(expression::lower_expression(lowering, substitution));
    }
    call::emit_call_expression(
        lowering,
        expression,
        callee,
        Arguments::Values(arguments),
        tail,
    )
}

fn emit_cooked_string(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    part: Option<&TemplatePart>,
) -> Option<ValueId> {
    let cooked = part?.cooked?;
    if cooked == known::empty {
        return None;
    }
    let string = lowering.file.intern_atom(cooked);
    Some(lowering.builder.string(string))
}

fn collect_template_strings(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    template: ExprId,
) -> SmallVec<[TemplateString; 4]> {
    let hir = lowering.file.hir;
    let parts = hir.template_parts(template);
    debug_assert!(
        !parts.is_empty(),
        "a template has one more part than substitutions"
    );
    let mut strings = SmallVec::with_capacity(parts.len());
    for part in parts {
        let cooked = part.cooked.map(|cooked| lowering.file.intern_atom(cooked));
        let raw = lowering.file.intern_atom(part.raw);
        strings.push(TemplateString { cooked, raw });
    }
    strings
}
