use crate::js::format::identifier;
use crate::prelude::*;
use crate::write;

/// `[A, B]`
pub(crate) fn write_ts_tuple_type<'a>(ty: TypeNode<'a>, elements: List<'a, TupleElem<'a>>, f: &mut Formatter<'a>) {
    write!(f, "[");
    if elements.is_empty() {
        write!(f, format_dangling_comments(ty.span()).with_soft_block_indent());
    } else {
        let element_types = format_with(|f| {
            let trailing_separator = FormatTrailingCommas::ES5.trailing_separator(f.options());
            f.join_nodes_with_soft_line().entries_with_trailing_separator(
                elements.iter().map(FormatTupleElement),
                ",",
                trailing_separator,
            );
        });
        write!(f, group(&soft_block_indent(&element_types)));
    }
    write!(f, "]");
}

/// An element and the comments around it are a group, as in Prettier's `printArrayElements`: a
/// comment that ends its line in the source stays before the element if they fit on a line.
struct FormatTupleElement<'a>(TupleElem<'a>);

impl Spanned for FormatTupleElement<'_> {
    fn span(&self) -> Span {
        self.0.span()
    }
}

impl<'a> Format<'a> for FormatTupleElement<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        match f.is_quiet() {
            true => write!(f, self.0),
            false => write!(f, group(&self.0)),
        }
    }
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
