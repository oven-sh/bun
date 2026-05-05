use bun_alloc::Arena; // bumpalo::Bump re-export
use crate::ast::{self as js_ast, e, E, Expr};

// TODO(b2-ast-D): bodies depend on gated E::String rope methods (clone_rope_nodes/push/append),
// data::Store::append_string, e::TemplateContents construction (enum, not struct), Expr::init_template.
// Type def `FoldStringAdditionKind` is real; fn bodies gated.
#[cfg(any())]
/// Concatenate two `E::String`s, mutating BOTH inputs
/// unless `has_inlined_enum_poison` is set.
///
/// Currently inlined enum poison refers to where mutation would cause output
/// bugs due to inlined enum values sharing `E::String`s. If a new use case
/// besides inlined enums comes up to set this to true, please rename the
/// variable and document it.
fn join_strings(left: &E::String, right: &E::String, has_inlined_enum_poison: bool) -> E::String {
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
        left.clone_rope_nodes()
    } else {
        *left
    };

    // Similarly, the right side has to be cloned for an enum rope too.
    //
    // Consider the following case:
    //   const enum A {
    //     B = "1" + "2",
    //     C = ("3" + B) + "4",
    //   };
    //   console.log(A.B, A.C);
    // TODO(port): Expr::Data::Store is a typed_arena::Arena<E::String>; `append` returns &'arena mut E::String
    let rhs_clone = js_ast::expr::data::Store::append_string(if has_inlined_enum_poison {
        right.clone_rope_nodes()
    } else {
        *right
    });

    new.push(rhs_clone);
    new.prefer_template = new.prefer_template || rhs_clone.prefer_template;

    new
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
pub fn fold_string_addition<'bump>(
    l: Expr,
    r: Expr,
    bump: &'bump Arena,
    kind: FoldStringAdditionKind,
) -> Option<Expr> {
    #[cfg(any())] // TODO(b2-ast-D): see file-top note
    {
    // "See through" inline enum constants
    // TODO: implement foldAdditionPreProcess to fold some more things :)
    let mut lhs = l.unwrap_inlined();
    let mut rhs = r.unwrap_inlined();

    if kind != FoldStringAdditionKind::NestedLeft {
        // See comment on `FoldStringAdditionKind` for examples
        match &rhs.data {
            js_ast::expr::Data::EString(_) | js_ast::expr::Data::ETemplate(_) => {
                if let Some(str) = lhs.to_string_expr_without_side_effects(bump) {
                    lhs = str;
                }
            }
            _ => {}
        }
    }

    match &lhs.data {
        js_ast::expr::Data::EString(left) => {
            if let Some(str) = rhs.to_string_expr_without_side_effects(bump) {
                rhs = str;
            }

            if left.is_utf8() {
                match &rhs.data {
                    // "bar" + "baz" => "barbaz"
                    js_ast::expr::Data::EString(right) => {
                        if right.is_utf8() {
                            let has_inlined_enum_poison =
                                matches!(l.data, js_ast::expr::Data::EInlinedEnum(_))
                                    || matches!(r.data, js_ast::expr::Data::EInlinedEnum(_));

                            return Some(Expr::init_string(
                                join_strings(left, right, has_inlined_enum_poison),
                                lhs.loc,
                            ));
                        }
                    }
                    // "bar" + `baz${bar}` => `barbaz${bar}`
                    js_ast::expr::Data::ETemplate(right) => {
                        if right.head.is_utf8() {
                            return Some(Expr::init_template(
                                E::Template {
                                    parts: right.parts,
                                    head: e::TemplateContents {
                                        cooked: join_strings(
                                            left,
                                            &right.head.cooked,
                                            matches!(l.data, js_ast::expr::Data::EInlinedEnum(_)),
                                        ),
                                    },
                                    // TODO(port): remaining E::Template fields (tag, etc.)
                                    ..Default::default()
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
                if let js_ast::expr::Data::ETemplate(t) = &rhs.data {
                    if t.tag.is_none() {
                        // (intentionally empty — matches Zig)
                    }
                }
            }

            if left.len() == 0 && rhs.known_primitive() == js_ast::expr::PrimitiveType::String {
                return Some(rhs);
            }

            return None;
        }

        js_ast::expr::Data::ETemplate(left) => {
            // "`${x}` + 0" => "`${x}` + '0'"
            if let Some(str) = rhs.to_string_expr_without_side_effects(bump) {
                rhs = str;
            }

            if left.tag.is_none() {
                match &rhs.data {
                    // `foo${bar}` + "baz" => `foo${bar}baz`
                    js_ast::expr::Data::EString(right) => {
                        if right.is_utf8() {
                            // Mutation of this node is fine because it will be not
                            // be shared by other places. Note that e_template will
                            // be treated by enums as strings, but will not be
                            // inlined unless they could be converted into
                            // .e_string.
                            // PORT NOTE: reshaped for borrowck — captured len before mutable indexing
                            if !left.parts.is_empty() {
                                let i = left.parts.len() - 1;
                                let last = &left.parts[i];
                                if last.tail.is_utf8() {
                                    left.parts[i].tail = e::TemplateContents {
                                        cooked: join_strings(
                                            &last.tail.cooked,
                                            right,
                                            matches!(r.data, js_ast::expr::Data::EInlinedEnum(_)),
                                        ),
                                    };
                                    return Some(lhs);
                                }
                            } else {
                                if left.head.is_utf8() {
                                    left.head = e::TemplateContents {
                                        cooked: join_strings(
                                            &left.head.cooked,
                                            right,
                                            matches!(r.data, js_ast::expr::Data::EInlinedEnum(_)),
                                        ),
                                    };
                                    return Some(lhs);
                                }
                            }
                        }
                    }
                    // `foo${bar}` + `a${hi}b` => `foo${bar}a${hi}b`
                    js_ast::expr::Data::ETemplate(right) => {
                        if right.tag.is_none() && right.head.is_utf8() {
                            if !left.parts.is_empty() {
                                let i = left.parts.len() - 1;
                                let last = &left.parts[i];
                                if last.tail.is_utf8() && right.head.is_utf8() {
                                    left.parts[i].tail = e::TemplateContents {
                                        cooked: join_strings(
                                            &last.tail.cooked,
                                            &right.head.cooked,
                                            matches!(r.data, js_ast::expr::Data::EInlinedEnum(_)),
                                        ),
                                    };

                                    left.parts = if right.parts.is_empty() {
                                        left.parts
                                    } else {
                                        // std.mem.concat → bump-allocated concat
                                        // PERF(port): was arena bulk-free — profile in Phase B
                                        let mut v = bumpalo::collections::Vec::with_capacity_in(
                                            left.parts.len() + right.parts.len(),
                                            bump,
                                        );
                                        v.extend_from_slice(left.parts);
                                        v.extend_from_slice(right.parts);
                                        v.into_bump_slice()
                                    };
                                    return Some(lhs);
                                }
                            } else {
                                if left.head.is_utf8() && right.head.is_utf8() {
                                    left.head = e::TemplateContents {
                                        cooked: join_strings(
                                            &left.head.cooked,
                                            &right.head.cooked,
                                            matches!(r.data, js_ast::expr::Data::EInlinedEnum(_)),
                                        ),
                                    };
                                    left.parts = right.parts;
                                    return Some(lhs);
                                }
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
        if right.len() == 0 && lhs.known_primitive() == js_ast::expr::PrimitiveType::String {
            return Some(lhs);
        }
    }

    return None;
    } // end #[cfg(any())]
    let _ = (l, r, bump, kind);
    todo!("b2-ast-D: fold_string_addition body")
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/foldStringAddition.zig (233 lines)
//   confidence: medium
//   todos:      3
//   notes:      Expr.Data variant payloads are arena pointers (mutated in place); exact enum/Store/TemplateString shapes need Phase B alignment with bun_js_parser AST types. Borrowck reshaping needed around `left`/`rhs` overlapping borrows.
// ──────────────────────────────────────────────────────────────────────────
