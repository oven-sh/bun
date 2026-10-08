//! What is done to a finished document before it is printed.

use super::element::{FormatElement, Interned, LineMode, Tag};
use super::formatter::Storage;
use rustc_hash::FxHashMap;

/// What encloses an element: the index of the start tag of a group, or [`BEST_FITTING`].
type Enclosing = u32;
const BEST_FITTING: Enclosing = u32::MAX;

#[derive(Default)]
pub(crate) struct PropagateBuffers {
    enclosing: Vec<Enclosing>,
    /// Whether interned content expands, by where it starts.
    checked: FxHashMap<u32, bool>,
}

/// Prettier's `propagateBreaks`: marks every group that has a hard line break, a text with a line
/// break or an [`FormatElement::ExpandParent`] in it as expanded. The variants of a
/// [`FormatElement::BestFitting`] do not make what encloses them expand.
pub(crate) fn propagate_expand(root: Interned, storage: &mut Storage, buffers: &mut PropagateBuffers) {
    buffers.enclosing.clear();
    buffers.checked.clear();
    propagate(root, storage, buffers);
}

fn propagate(range: Interned, storage: &mut Storage, buffers: &mut PropagateBuffers) -> bool {
    let mut expands = false;
    let mut indices = range.range();
    while let Some(index) = indices.next() {
        let Some(&element) = storage.pool.get(index) else {
            break;
        };
        let element_expands = match element {
            FormatElement::Skip(count) => {
                if count > 0 {
                    indices.nth(count as usize - 1);
                }
                false
            }
            FormatElement::Tag(Tag::StartGroup(_)) => {
                buffers.enclosing.push(index as u32);
                false
            }
            FormatElement::Tag(Tag::EndGroup) => match buffers.enclosing.pop() {
                Some(start) => matches!(
                    storage.pool.get(start as usize),
                    Some(FormatElement::Tag(Tag::StartGroup(group))) if !group.mode().is_flat()
                ),
                None => false,
            },
            FormatElement::Interned(interned) => match buffers.checked.get(&interned.start) {
                Some(&interned_expands) => interned_expands,
                None => {
                    let interned_expands = propagate(interned, storage, buffers);
                    buffers.checked.insert(interned.start, interned_expands);
                    interned_expands
                }
            },
            FormatElement::BestFitting(best_fitting) => {
                buffers.enclosing.push(BEST_FITTING);
                for at in best_fitting.range() {
                    if let Some(&variant) = storage.variants.get(at) {
                        propagate(variant, storage, buffers);
                    }
                }
                buffers.enclosing.pop();
                false
            }
            FormatElement::SourceText(text) | FormatElement::OwnedText(text) => {
                text.width.is_multiline()
            }
            FormatElement::ExpandParent | FormatElement::Line(LineMode::Hard | LineMode::Empty) => {
                true
            }
            _ => false,
        };

        if element_expands {
            expands = true;
            if let Some(&start) = buffers.enclosing.last()
                && let Some(FormatElement::Tag(Tag::StartGroup(group))) =
                    storage.pool.get_mut(start as usize)
            {
                group.propagate_expand();
            }
        }
    }
    expands
}
