use crate::expr::{Data, PrimitiveType, data};
use crate::{E, Expr, e};
use bun_alloc::Arena; // bumpalo::Bump re-export

/// Links both ropes into the result (see `EString::push`); sound because shared strings are never ropes.
/// `None` when a UTF-16 operand makes the join a copy over the cap (see `EString::can_join`).
fn join_strings(left: &E::EString, right: &E::EString, bump: &Arena) -> Option<E::EString> {
    if !E::EString::can_join(&[left, right]) {
        return None;
    }

    let mut new = left.shallow_clone();
    let mut rhs = data::Store::append(right.shallow_clone());

    new.append(&mut *rhs, bump);
    new.prefer_template = new.prefer_template || right.prefer_template;

    Some(new)
}

/// Concat two `TemplatePart` slices into the bump arena.
/// `TemplatePart` is POD-shaped (no Drop) but not `Copy` because
/// `EString` opted out; mirror `Template::fold`'s field-wise copy via
/// `shallow_clone` instead of raw `copy_nonoverlapping`.
fn concat_parts(
    bump: &Arena,
    a: &[e::TemplatePart],
    b: &[e::TemplatePart],
) -> crate::StoreSlice<e::TemplatePart> {
    let mut v = bun_alloc::ArenaVec::<e::TemplatePart>::with_capacity_in(a.len() + b.len(), bump);
    for p in a.iter().chain(b.iter()) {
        // Field-wise copy (all fields structurally `Copy`).
        v.push(e::TemplatePart {
            value: p.value,
            tail_loc: p.tail_loc,
            tail: p.tail.shallow_clone(),
        });
    }
    crate::StoreSlice::from_bump(v)
}

/// Transforming the left operand into a string is not safe if it comes from a
/// nested AST node.
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum FoldStringAdditionKind {
    /// "x" + "y" -> "xy"
    /// 1 + "y" -> "1y"
    Normal,
    /// a + "x" + "y" -> a + "xy"
    /// a + 1 + "y" -> a + 1 + y
    NestedLeft,
}

/// NOTE: unlike esbuild's js_ast_helpers.FoldStringAddition, this does mutate
/// the input AST in the case of rope strings
pub fn fold_string_addition(
    l: Expr,
    r: Expr,
    bump: &Arena,
    kind: FoldStringAdditionKind,
) -> Option<Expr> {
    // "See through" inline enum constants
    // TODO: implement foldAdditionPreProcess to fold some more things :)
    let mut lhs = l.unwrap_inlined();
    let mut rhs = r.unwrap_inlined();

    if kind != FoldStringAdditionKind::NestedLeft {
        // See comment on `FoldStringAdditionKind` for examples
        match rhs.data {
            Data::EString(_) | Data::ETemplate(_) => {
                if let Some(str) = lhs.to_string_expr_without_side_effects(bump) {
                    lhs = str;
                }
            }
            _ => {}
        }
    }

    match lhs.data {
        Data::EString(left) => {
            if let Some(str) = rhs.to_string_expr_without_side_effects(bump) {
                rhs = str;
            }

            match rhs.data {
                // "bar" + "baz" => "barbaz"
                Data::EString(right) => {
                    if let Some(joined) = join_strings(left.get(), right.get(), bump) {
                        return Some(Expr::init(joined, lhs.loc));
                    }
                }
                // "bar" + `baz${bar}` => `barbaz${bar}`
                Data::ETemplate(right) => {
                    if let (None, e::TemplateContents::Cooked(head)) = (&right.tag, &right.head)
                        && let Some(joined) = join_strings(left.get(), head, bump)
                    {
                        return Some(Expr::init(
                            E::Template {
                                tag: None,
                                parts: right.parts,
                                head: e::TemplateContents::Cooked(joined),
                            },
                            l.loc,
                        ));
                    }
                }
                _ => {
                    // other constant-foldable ast nodes would have been converted to .e_string
                }
            }

            if left.len() == 0 && rhs.known_primitive() == PrimitiveType::String {
                return Some(rhs);
            }

            return None;
        }

        Data::ETemplate(mut left) => {
            // "`${x}` + 0" => "`${x}` + '0'"
            if let Some(str) = rhs.to_string_expr_without_side_effects(bump) {
                rhs = str;
            }

            // Untagged: every part is cooked and unshared, so `rhs` joins onto the last one in place.
            if left.tag.is_none() {
                let last: &mut E::EString = match left.parts().len() {
                    0 => left.head.cooked_mut(),
                    n => left.parts_mut()[n - 1].tail.cooked_mut(),
                };
                match rhs.data {
                    // `foo${bar}` + "baz" => `foo${bar}baz`
                    Data::EString(right) => {
                        if let Some(joined) = join_strings(last, right.get(), bump) {
                            *last = joined;
                            return Some(lhs);
                        }
                    }
                    // `foo${bar}` + `a${hi}b` => `foo${bar}a${hi}b`
                    Data::ETemplate(right) => {
                        if let (None, e::TemplateContents::Cooked(right_head)) =
                            (&right.tag, &right.head)
                            && let Some(joined) = join_strings(last, right_head, bump)
                        {
                            *last = joined;
                            if !right.parts().is_empty() {
                                left.parts = if left.parts().is_empty() {
                                    right.parts
                                } else {
                                    concat_parts(bump, left.parts(), right.parts())
                                };
                            }
                            return Some(lhs);
                        }
                    }
                    _ => {
                        // other constant-foldable ast nodes would have been converted to .e_string
                    }
                }
            }
        }

        _ => {
            // other constant-foldable ast nodes would have been converted to .e_string
        }
    }

    if let Some(right) = rhs.data.as_e_string() {
        if right.len() == 0 && lhs.known_primitive() == PrimitiveType::String {
            return Some(lhs);
        }
    }

    None
}
