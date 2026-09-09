use core::mem::ManuallyDrop;

use crate::expr::{Data, PrimitiveType, data};
use crate::{E, Expr, StoreRef, e};
use bun_alloc::{Arena, ArenaVec};

/// Links both ropes into the result (see `EString::push`); sound because shared strings are never ropes.
fn join_strings(left: &E::EString, right: &E::EString) -> E::EString {
    let mut new = left.shallow_clone();
    let mut rhs = data::Store::append(right.shallow_clone());

    new.push(&mut *rhs);
    new.prefer_template = new.prefer_template || right.prefer_template;

    new
}

/// The template node a `+` chain folds into, and the buffer behind its `parts`.
struct Accumulator<'a> {
    node: StoreRef<E::Template>,
    /// Never freed: nodes keep their views into buffers the builder has stopped using.
    parts: ManuallyDrop<ArenaVec<'a, e::TemplatePart>>,
}

impl Accumulator<'_> {
    /// Growth reallocs: `node` must hold the only view, and `extra` must live outside the buffer.
    fn can_grow_for(&self, node: StoreRef<E::Template>, extra: &[e::TemplatePart]) -> bool {
        let view = node.parts;
        let buffer = self.parts.as_ptr();
        let buffer_end = buffer.wrapping_add(self.parts.capacity());
        core::ptr::eq(self.node.as_ptr(), node.as_ptr())
            && core::ptr::eq(buffer, view.as_ptr())
            && self.parts.len() == view.len()
            && (extra.as_ptr() >= buffer_end || extra.as_ptr().wrapping_add(extra.len()) <= buffer)
    }
}

/// Spare capacity behind `E::Template.parts`, so each template fold in a `+` chain appends, not copies.
#[derive(Default)]
pub struct TemplatePartsBuilder<'a> {
    accumulator: Option<Accumulator<'a>>,
}

impl<'a> TemplatePartsBuilder<'a> {
    /// In place for this builder's accumulator; any other template is copied once first.
    fn append(
        &mut self,
        bump: &'a Arena,
        mut template: StoreRef<E::Template>,
        extra: &[e::TemplatePart],
    ) {
        let mut accumulator = match self.accumulator.take() {
            Some(accumulator) if accumulator.can_grow_for(template, extra) => accumulator,
            _ => {
                let current = template.parts();
                let mut parts = ArenaVec::with_capacity_in(current.len() + extra.len(), bump);
                parts.extend(current.iter().map(e::TemplatePart::shallow_clone));
                Accumulator {
                    node: template,
                    parts: ManuallyDrop::new(parts),
                }
            }
        };
        accumulator
            .parts
            .extend(extra.iter().map(e::TemplatePart::shallow_clone));
        template.parts = crate::StoreSlice::new_mut(accumulator.parts.as_mut_slice());
        self.accumulator = Some(accumulator);
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
pub fn fold_string_addition<'a>(
    l: Expr,
    r: Expr,
    bump: &'a Arena,
    kind: FoldStringAdditionKind,
    template_parts: &mut TemplatePartsBuilder<'a>,
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

                                    if !right.parts().is_empty() {
                                        template_parts.append(bump, left, right.parts());
                                    }
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
