use super::semicolon::OptionalSemicolon;
use crate::js::format::identifier;
use crate::js::utils::suppressed::FormatSuppressedNode;
use crate::prelude::*;
use crate::{format_args, write};

/// `{ readonly [K in T as N]?: V }`
pub(crate) fn write_ts_mapped_type<'a>(
    ty: TypeNode<'a>,
    mapped: Mapped<'a>,
    f: &mut Formatter<'a>,
) {
    let param = mapped.param();
    let key = param.name();
    if f.comments().is_suppressed(key.start()) {
        return write!(f, FormatSuppressedNode(ty.span()));
    }
    // One that has a line break after its `{` in the source stays broken.
    let should_expand = f.options().expand == Expand::Auto
        && f.source_text()
            .has_line_terminator_after_skipping_comments(ty.span().start + 1);

    let format_inner = format_with(|f| {
        if !f.is_quiet() {
            write_comments_before_bracket(
                f.comments()
                    .comments_before_character(ty.span().start, b'['),
                f,
            );
        }
        match mapped.readonly() {
            MappedModifier::None => {}
            MappedModifier::Add => write!(
                f,
                [
                    mapped.is_readonly_with_plus().then_some("+"),
                    "readonly",
                    space()
                ]
            ),
            MappedModifier::Remove => write!(f, ["-", "readonly", space()]),
        }

        let format_key = format_with(|f| {
            // The blank after `in` stays if a comment that trails the key ends up behind it.
            write!(
                f,
                [
                    identifier(key, AstNodes::TSMappedType(ty)),
                    " in ",
                    param.constraint()
                ]
            );
            if let Some(name_type) = mapped.name_type() {
                write!(f, [" as ", name_type]);
            }
        });
        write!(
            f,
            group(&format_args!("[", soft_block_indent(&format_key), "]"))
        );

        match mapped.optional() {
            MappedModifier::None => {}
            MappedModifier::Add => write!(f, [mapped.is_optional_with_plus().then_some("+"), "?"]),
            MappedModifier::Remove => write!(f, "-?"),
        }
        if let Some(type_annotation) = mapped.ty() {
            write!(f, [":", space(), type_annotation]);
        }
        // In Flow, whose types those in a JavaScript file are, it is a property of an object type.
        match f.file().is_javascript() {
            true => write!(f, FormatTrailingCommas::ES5),
            false => write!(f, if_group_breaks(&OptionalSemicolon)),
        }
    });

    write!(
        f,
        [
            "{",
            group(&soft_block_indent_with_maybe_space(
                &format_inner,
                f.options().bracket_spacing.value()
            ))
            .should_expand(should_expand),
            "}",
        ]
    );
}

/// The comments between the `{` and the `[`, each on its own line. The last one stays on the line
/// of the `[` if it is there in the source and fits.
fn write_comments_before_bracket<'a>(comments: &'a [Comment], f: &mut Formatter<'a>) {
    let Some((last, others)) = comments.split_last() else {
        return;
    };
    for comment in others {
        f.comments_mut().increment_printed_count();
        write!(f, [comment, hard_line_break()]);
    }
    f.comments_mut().increment_printed_count();
    match last.followed_by_newline() {
        true => write!(f, [last, hard_line_break()]),
        false => write!(f, group(&format_args!(last, soft_line_break_or_space()))),
    }
}
