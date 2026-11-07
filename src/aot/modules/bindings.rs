use super::failures::ModuleFailureId;
use super::plan::{ModuleRef, View};
use crate::builtins::BuiltinId;
use crate::ir::generated::{ImportPhase, ModuleRequestKind};
use bun_sema::atom::Atom;
use bun_sema::bind::SymbolId;
use bun_sema::file_analysis::FileAnalysis;
use bun_sema::hir::ExprId;
use bun_sema::import_sites::ImportSpecifier;
use bun_sema::program::Sym;

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct SyntheticExportId(pub u32);

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Holder {
    pub symbol: SymbolId,
    pub call: ExprId,
    pub view: View,
    pub is_needed_as_value: bool,
    pub copy: Option<CopiedExports>,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ShownNames {
    Own,
    OwnWithValue,
    OwnEnumerableWithValue,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct CopiedExports {
    pub written: ExprId,
    pub shows: ShownNames,
    pub passes_marked_answer_on: bool,
    pub runs_once: bool,
    pub is_of_ordinary_object: bool,
    pub has_marker: bool,
    pub may_hold_answer: bool,
    pub is_looked_at: bool,
    pub is_called_through: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct AnswerMember {
    pub holder: SymbolId,
    pub name: Option<Atom>,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct AccessedModule {
    pub module: ModuleRef,
    pub is_imported: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ImportBinding {
    Local,
    Unused,
    Unbound,
    Variable(Sym),
    Namespace {
        module: ModuleRef,
        phase: ImportPhase,
    },
    Builtin(BuiltinId),
    CapturedBuiltin {
        member: BuiltinId,
        export: SyntheticExportId,
    },
    BuiltinMember {
        holder: BuiltinId,
        name: Atom,
    },
    Synthetic(SyntheticExportId),
    NamespaceRead {
        module: ModuleRef,
        name: Atom,
    },
    Exports {
        module: ModuleRef,
    },
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ExportBinding {
    Variable(Sym),
    Synthetic(SyntheticExportId),
    Namespace {
        module: ModuleRef,
        phase: ImportPhase,
    },
    Indirect {
        module: ModuleRef,
        name: Atom,
    },
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ModuleExport {
    pub name: Atom,
    pub binding: ExportBinding,
    pub is_from_star_export: bool,
    pub can_be_ambiguous: bool,
    pub is_read_from_object: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ExportUse {
    None,
    Bound,
    ReadFromObject,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ExportLookup {
    Unknown,
    Absent,
    Found(ExportBinding),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct SyntheticExport {
    pub module: ModuleRef,
    pub name: Atom,
    pub is_known_member: bool,
    pub is_replaceable: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct ExportStatement {
    pub export_name: Atom,
    pub specifier: Atom,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct RequiredName {
    pub module: ModuleRef,
    pub name: Atom,
    pub asked_by: Option<ExportStatement>,
    pub is_found_unless_mocked: bool,
    pub drops_export_if_absent: bool,
}

impl RequiredName {
    pub fn new(module: ModuleRef, name: Atom) -> RequiredName {
        RequiredName {
            module,
            name,
            asked_by: None,
            is_found_unless_mocked: false,
            drops_export_if_absent: false,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ModuleRequest {
    pub target: ModuleRef,
    pub phase: ImportPhase,
    pub is_star_export: bool,
    pub is_dynamic_star_export: bool,
    pub kind: ModuleRequestKind,
    pub completes: bool,
    pub is_hoisted: bool,
    pub star_place: u32,
}

pub const NO_STAR_PLACE: u32 = u32::MAX;

pub(super) fn list_in_order_of_stars(requests: &[ModuleRequest]) -> Vec<ModuleRequest> {
    let stars = requests.iter();
    let mut stars: Vec<&ModuleRequest> =
        stars.filter(|it| it.star_place != NO_STAR_PLACE).collect();
    stars.sort_by_key(|it| it.star_place);
    let mut is_mentioned = vec![false; stars.len()];
    let mut listed = Vec::with_capacity(requests.len() + stars.len());
    let mut next = 0;
    for request in requests {
        if request.star_place == NO_STAR_PLACE {
            listed.push(*request);
            continue;
        }
        let rank = stars.partition_point(|it| it.star_place < request.star_place);
        is_mentioned[rank] = true;
        if rank != next {
            listed.push(ModuleRequest {
                is_star_export: false,
                is_dynamic_star_export: false,
                star_place: NO_STAR_PLACE,
                ..*request
            });
            continue;
        }
        while next < stars.len() && is_mentioned[next] {
            listed.push(*stars[next]);
            next += 1;
        }
    }
    listed
}

impl ModuleRequest {
    pub fn import(target: ModuleRef) -> ModuleRequest {
        ModuleRequest {
            target,
            phase: ImportPhase::Evaluation,
            is_star_export: false,
            is_dynamic_star_export: false,
            kind: ModuleRequestKind::Import,
            completes: true,
            is_hoisted: false,
            star_place: NO_STAR_PLACE,
        }
    }

    pub fn hoisted_import(target: ModuleRef) -> ModuleRequest {
        ModuleRequest {
            is_hoisted: true,
            ..ModuleRequest::import(target)
        }
    }

    pub fn require(target: ModuleRef, completes: bool) -> ModuleRequest {
        ModuleRequest {
            kind: ModuleRequestKind::Require,
            completes,
            ..ModuleRequest::import(target)
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct SpelledModule {
    pub spelling: Atom,
    pub module: ModuleRef,
    pub is_left_to_loader: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Candidates<'g> {
    All,
    Modules(&'g [SpelledModule]),
}

impl<'g> Candidates<'g> {
    pub fn spelled_modules(self) -> &'g [SpelledModule] {
        match self {
            Candidates::All => &[],
            Candidates::Modules(spelled_modules) => spelled_modules,
        }
    }

    pub fn hold_every_name(self, analysis: &FileAnalysis<'_>, written: &ImportSpecifier) -> bool {
        let spelled_modules = self.spelled_modules().iter();
        let mut spellings: Vec<u32> = spelled_modules.map(|it| it.spelling.0).collect();
        spellings.sort_unstable();
        let alternatives = analysis.alternatives_of(written);
        !alternatives.is_empty()
            && alternatives.iter().all(|alternative| match alternative {
                ImportSpecifier::Constant(text) => spellings.binary_search(&text.0).is_ok(),
                ImportSpecifier::Pattern { .. }
                | ImportSpecifier::OneOf(_)
                | ImportSpecifier::Unknown => false,
            })
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SiteAnswer<'g> {
    Module(ModuleRef),
    Computed(Candidates<'g>),
    Failed(ModuleFailureId),
    Erased,
}
