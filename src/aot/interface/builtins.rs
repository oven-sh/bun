use bun_sema::atom::Interner;
use bun_sema::check::aot::NamedValues;
use bun_sema::program::Files;

use crate::linked;

pub fn unlinked_named_values<'a, 's>(
    files: &'a Files<'s>,
    atoms: &Interner<'s>,
) -> Box<dyn NamedValues + 'a> {
    linked::bun_aot_unlinked_named_values(files, atoms)
}
