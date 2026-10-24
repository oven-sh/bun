mod arguments;
mod binding;

use bun_sema::hir::{self, Call, ExprKind};

pub(in crate::lower) fn literal_argument_position(hir: &hir::File<'_>, call: &Call) -> Option<u32> {
    let mut arguments = hir.ids(call.args);
    let (Some(argument), None) = (arguments.next(), arguments.next()) else {
        return None;
    };
    let ExprKind::Number(number) = hir[argument].kind else {
        return None;
    };
    let value = hir.numbers[number as usize];
    let position = value as u32;
    (f64::from(position) == value).then_some(position)
}
