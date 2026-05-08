use bun_alloc::Arena; // bumpalo::Bump re-export
use crate::ast::{self as js_ast, e, E, Expr, StoreRef};
use crate::ast::expr::{data, Data, PrimitiveType};

// ── local rope helpers ─────────────────────────────────────────────────────
// `EString::push` / `EString::clone_rope_nodes` are still gated in E.rs
// (round-C draft); inline the minimal surface here so this file can un-gate
// without touching E.rs. These mirror the Zig bodies 1:1.

#[inline]
fn store_append_string(s: E::EString) -> StoreRef<E::EString> {
    data::Store::append(s)
}

/// Zig `E.String.push` — link `other` onto `lhs`'s rope tail.
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

/// Zig `E.String.cloneRopeNodes` — deep-copy the `next` chain into fresh
/// Store nodes so mutating the result can't alias an inlined-enum's string.
fn clone_rope_nodes(s: &E::EString) -> E::EString {
    let mut root = s.shallow_clone();
    if root.next.is_some() {
        let mut current: *mut E::EString = &raw mut root;
        let last: *mut E::EString;
        loop {
            // SAFETY: `current` is either `&mut root` (first iter) or a freshly
            // Store-appended node (subsequent iters).
            let node = unsafe { &mut *current };
            match node.next {
                Some(next) => {
                    let new_next = store_append_string(next.get().shallow_clone());
                    node.next = Some(new_next);
                    current = new_next.as_ptr();
                }
                None => {
                    last = current;
                    break;
                }
            }
        }
        // SAFETY: loop always advances past `root` (root.next was Some), so
        // `last` is a Store-owned node with stable address.
        root.end = Some(unsafe { StoreRef::from_raw(last) });
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
fn join_strings(left: &E::EString, right: &E::EString, has_inlined_enum_poison: bool) -> E::EString {
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
    let rhs_clone = store_append_string(if has_inlined_enum_poison {
        clone_rope_nodes(right)
    } else {
        right.shallow_clone()
    });

    estring_push(&mut new, rhs_clone);
    new.prefer_template = new.prefer_template || rhs_clone.get().prefer_template;

    new
}

/// `std.mem.concat(arena, E.TemplatePart, &.{a, b})` — bitwise concat into
/// the bump arena. `TemplatePart` is POD-shaped (no Drop) but not `Copy`
/// because `EString` opted out, so we go through raw `copy_nonoverlapping`.
fn concat_parts(
    bump: &Arena,
    a: &[e::TemplatePart],
    b: &[e::TemplatePart],
) -> crate::StoreSlice<e::TemplatePart> {
    let len = a.len() + b.len();
    let layout = core::alloc::Layout::array::<e::TemplatePart>(len).expect("OOM");
    // SAFETY: arena alloc + bitwise copy of POD-like elements. `alloc_layout`
    // returns a fresh `NonNull<u8>` with mutable provenance; build the slice
    // directly so writers downstream retain that provenance.
    unsafe {
        let ptr = bump.alloc_layout(layout).as_ptr().cast::<e::TemplatePart>();
        core::ptr::copy_nonoverlapping(a.as_ptr(), ptr, a.len());
        core::ptr::copy_nonoverlapping(b.as_ptr(), ptr.add(a.len()), b.len());
        crate::StoreSlice::new_mut(core::slice::from_raw_parts_mut(ptr, len))
    }
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
                            let has_inlined_enum_poison = matches!(l.data, Data::EInlinedEnum(_))
                                || matches!(r.data, Data::EInlinedEnum(_));

                            return Some(Expr::init(
                                join_strings(left.get(), right.get(), has_inlined_enum_poison),
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
                                        matches!(l.data, Data::EInlinedEnum(_)),
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
                        // (intentionally empty — matches Zig)
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
                                        matches!(r.data, Data::EInlinedEnum(_)),
                                    ));
                                    // Zig wrote `left.parts[i].tail = ...` in place.
                                    left.parts_mut()[i].tail = new_tail;
                                    return Some(lhs);
                                }
                            } else if left.head.is_utf8() {
                                let new_head = join_strings(
                                    left.head.cooked(),
                                    right.get(),
                                    matches!(r.data, Data::EInlinedEnum(_)),
                                );
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
                                        matches!(r.data, Data::EInlinedEnum(_)),
                                    ));
                                    left.parts_mut()[i].tail = new_tail;

                                    let new_parts = if right.parts().is_empty() {
                                        left.parts
                                    } else {
                                        // std.mem.concat → bump-allocated concat
                                        concat_parts(bump, left.parts(), right.parts())
                                    };
                                    left.parts = new_parts;
                                    return Some(lhs);
                                }
                            } else if left.head.is_utf8() && right.head.is_utf8() {
                                let new_head = join_strings(
                                    left.head.cooked(),
                                    right.head.cooked(),
                                    matches!(r.data, Data::EInlinedEnum(_)),
                                );
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

// silence unused-import warning when only some helpers fire
#[allow(unused_imports)]
use js_ast as _;

// ported from: src/js_parser/ast/foldStringAddition.zig
