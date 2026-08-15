use crate::expr::{Data, PrimitiveType, data};
use crate::{E, Expr, StoreRef, e};
use bun_alloc::Arena; // bumpalo::Bump re-export

// ── local rope helpers ─────────────────────────────────────────────────────
// `EString` has no `push` inherent method taking a `StoreRef` yet; provide the
// minimal surface here.

#[inline]
fn store_append_string(s: E::EString) -> StoreRef<E::EString> {
    data::Store::append(s)
}

/// Link `other` onto `lhs`'s rope tail.
fn estring_push(lhs: &mut E::EString, mut other: StoreRef<E::EString>) {
    debug_assert!(lhs.is_utf8());
    debug_assert!(other.is_utf8());

    // `other` is a freshly Store-appended node; mutate via `StoreRef::DerefMut`.
    if other.rope_len == 0 {
        other.rope_len = other.data.len() as u32;
    }
    if lhs.rope_len == 0 {
        lhs.rope_len = lhs.data.len() as u32;
    }
    lhs.rope_len += other.rope_len;

    if lhs.next.is_none() {
        lhs.next = Some(other);
        lhs.end = Some(other);
    } else {
        let mut end = lhs.end.unwrap();
        while end.get().next.is_some() {
            end = end.get().end.unwrap();
        }
        // `end` points into the live Store; rope nodes are mutated in place
        // via `StoreRef::DerefMut` (single-threaded visitor).
        end.next = Some(other);
        lhs.end = Some(other);
    }
}

/// Concatenate two `E::String`s. The rope chains of BOTH inputs are linked into
/// the result and later folds append to them in place. That is only sound
/// because a string reachable from more than one expression is always flat
/// (`can_be_const_value` rejects ropes, the enum visitor flattens member
/// values), and the one node such a string does have is copied here, never
/// mutated.
fn join_strings(left: &E::EString, right: &E::EString) -> E::EString {
    let mut new = left.shallow_clone();
    let rhs_clone = store_append_string(right.shallow_clone());

    estring_push(&mut new, rhs_clone);
    new.prefer_template = new.prefer_template || rhs_clone.get().prefer_template;

    new
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

            if left.is_utf8() {
                match rhs.data {
                    // "bar" + "baz" => "barbaz"
                    Data::EString(right) => {
                        if right.is_utf8() {
                            return Some(Expr::init(
                                join_strings(left.get(), right.get()),
                                lhs.loc,
                            ));
                        }
                    }
                    // "bar" + `baz${bar}` => `barbaz${bar}`
                    Data::ETemplate(right) => {
                        if right.head.is_utf8() {
                            return Some(Expr::init(
                                E::Template {
                                    tag: None,
                                    parts: right.parts,
                                    head: e::TemplateContents::Cooked(join_strings(
                                        left.get(),
                                        right.head.cooked(),
                                    )),
                                },
                                l.loc,
                            ));
                        }
                    }
                    _ => {
                        // other constant-foldable ast nodes would have been converted to .e_string
                    }
                }

                // "'x' + `y${z}`" => "`xy${z}`"
                if let Data::ETemplate(t) = rhs.data {
                    if t.tag.is_none() {
                        // (intentionally empty)
                    }
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

            if left.tag.is_none() {
                match rhs.data {
                    // `foo${bar}` + "baz" => `foo${bar}baz`
                    Data::EString(right) => {
                        if right.is_utf8() {
                            // Mutation of this node is fine because it will be not
                            // be shared by other places. Note that e_template will
                            // be treated by enums as strings, but will not be
                            // inlined unless they could be converted into
                            // .e_string.
                            // `parts` is `StoreSlice<T>` (arena-owned, mutable
                            // provenance) — write through `parts_mut()`.
                            if !left.parts().is_empty() {
                                let i = left.parts().len() - 1;
                                let last_tail = &left.parts()[i].tail;
                                if last_tail.is_utf8() {
                                    let new_tail = e::TemplateContents::Cooked(join_strings(
                                        last_tail.cooked(),
                                        right.get(),
                                    ));
                                    left.parts_mut()[i].tail = new_tail;
                                    return Some(lhs);
                                }
                            } else if left.head.is_utf8() {
                                let new_head = join_strings(left.head.cooked(), right.get());
                                left.head = e::TemplateContents::Cooked(new_head);
                                return Some(lhs);
                            }
                        }
                    }
                    // `foo${bar}` + `a${hi}b` => `foo${bar}a${hi}b`
                    Data::ETemplate(right) => {
                        if right.tag.is_none() && right.head.is_utf8() {
                            if !left.parts().is_empty() {
                                let i = left.parts().len() - 1;
                                let last_tail = &left.parts()[i].tail;
                                if last_tail.is_utf8() && right.head.is_utf8() {
                                    let new_tail = e::TemplateContents::Cooked(join_strings(
                                        last_tail.cooked(),
                                        right.head.cooked(),
                                    ));
                                    left.parts_mut()[i].tail = new_tail;

                                    let new_parts = if right.parts().is_empty() {
                                        left.parts
                                    } else {
                                        concat_parts(bump, left.parts(), right.parts())
                                    };
                                    left.parts = new_parts;
                                    return Some(lhs);
                                }
                            } else if left.head.is_utf8() && right.head.is_utf8() {
                                let new_head =
                                    join_strings(left.head.cooked(), right.head.cooked());
                                left.head = e::TemplateContents::Cooked(new_head);
                                left.parts = right.parts;
                                return Some(lhs);
                            }
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
