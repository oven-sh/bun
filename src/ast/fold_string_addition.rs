use crate::expr::{Data, PrimitiveType, data};
use crate::{E, Expr, StoreRef, e};
use bun_alloc::Arena; // bumpalo::Bump re-export

#[inline]
fn store_append_string(s: E::EString) -> StoreRef<E::EString> {
    data::Store::append(s)
}

/// Deep-copy the `next` chain into fresh Store nodes so mutating the result
/// can't alias an inlined-enum's string.
fn clone_rope_nodes(s: &E::EString) -> E::EString {
    let mut root = s.shallow_clone();
    if let Some(first) = root.next {
        // Clone the first link, then walk the freshly-cloned chain via
        // `StoreRef` (safe `Deref`/`DerefMut`) instead of a raw `*mut`
        // cursor. Each cloned node's `next` still points at the original
        // chain (shallow clone), so re-clone link-by-link.
        let mut tail: StoreRef<E::EString> = store_append_string(first.get().shallow_clone());
        root.next = Some(tail);
        while let Some(next) = tail.next {
            let cloned = store_append_string(next.get().shallow_clone());
            tail.next = Some(cloned);
            tail = cloned;
        }
        root.end = Some(tail);
    }
    root
}

/// Concatenate two `E::String`s, mutating BOTH inputs
/// unless `has_inlined_enum_poison` is set.
///
/// Currently inlined enum poison refers to where mutation would cause output
/// bugs due to inlined enum values sharing `E::String`s. If a new use case
/// besides inlined enums comes up to set this to true, please rename the
/// variable and document it.
fn join_strings(
    left: &E::EString,
    right: &E::EString,
    has_inlined_enum_poison: bool,
    bump: &Arena,
) -> Option<E::EString> {
    if !E::EString::can_join(&[left, right]) {
        return None;
    }

    let mut new = if has_inlined_enum_poison {
        // Inlined enums can be shared by multiple call sites. In
        // this case, we need to ensure that the ENTIRE rope is
        // cloned. In other situations, the lhs doesn't have any
        // other owner, so it is fine to mutate `lhs.data.end.next`.
        //
        // Consider the following case:
        //   const enum A {
        //     B = "a" + "b",
        //     D = B + "d",
        //   };
        //   console.log(A.B, A.D);
        clone_rope_nodes(left)
    } else {
        left.shallow_clone()
    };

    // Similarly, the right side has to be cloned for an enum rope too.
    //
    // Consider the following case:
    //   const enum A {
    //     B = "1" + "2",
    //     C = ("3" + B) + "4",
    //   };
    //   console.log(A.B, A.C);
    let mut rhs_clone = store_append_string(if has_inlined_enum_poison {
        clone_rope_nodes(right)
    } else {
        right.shallow_clone()
    });

    new.append(&mut rhs_clone, bump);
    new.prefer_template = new.prefer_template || rhs_clone.get().prefer_template;

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
                    let has_inlined_enum_poison = matches!(l.data, Data::EInlinedEnum(_))
                        || matches!(r.data, Data::EInlinedEnum(_));

                    if let Some(joined) =
                        join_strings(left.get(), right.get(), has_inlined_enum_poison, bump)
                    {
                        return Some(Expr::init(joined, lhs.loc));
                    }
                }
                // "bar" + `baz${bar}` => `barbaz${bar}`
                Data::ETemplate(right) => {
                    if let (None, e::TemplateContents::Cooked(head)) = (&right.tag, &right.head)
                        && let Some(joined) = join_strings(
                            left.get(),
                            head,
                            matches!(l.data, Data::EInlinedEnum(_)),
                            bump,
                        )
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
                        if let Some(joined) = join_strings(
                            last,
                            right.get(),
                            matches!(r.data, Data::EInlinedEnum(_)),
                            bump,
                        ) {
                            *last = joined;
                            return Some(lhs);
                        }
                    }
                    // `foo${bar}` + `a${hi}b` => `foo${bar}a${hi}b`
                    Data::ETemplate(right) => {
                        if let (None, e::TemplateContents::Cooked(right_head)) =
                            (&right.tag, &right.head)
                            && let Some(joined) = join_strings(
                                last,
                                right_head,
                                matches!(r.data, Data::EInlinedEnum(_)),
                                bump,
                            )
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
