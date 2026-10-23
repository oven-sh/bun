#[cfg(test)]
mod tests;

use crate::load::Sources;
use crate::load::source_provider::{Failed, SourceProvider};
use bun_ast::Log;
use bun_sema::atom::Interner;
use bun_sema::hir_from_data::DataValue;
use bun_sema::program::FileId;
use bun_sema::session::Arena;

#[derive(Default)]
pub struct DeferredData<'s> {
    values: Vec<(FileId, &'s DataValue<'s>)>,
}

impl<'s> DeferredData<'s> {
    pub fn get(&self, file: FileId) -> Option<&'s DataValue<'s>> {
        let index = self.values.binary_search_by_key(&file, |entry| entry.0);
        index.ok().map(|index| self.values[index].1)
    }
}

pub fn bundle_pages<'s>(
    sources: &Sources,
    provider: &dyn SourceProvider,
    arena: &'s Arena,
    atoms: &Interner<'s>,
    log: &mut Log,
) -> Result<DeferredData<'s>, Failed> {
    let pages = sources.pages();
    debug_assert!(pages.is_sorted_by(|a, b| a.0 < b.0));
    let paths: Vec<&[u8]> = pages.iter().map(|(_, path)| &**path).collect();
    let manifests = provider.bundle_pages(&paths, arena, atoms, log)?;
    assert_eq!(manifests.len(), pages.len(), "one manifest for each page");
    provider.check_embedded_files(log)?;
    let files = pages.iter().map(|&(file, _)| file);
    Ok(DeferredData {
        values: files.zip(manifests).collect(),
    })
}
