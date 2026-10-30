use super::*;
use bun_sema::atom::known;
use bun_sema::hir::{ExportId, ExprId, ImportEqualsId, ImportId, StmtId};

const STATEMENT_SITES: [ImportSiteKind; 5] = [
    ImportSiteKind::JsxRuntime,
    ImportSiteKind::JsxPackage,
    ImportSiteKind::Import(ImportId(0)),
    ImportSiteKind::ExportFrom(ExportId(0)),
    ImportSiteKind::ExportStar(StmtId(0)),
];
const SITES_THAT_CAN_CATCH: [ImportSiteKind; 7] = [
    ImportSiteKind::ImportEquals(ImportEqualsId(0)),
    ImportSiteKind::ImportCall(ExprId(0)),
    ImportSiteKind::Require(ExprId(0)),
    ImportSiteKind::RequireResolve(ExprId(0)),
    ImportSiteKind::ImportMetaRequire(ExprId(0)),
    ImportSiteKind::ImportMetaResolve(ExprId(0)),
    ImportSiteKind::GetBuiltinModule(ExprId(0)),
];

const UNRESOLVED: ModuleFailureKind = ModuleFailureKind::Unresolved {
    specifier: known::default,
    reason: CodeFailure::ModuleNotFound,
};
const EXPORT_NOT_FOUND: ModuleFailureKind = ModuleFailureKind::ExportNotFound {
    exporter: ModuleRef::File(FileId(0)),
    name: known::default,
};
const EXPORT_AMBIGUOUS: ModuleFailureKind = ModuleFailureKind::ExportAmbiguous {
    exporter: ModuleRef::File(FileId(0)),
    name: known::default,
};

fn specifier_order(site: u32) -> FailureOrder {
    FailureOrder {
        site,
        part: SitePart::Specifier,
    }
}

fn name_order(site: u32, name: u32) -> FailureOrder {
    FailureOrder {
        site,
        part: SitePart::Name(name),
    }
}

fn create_failure(
    kind: ModuleFailureKind,
    importer: FileId,
    site: ImportSiteKind,
) -> ModuleFailure {
    ModuleFailure {
        kind,
        importer,
        site,
        start: 0,
        end: 0,
    }
}

fn failed_require(importer: FileId, order: FailureOrder) -> PendingFailure {
    let site = ImportSiteKind::Require(ExprId(order.site));
    let failure = create_failure(UNRESOLVED, importer, site);
    PendingFailure { order, failure }
}

fn failed_import(importer: FileId, order: FailureOrder) -> PendingFailure {
    let kind = match order.part {
        SitePart::Specifier => UNRESOLVED,
        SitePart::Name(_) => EXPORT_NOT_FOUND,
    };
    let site = ImportSiteKind::Import(ImportId(order.site));
    let failure = create_failure(kind, importer, site);
    PendingFailure { order, failure }
}

fn pending_list(
    importer: u32,
    orders: &[FailureOrder],
    create: fn(FileId, FailureOrder) -> PendingFailure,
) -> (FileId, Vec<PendingFailure>) {
    let importer = FileId(importer);
    let list = orders.iter().map(|&order| create(importer, order));
    (importer, list.collect())
}

fn sites_of(failures: &[ModuleFailure]) -> Vec<(FileId, u32)> {
    let site_number = |failure: &ModuleFailure| match failure.site {
        ImportSiteKind::Import(ImportId(site)) | ImportSiteKind::Require(ExprId(site)) => site,
        site => panic!("{site:?} is not a site of these tests"),
    };
    let failures = failures.iter();
    failures
        .map(|failure| (failure.importer, site_number(failure)))
        .collect()
}

#[test]
fn file_that_is_no_program_stops_build_only_where_it_is_loaded_at_start() {
    let site = ImportSiteKind::ExportFrom(ExportId(0));
    let effect_where = |is_loaded_at_start: bool| {
        let kind = ModuleFailureKind::NotAProgram { is_loaded_at_start };
        create_failure(kind, FileId(0), site).effect()
    };
    assert_eq!(effect_where(true), FailureEffect::StopsBuild);
    assert_eq!(effect_where(false), FailureEffect::ThrowsAtSite);
}

#[test]
fn ids_ascend_by_importer_site_and_name() {
    let shuffled_orders = [
        name_order(1, 2),
        specifier_order(0),
        name_order(1, 0),
        specifier_order(1),
        name_order(1, 1),
    ];
    let shuffled_importers = vec![
        pending_list(4, &[specifier_order(0)], failed_require),
        pending_list(1, &shuffled_orders, failed_require),
        pending_list(2, &[name_order(3, 0), specifier_order(3)], failed_require),
    ];
    let numbered = number_failures(6, shuffled_importers);
    let expected = [
        (FileId(1), specifier_order(0)),
        (FileId(1), specifier_order(1)),
        (FileId(1), name_order(1, 0)),
        (FileId(1), name_order(1, 1)),
        (FileId(1), name_order(1, 2)),
        (FileId(2), specifier_order(3)),
        (FileId(2), name_order(3, 0)),
        (FileId(4), specifier_order(0)),
    ];
    let importers = numbered.failures.iter().map(|failure| failure.importer);
    let numbered_orders: Vec<_> = importers.zip(numbered.orders.iter().copied()).collect();
    assert_eq!(numbered_orders, expected);
    for (id, (importer, order)) in (0..).map(ModuleFailureId).zip(expected) {
        assert_eq!(numbered.id_of(importer, order), id);
    }
    let (errors, failures) = numbered.into_lists();
    assert!(errors.is_empty());
    assert_eq!(failures.len(), expected.len());
}

#[test]
#[should_panic(expected = "no failure that throws was pushed under this order")]
fn id_of_panics_for_unknown_order() {
    let pending = vec![pending_list(1, &[specifier_order(0)], failed_require)];
    let numbered = number_failures(3, pending);
    numbered.id_of(FileId(2), specifier_order(0));
}

#[test]
#[should_panic(expected = "no failure that throws was pushed under this order")]
fn id_of_panics_for_build_error() {
    let pending = vec![pending_list(1, &[specifier_order(0)], failed_import)];
    let numbered = number_failures(3, pending);
    numbered.id_of(FileId(1), specifier_order(0));
}

#[test]
fn statement_failures_are_errors_in_order() {
    let shuffled_importers = vec![
        pending_list(3, &[name_order(0, 1), name_order(0, 0)], failed_import),
        pending_list(
            0,
            &[specifier_order(2), name_order(1, 4), specifier_order(0)],
            failed_import,
        ),
    ];
    let (errors, failures) = number_failures(4, shuffled_importers).into_lists();
    assert!(failures.is_empty());
    let expected = [
        (FileId(0), 0),
        (FileId(0), 1),
        (FileId(0), 2),
        (FileId(3), 0),
        (FileId(3), 0),
    ];
    assert_eq!(sites_of(&errors), expected);
    let is_unresolved =
        |error: &ModuleFailure| matches!(error.kind, ModuleFailureKind::Unresolved { .. });
    let unresolved: Vec<bool> = errors.iter().map(is_unresolved).collect();
    assert_eq!(unresolved, [true, false, true, false, false]);
}

#[test]
fn errors_take_no_ids() {
    let first = FileId(0);
    let first_list = vec![
        failed_require(first, specifier_order(3)),
        failed_import(first, name_order(2, 0)),
        failed_require(first, specifier_order(1)),
        failed_import(first, specifier_order(0)),
    ];
    let only_errors = pending_list(1, &[specifier_order(0)], failed_import);
    let last = pending_list(2, &[specifier_order(0)], failed_require);
    let numbered = number_failures(3, vec![last, (first, first_list), only_errors]);
    let thrown = [(first, 1), (first, 3), (FileId(2), 0)];
    for (id, (importer, site)) in (0..).map(ModuleFailureId).zip(thrown) {
        assert_eq!(numbered.id_of(importer, specifier_order(site)), id);
    }
    let (errors, failures) = numbered.into_lists();
    assert_eq!(sites_of(&errors), [(first, 0), (first, 2), (FileId(1), 0)]);
    assert_eq!(sites_of(&failures), thrown);
}

#[test]
fn program_without_failures_has_empty_lists() {
    let (errors, failures) = number_failures(2, vec![(FileId(1), Vec::new())]).into_lists();
    assert!(errors.is_empty());
    assert!(failures.is_empty());
}

#[test]
fn effect_of_every_site_kind() {
    let stops = STATEMENT_SITES.map(|site| (site, FailureEffect::StopsBuild));
    let throws = SITES_THAT_CAN_CATCH.map(|site| (site, FailureEffect::ThrowsAtSite));
    for (site, expected) in stops.into_iter().chain(throws) {
        let failure = create_failure(UNRESOLVED, FileId(0), site);
        assert_eq!(failure.effect(), expected, "{site:?}");
    }
}

#[test]
fn name_failures_always_stop() {
    for site in STATEMENT_SITES.into_iter().chain(SITES_THAT_CAN_CATCH) {
        for kind in [EXPORT_NOT_FOUND, EXPORT_AMBIGUOUS] {
            let failure = create_failure(kind, FileId(0), site);
            assert_eq!(failure.effect(), FailureEffect::StopsBuild, "{failure:?}");
        }
    }
}
