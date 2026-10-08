use crate::js::format::identifier;
use crate::prelude::*;
use crate::write;

/// `[A, B]`
pub(crate) fn write_ts_tuple_type<'a>(ty: TypeNode<'a>, elements: List<'a, TupleElem<'a>>, f: &mut Formatter<'a>) {
    write!(f, "[");
    if elements.is_empty() {
        write!(f, format_dangling_comments(ty.span()).with_block_indent());
    } else {
        let element_types = format_with(|f| {
            let trailing_separator = FormatTrailingCommas::ES5.trailing_separator(f.options());
            f.join_nodes_with_soft_line().entries_with_trailing_separator(elements.iter(), ",", trailing_separator);
        });
        write!(f, group(&soft_block_indent(&element_types)));
    }
    write!(f, "]");
}

/// `a: T`, `a?: T`, `T?`, `...T`, `...a: T`
pub(crate) fn write_ts_tuple_element<'a>(element: TupleElem<'a>, f: &mut Formatter<'a>) {
    write!(f, element.is_rest().then_some("..."));
    match element.name() {
        Some(label) => write!(
            f,
            [
                identifier(label, AstNodes::TSNamedTupleMember(element)),
                element.is_optional().then_some("?"),
                ":",
                space(),
                element.ty()
            ]
        ),
        None => write!(f, [element.ty(), element.is_optional().then_some("?")]),
    }
}
