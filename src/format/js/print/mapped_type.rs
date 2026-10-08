use super::semicolon::OptionalSemicolon;
use crate::js::utils::suppressed::FormatSuppressedNode;
use crate::prelude::*;
use crate::write;

/// `{ readonly [K in T as N]?: V }`
pub(crate) fn write_ts_mapped_type<'a>(ty: TypeNode<'a>, mapped: Mapped<'a>, f: &mut Formatter<'a>) {
    let param = mapped.param();
    let key = param.name();
    if f.comments().is_suppressed(key.start()) {
        return write!(f, FormatSuppressedNode(ty.span()));
    }
    // One that has a line break after its `{` in the source stays broken.
    let should_expand = f.source_text().has_line_terminator_after_skipping_comments(ty.span().start + 1);

    let format_inner = format_with(|f| {
        if should_expand && !f.is_quiet() {
            let comments = match f.comments().has_leading_own_line_comment(key.start()) {
                true => f.comments().comments_before(key.start()),
                false => f.comments().comments_before_character(ty.span().start, b'['),
            };
            write!(f, FormatLeadingComments::Comments(comments));
        }

        match mapped.readonly() {
            MappedModifier::None => {}
            MappedModifier::Add => write!(f, [mapped.is_readonly_with_plus().then_some("+"), "readonly", space()]),
            MappedModifier::Remove => write!(f, ["-", "readonly", space()]),
        }

        let format_inner_inner = format_with(|f| {
            write!(f, "[");
            // The comments after the key are written before the `]`.
            format_leading_comments(key.span()).fmt(f);
            write!(f, source_text(key.span()));
            write!(f, [space(), "in", space(), param.constraint()]);
            if let Some(name_type) = mapped.name_type() {
                write!(f, [space(), "as", space(), name_type]);
            }
            if !f.is_quiet() {
                let comments = f.comments().comments_before_character(key.span().end, b']');
                write!(f, FormatTrailingComments::Comments(comments));
            }
            write!(f, "]");
            match mapped.optional() {
                MappedModifier::None => {}
                MappedModifier::Add => write!(f, [mapped.is_optional_with_plus().then_some("+"), "?"]),
                MappedModifier::Remove => write!(f, "-?"),
            }
        });

        write!(f, group(&format_inner_inner));
        if let Some(type_annotation) = mapped.ty() {
            write!(f, [":", space(), type_annotation]);
        }
        write!(f, if_group_breaks(&OptionalSemicolon));
    });

    write!(
        f,
        [
            "{",
            group(&soft_block_indent_with_maybe_space(&format_inner, f.options().bracket_spacing.value()))
                .should_expand(should_expand),
            "}",
        ]
    );
}
