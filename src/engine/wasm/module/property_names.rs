//! The names of imports and exports as keys of properties.

use bun_alloc::AllocError;
use bun_engine_text::{Atom, Identifier, StringRef};
use bun_engine_wasm_format::{Module, Span};

pub(crate) struct Names {
    /// The module and the field of each.
    pub(crate) imports: Box<[(Identifier, Identifier)]>,
    pub(crate) exports: Box<[Identifier]>,
}

fn try_collect<T>(
    items: impl ExactSizeIterator<Item = Result<T, AllocError>>,
) -> Result<Box<[T]>, AllocError> {
    let mut all = Vec::new();
    all.try_reserve_exact(items.len()).map_err(|_| AllocError)?;
    for item in items {
        all.push(item?);
    }
    Ok(all.into_boxed_slice())
}

impl Names {
    pub(super) fn of(module: &Module) -> Result<Names, AllocError> {
        let name = |span: Span| -> Result<Identifier, AllocError> {
            let text = StringRef::try_from_utf8_lossy(module.bytes(span))?;
            Atom::try_from_string(&text).map(Into::into)
        };
        let (imports, exports) = (module.imports().iter(), module.exports().iter());
        Ok(Names {
            imports: try_collect(imports.map(|it| Ok((name(it.module)?, name(it.field)?))))?,
            exports: try_collect(exports.map(|it| name(it.name)))?,
        })
    }
}
