#[cfg(test)]
mod tests;

use super::ModuleRef;
use super::requests::{SiteForm, site_form};
use bun_sema::atom::Atom;
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::FileId;
use bun_sema::resolve::CodeFailure;
use bun_sema::util::SharedSort;
use core::ops::Range;

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct ModuleFailureId(pub u32);

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum FailureEffect {
    StopsBuild,
    ThrowsAtSite,
}

#[derive(Copy, Clone, Debug)]
pub struct ModuleFailure {
    pub kind: ModuleFailureKind,
    pub importer: FileId,
    pub site: ImportSiteKind,
    pub start: u32,
    pub end: u32,
}

#[derive(Copy, Clone, Debug)]
pub enum ModuleFailureKind {
    Unresolved {
        specifier: Atom,
        reason: CodeFailure,
    },
    /// What an `import` or `export .. from` names, in a module that only a site which can catch the failure loads.
    UnresolvedAtLoad {
        specifier: Atom,
        reason: CodeFailure,
    },
    /// The importer is a file that nothing but the way it is loaded calls a program, and that is none. The site is the statement that stands in place of its text.
    NotAProgram {
        is_loaded_at_start: bool,
    },
    ExportNotFound {
        exporter: ModuleRef,
        name: Atom,
    },
    ExportAmbiguous {
        exporter: ModuleRef,
        name: Atom,
    },
    /// A name that an ES module imports of a CommonJS module whose body may end without it. Only the run knows.
    ExportMayBeAbsent {
        exporter: ModuleRef,
        name: Atom,
    },
}

impl ModuleFailure {
    pub fn effect(&self) -> FailureEffect {
        match self.kind {
            ModuleFailureKind::Unresolved { .. } => match site_form(self.site) {
                SiteForm::Declaration => FailureEffect::StopsBuild,
                SiteForm::Load | SiteForm::Resolve | SiteForm::GetBuiltinModule => {
                    FailureEffect::ThrowsAtSite
                }
            },
            ModuleFailureKind::NotAProgram {
                is_loaded_at_start: true,
            }
            | ModuleFailureKind::ExportNotFound { .. }
            | ModuleFailureKind::ExportAmbiguous { .. } => FailureEffect::StopsBuild,
            // What throws it: the body of the module that stands in its place, the body of each module whose load it fails, the check of the graph where the imports are linked.
            ModuleFailureKind::NotAProgram {
                is_loaded_at_start: false,
            }
            | ModuleFailureKind::UnresolvedAtLoad { .. }
            | ModuleFailureKind::ExportMayBeAbsent { .. } => FailureEffect::ThrowsAtSite,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(super) enum SitePart {
    Specifier,
    Name(u32),
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(super) struct FailureOrder {
    pub site: u32,
    pub part: SitePart,
}

#[derive(Copy, Clone, Debug)]
pub(super) struct PendingFailure {
    pub order: FailureOrder,
    pub failure: ModuleFailure,
}

/// Where a module writes a specifier, or a name of another module.
#[derive(Copy, Clone, Debug)]
pub(super) struct WrittenPart {
    pub order: FailureOrder,
    pub site: ImportSiteKind,
    pub start: u32,
    pub end: u32,
}

impl WrittenPart {
    pub(super) fn new(
        site: usize,
        part: SitePart,
        kind: ImportSiteKind,
        range: Range<u32>,
    ) -> WrittenPart {
        let site = site as u32;
        WrittenPart {
            order: FailureOrder { site, part },
            site: kind,
            start: range.start,
            end: range.end,
        }
    }

    pub(super) fn fail(self, importer: FileId, kind: ModuleFailureKind) -> PendingFailure {
        let order = self.order;
        let failure = ModuleFailure {
            kind,
            importer,
            site: self.site,
            start: self.start,
            end: self.end,
        };
        PendingFailure { order, failure }
    }
}

pub(super) struct NumberedFailures {
    errors: Vec<ModuleFailure>,
    failures: Vec<ModuleFailure>,
    orders: Vec<FailureOrder>,
    first_failure_by_file: Vec<u32>,
}

impl NumberedFailures {
    pub(super) fn id_of(&self, importer: FileId, order: FailureOrder) -> ModuleFailureId {
        let first = &self.first_failure_by_file[importer.idx()..];
        let position = self.orders[first[0] as usize..first[1] as usize].binary_search(&order);
        let position = position.expect("no failure that throws was pushed under this order");
        ModuleFailureId(first[0] + position as u32)
    }

    pub(super) fn into_lists(self) -> (Vec<ModuleFailure>, Vec<ModuleFailure>) {
        (self.errors, self.failures)
    }
}

pub(super) fn number_failures(
    file_count: usize,
    mut pending: Vec<(FileId, Vec<PendingFailure>)>,
) -> NumberedFailures {
    pending.shared_sort_unstable_by_key(|(importer, _)| *importer);
    debug_assert!(pending.is_sorted_by(|a, b| a.0 < b.0));
    let mut numbered = NumberedFailures {
        errors: Vec::new(),
        failures: Vec::new(),
        orders: Vec::new(),
        first_failure_by_file: Vec::with_capacity(file_count + 1),
    };
    for (importer, mut list) in pending {
        list.shared_sort_unstable_by_key(|pending| pending.order);
        debug_assert!(list.is_sorted_by(|a, b| a.order < b.order));
        let has_importer = |pending: &PendingFailure| pending.failure.importer == importer;
        debug_assert!(list.iter().all(has_importer));
        let first_failure = numbered.failures.len() as u32;
        let firsts = &mut numbered.first_failure_by_file;
        firsts.resize(importer.idx() + 1, first_failure);
        for pending in list {
            match pending.failure.effect() {
                FailureEffect::StopsBuild => numbered.errors.push(pending.failure),
                FailureEffect::ThrowsAtSite => {
                    numbered.failures.push(pending.failure);
                    numbered.orders.push(pending.order);
                }
            }
        }
    }
    let failure_count = numbered.failures.len() as u32;
    let firsts = &mut numbered.first_failure_by_file;
    firsts.resize(file_count + 1, failure_count);
    numbered
}
