//! Makes the objects that a state only describes.

use core::ptr;

use bun_engine_vm::heap::{Allocator, DeferCollection};
use bun_engine_vm::{Gc, JsObject, Vm};
use smallvec::SmallVec;

use super::operations::allocate;
use crate::graph::{Format, Recipe};
use crate::lower::output::Held;

/// Where each object starts among the values of a state.
pub(super) type Described = SmallVec<[(usize, Recipe); 4]>;

/// # Safety
/// The shape that the header names is alive.
unsafe fn make_empty(vm: &Vm, recipe: Recipe) -> usize {
    let allocator = ptr::from_ref(vm).addr() + recipe.allocator as usize;
    // SAFETY: a part of the `Vm`, for cells that are no smaller. The slots are as many as the shape wants.
    unsafe {
        let cell = allocate(vm, &*ptr::with_exposed_provenance::<Allocator>(allocator));
        let words = ptr::with_exposed_provenance_mut::<u64>(cell);
        words.write_bytes(0, recipe.size as usize / 8);
        words.write(recipe.header);
        if recipe.out_of_line_capacity != 0 {
            let object = Gc::<JsObject>::from_address(cell);
            object.grow_slots(vm, 0, recipe.out_of_line_capacity.into());
            words.write(recipe.header);
        }
        cell
    }
}

/// Afterwards the values refer to the objects. Nothing but the values does, so the collector has to wait.
///
/// # Safety
/// All are of one state of code that is on the stack.
pub(super) unsafe fn materialize(
    vm: &Vm,
    _: &DeferCollection<'_>,
    described: &Described,
    held: &[Held],
    values: &mut [u64],
) {
    for &(start, recipe) in described {
        // SAFETY: the code keeps what it names alive while it runs.
        values[start] = unsafe { make_empty(vm, recipe) } as u64;
    }
    for (position, held) in held.iter().enumerate() {
        if held.format() == Format::Virtual {
            values[position] = values[values[position] as usize];
        }
    }
    for &(start, recipe) in described {
        let cell = values[start] as usize;
        // SAFETY: new cells, which no marker sees yet, with what the code would have stored in them.
        unsafe {
            for (offset, &word) in recipe.offsets().zip(&values[start + 1..]) {
                let base = match offset > 0 {
                    true => cell,
                    false => Gc::<JsObject>::from_address(cell).storage().address(),
                };
                let address = base.wrapping_add_signed(offset as isize);
                ptr::with_exposed_provenance_mut::<u64>(address).write(word);
            }
        }
    }
}
