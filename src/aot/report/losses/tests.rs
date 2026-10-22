use super::*;
use crate::engine::TextRange;
use crate::engine::testing::ResultRecords;
use crate::ir::generated::{AccessCost, AccessKind, AllocationKind};
use crate::ir::ids::{ABSENT_WORD, Id};
use crate::link::testing::link_sources;
use crate::report::positions::PathStyle;
use crate::report::testing::{
    DEPENDENCY, LINE_1_COLUMN_5, LINE_2_COLUMN_14, LINE_3_COLUMN_1, NO_LOCATION, PROGRAM,
    PROGRAM_FUNCTION, RUNTIME, RUNTIME_FUNCTION, ReportFixture, at, location, names, witness,
};

fn access(offset: u32, cause: UnprovenCause, witness_offset: u32) -> AccessRecord {
    AccessRecord {
        location: location(PROGRAM, offset),
        kind: AccessKind::Read,
        level: KnowledgeLevel::Unknown,
        cause,
        limit: LimitId::None,
        layout: ABSENT_WORD,
        copies: 1,
        witness: witness(ABSENT_WORD, location(PROGRAM, witness_offset)),
        function: ABSENT_WORD,
        ill_typed_cause: IllTypedCause::None,
        cost: AccessCost::ByName,
    }
}

fn allocation(
    offset: u32,
    reasons: AllocationEscapeReason,
    forced_by_offset: u32,
) -> AllocationRemarkRecord {
    AllocationRemarkRecord {
        location: location(PROGRAM, offset),
        forced_by: location(PROGRAM, forced_by_offset),
        outcome: AllocationOutcome::Heap,
        copies: 1,
        forcing_operation: TextRange {
            offset: 0,
            length: 0,
        },
        reasons,
        limit: LimitId::None,
        function: ABSENT_WORD,
        kind: AllocationKind::Object,
        cause: AllocationHeapCause::None,
    }
}

fn decline(kind: DeclineKind, module: u32, offset: u32) -> DeclineRecord {
    DeclineRecord {
        kind,
        limit: LimitId::None,
        count: 0,
        reason: 0,
        witness: witness(ABSENT_WORD, location(module, offset)),
    }
}

fn limit_loss(layout: u32, function: u32, count: u32) -> LossRecord {
    LossRecord {
        limit: LimitId::MaxValueFlowEdgesLogged,
        stage: Stage::AnalyzeFlow,
        layout,
        count,
        witness: witness(function, NO_LOCATION),
    }
}

fn access_losses(records: &[AccessRecord]) -> SiteLosses {
    collect_access_losses(records, &names(), 0)
}

fn allocation_losses(records: &[AllocationRemarkRecord]) -> SiteLosses {
    collect_allocation_losses(records, &names(), 0)
}

fn access_loss(cause: UnprovenCause, witness: Option<Position>, count: u64) -> EngineLoss {
    EngineLoss {
        stage: Stage::AnalyzeFlow,
        reason: cause.name(),
        ill_typed_cause: IllTypedCause::None,
        limit: LimitId::None,
        subject_kind: SubjectKind::Value,
        subject: None,
        witness,
        count,
    }
}

#[test]
fn reasons_are_unique_and_cover_five_enums() {
    let reasons = loss_reasons();
    for (index, reason) in reasons.iter().enumerate() {
        assert!(!reasons[..index].contains(reason), "{reason}");
    }
    assert_eq!(reasons[..UnprovenCause::COUNT], UnprovenCause::NAMES);
    let lists: [&[&str]; 4] = [
        &CheckCause::NAMES,
        &DeclineKind::NAMES,
        &AllocationEscapeReason::NAMES,
        &AllocationHeapCause::NAMES[1..],
    ];
    assert_eq!(AllocationHeapCause::ALL[0], AllocationHeapCause::None);
    assert!(!reasons.contains(&AllocationHeapCause::None.name()));
    for name in lists.into_iter().flatten() {
        assert!(reasons.contains(name), "{name}");
    }
    let is_declared = |reason: &&str| {
        UnprovenCause::NAMES.contains(reason) || lists.iter().any(|list| list.contains(reason))
    };
    assert!(reasons.iter().all(is_declared));
}

#[test]
fn proven_access_has_no_loss() {
    for level in KnowledgeLevel::ALL {
        let record = AccessRecord {
            level,
            ..access(0, UnprovenCause::UnknownObject, 100)
        };
        let found = access_losses(&[record]);
        let expected_index = (level != KnowledgeLevel::Proven).then_some(0);
        assert_eq!(found.loss_of_site, [expected_index], "{level:?}");
        assert_eq!(found.losses.len(), usize::from(expected_index.is_some()), "{level:?}");
    }
}

#[test]
fn sites_with_one_cause_share_loss() {
    let records = [0, 40, 8].map(|offset| access(offset, UnprovenCause::UnknownObject, 100));
    let found = access_losses(&records);
    let shared = access_loss(UnprovenCause::UnknownObject, at(PROGRAM, 100), 3);
    assert_eq!(found.losses, [shared]);
    assert_eq!(found.loss_of_site, [Some(0); 3]);
}

#[test]
fn copies_of_access_count_once() {
    let record = AccessRecord {
        copies: 5,
        ..access(0, UnprovenCause::UnknownObject, 100)
    };
    assert_eq!(access_losses(&[record]).losses[0].count, 1);
}

#[test]
fn each_part_of_key_separates_access_losses() {
    let first = access(0, UnprovenCause::LimitReached, 100);
    let records = [
        first,
        access(0, UnprovenCause::UnknownObject, 100),
        access(0, UnprovenCause::LimitReached, 200),
        AccessRecord {
            limit: LimitId::MaxValueFlowEdgesLogged,
            ..first
        },
        AccessRecord { layout: 1, ..first },
        AccessRecord {
            ill_typed_cause: IllTypedCause::Assertion,
            ..first
        },
    ];
    let found = access_losses(&records);
    assert_eq!(found.losses.len(), records.len());
    let mut indexes = found.loss_of_site;
    indexes.sort_unstable();
    assert_eq!(indexes, [0, 1, 2, 3, 4, 5].map(Some));
}

#[test]
fn access_loss_keeps_ill_typed_cause() {
    let record = AccessRecord {
        ill_typed_cause: IllTypedCause::OutsideData,
        ..access(0, UnprovenCause::UnknownObject, 100)
    };
    let expected = EngineLoss {
        ill_typed_cause: IllTypedCause::OutsideData,
        ..access_loss(UnprovenCause::UnknownObject, at(PROGRAM, 100), 1)
    };
    assert_eq!(access_losses(&[record]).losses, [expected]);
}

#[test]
fn access_loss_is_about_layout_or_value() {
    let of_value = access(0, UnprovenCause::FieldDeleted, 100);
    let of_layout = AccessRecord {
        layout: 1,
        ..of_value
    };
    let losses = access_losses(&[of_layout, of_value]).losses;
    let kinds: Vec<SubjectKind> = losses.iter().map(|loss| loss.subject_kind).collect();
    assert_eq!(kinds, [SubjectKind::Value, SubjectKind::Object]);
}

#[test]
fn indexes_do_not_depend_on_record_order() {
    let mut records = [
        access(0, UnprovenCause::FieldDeleted, 300),
        access(4, UnprovenCause::UnknownObject, 200),
        access(8, UnprovenCause::UnknownObject, 100),
        access(12, UnprovenCause::FieldDeleted, 300),
    ];
    let ascending = access_losses(&records);
    assert_eq!(
        ascending.losses,
        [
            access_loss(UnprovenCause::UnknownObject, at(PROGRAM, 100), 1),
            access_loss(UnprovenCause::UnknownObject, at(PROGRAM, 200), 1),
            access_loss(UnprovenCause::FieldDeleted, at(PROGRAM, 300), 2),
        ]
    );
    assert_eq!(ascending.loss_of_site, [2, 1, 0, 2].map(Some));

    records.reverse();
    let descending = access_losses(&records);
    assert_eq!(descending.losses, ascending.losses);
    assert_eq!(descending.loss_of_site, [2, 0, 1, 2].map(Some));
}

#[test]
fn indexes_continue_after_earlier_losses() {
    let records = [
        access(0, UnprovenCause::UnknownObject, 100),
        access(4, UnprovenCause::UnknownObject, 200),
    ];
    let found = collect_access_losses(&records, &names(), 7);
    assert_eq!(found.loss_of_site, [Some(7), Some(8)]);
    let remarks = [allocation(0, AllocationEscapeReason::RETURNED, 100)];
    let found = collect_allocation_losses(&remarks, &names(), 3);
    assert_eq!(found.loss_of_site, [Some(3)]);
}

#[test]
fn runtime_sites_have_no_loss() {
    let in_module = |module| AccessRecord {
        location: location(module, 0),
        ..access(0, UnprovenCause::UnknownObject, 100)
    };
    let found = access_losses(&[in_module(RUNTIME), in_module(DEPENDENCY), in_module(RUNTIME)]);
    assert_eq!(found.loss_of_site, [None, Some(0), None]);
    assert_eq!(found.losses[0].count, 1);

    let remark_in = |module| AllocationRemarkRecord {
        location: location(module, 0),
        ..allocation(0, AllocationEscapeReason::RETURNED, 100)
    };
    let found = allocation_losses(&[remark_in(RUNTIME), remark_in(PROGRAM)]);
    assert_eq!(found.loss_of_site, [None, Some(0)]);
    assert_eq!(found.losses[0].count, 1);

    let declines = [
        decline(DeclineKind::HotCallNotInlined, RUNTIME, 0),
        decline(DeclineKind::HotCallNotInlined, PROGRAM, 0),
    ];
    let found = collect_decline_losses(&declines, &names());
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].witness, at(PROGRAM, 0));
}

#[test]
fn site_without_location_is_in_module_of_function() {
    let in_function = |function| AccessRecord {
        location: NO_LOCATION,
        function,
        ..access(0, UnprovenCause::UnknownObject, 100)
    };
    let records = [RUNTIME_FUNCTION, PROGRAM_FUNCTION, ABSENT_WORD].map(in_function);
    assert_eq!(access_losses(&records).loss_of_site, [None, Some(0), Some(0)]);
}

#[test]
fn witness_in_runtime_module_does_not_hide_loss() {
    let record = AccessRecord {
        witness: witness(RUNTIME_FUNCTION, location(RUNTIME, 7)),
        ..access(0, UnprovenCause::ReachesNativeCode, 0)
    };
    let expected = access_loss(UnprovenCause::ReachesNativeCode, at(RUNTIME, 7), 1);
    assert_eq!(access_losses(&[record]).losses, [expected]);
}

#[test]
fn removed_allocation_has_no_loss() {
    for outcome in AllocationOutcome::ALL {
        let record = AllocationRemarkRecord {
            outcome,
            ..allocation(0, AllocationEscapeReason::RETURNED, 100)
        };
        let expected_index = (outcome != AllocationOutcome::Removed).then_some(0);
        assert_eq!(allocation_losses(&[record]).loss_of_site, [expected_index], "{outcome:?}");
    }
}

#[test]
fn first_reason_is_lowest_bit() {
    for (bit, name) in AllocationEscapeReason::NAMES.into_iter().enumerate() {
        let higher_bits = AllocationEscapeReason::ALL.0 & (u32::MAX << bit);
        assert_eq!(first_reason(AllocationEscapeReason(1 << bit)), name);
        assert_eq!(first_reason(AllocationEscapeReason(higher_bits)), name);
        assert_eq!(lowest_reason(AllocationEscapeReason(higher_bits)).0, 1 << bit);
    }
    let reasons = AllocationEscapeReason::THROWN | AllocationEscapeReason::LIMIT_REACHED;
    assert_eq!(first_reason(reasons), "Thrown");
}

#[test]
fn allocation_without_reason_is_unknown() {
    let no_reason = AllocationEscapeReason::default();
    assert_eq!(first_reason(no_reason), "Unknown");
    assert_eq!(lowest_reason(no_reason), no_reason);
    let found = allocation_losses(&[allocation(0, no_reason, 100)]);
    assert_eq!(found.losses[0].reason, "Unknown");
    assert!(loss_reasons().contains(&found.losses[0].reason));
}

#[test]
fn allocation_without_reason_names_cause() {
    let with_cause = |offset, reasons, cause| AllocationRemarkRecord {
        cause,
        ..allocation(offset, reasons, 100)
    };
    let no_reason = AllocationEscapeReason::default();
    let records = [
        with_cause(0, no_reason, AllocationHeapCause::SeveralLiveInstances),
        with_cause(4, no_reason, AllocationHeapCause::FieldsCreatedLater),
        with_cause(8, no_reason, AllocationHeapCause::SeveralLiveInstances),
    ];
    let found = allocation_losses(&records);
    let reasons: Vec<(&str, u64)> =
        found.losses.iter().map(|loss| (loss.reason, loss.count)).collect();
    assert_eq!(reasons, [("SeveralLiveInstances", 2), ("FieldsCreatedLater", 1)]);
    assert_eq!(found.loss_of_site, [0, 1, 0].map(Some));
    assert!(reasons.iter().all(|(reason, _)| loss_reasons().contains(reason)));
}

#[test]
fn escape_reason_wins_over_cause() {
    let returned = AllocationEscapeReason::RETURNED;
    let records = [
        AllocationRemarkRecord {
            cause: AllocationHeapCause::Escapes,
            ..allocation(0, returned, 100)
        },
        AllocationRemarkRecord {
            cause: AllocationHeapCause::HeldByHeapCell,
            ..allocation(4, returned, 100)
        },
    ];
    let found = allocation_losses(&records);
    assert_eq!(found.loss_of_site, [0, 0].map(Some));
    assert_eq!(found.losses[0].reason, "Returned");
}

#[test]
fn allocations_with_one_first_reason_share_loss() {
    let returned = AllocationEscapeReason::RETURNED;
    let records = [
        allocation(40, returned | AllocationEscapeReason::THROWN, 100),
        allocation(8, returned | AllocationEscapeReason::LIMIT_REACHED, 100),
        allocation(4, AllocationEscapeReason::THROWN, 100),
        allocation(0, returned, 200),
    ];
    let loss = |reason, subject, witness, count| EngineLoss {
        stage: Stage::Optimize,
        reason,
        ill_typed_cause: IllTypedCause::None,
        limit: LimitId::None,
        subject_kind: SubjectKind::AllocationSite,
        subject,
        witness,
        count,
    };
    let found = allocation_losses(&records);
    assert_eq!(
        found.losses,
        [
            loss("Returned", at(PROGRAM, 8), at(PROGRAM, 100), 2),
            loss("Returned", at(PROGRAM, 0), at(PROGRAM, 200), 1),
            loss("Thrown", at(PROGRAM, 4), at(PROGRAM, 100), 1),
        ]
    );
    assert_eq!(found.loss_of_site, [0, 0, 2, 1].map(Some));
}

#[test]
fn limit_separates_allocation_losses() {
    let first = allocation(0, AllocationEscapeReason::LIMIT_REACHED, 100);
    let second = AllocationRemarkRecord {
        limit: LimitId::MaxEscapeAnalysisWork,
        ..first
    };
    let limits: Vec<LimitId> = allocation_losses(&[second, first, second])
        .losses
        .iter()
        .map(|loss| loss.limit)
        .collect();
    assert_eq!(limits, [LimitId::None, LimitId::MaxEscapeAnalysisWork]);
}

#[test]
fn located_site_is_subject_of_group() {
    let unlocated = AllocationRemarkRecord {
        location: NO_LOCATION,
        ..allocation(0, AllocationEscapeReason::RETURNED, 100)
    };
    let located = allocation(12, AllocationEscapeReason::RETURNED, 100);
    for records in [[unlocated, located], [located, unlocated]] {
        let found = allocation_losses(&records);
        assert_eq!(found.losses.len(), 1);
        assert_eq!(found.losses[0].subject, at(PROGRAM, 12));
        assert_eq!(found.losses[0].count, 2);
    }
    assert_eq!(allocation_losses(&[unlocated]).losses[0].subject, None);
}

#[test]
fn declines_at_one_position_share_loss() {
    let with_count = DeclineRecord {
        count: 9,
        ..decline(DeclineKind::LoopNotVersioned, PROGRAM, 30)
    };
    let records = [
        decline(DeclineKind::LoopNotVersioned, PROGRAM, 30),
        decline(DeclineKind::HotCallNotInlined, PROGRAM, 30),
        with_count,
        decline(DeclineKind::HotCallNotInlined, PROGRAM, 10),
    ];
    let loss = |kind: DeclineKind, position, count| EngineLoss {
        stage: Stage::Optimize,
        reason: kind.name(),
        ill_typed_cause: IllTypedCause::None,
        limit: LimitId::None,
        subject_kind: SubjectKind::Value,
        subject: position,
        witness: position,
        count,
    };
    assert_eq!(
        collect_decline_losses(&records, &names()),
        [
            loss(DeclineKind::HotCallNotInlined, at(PROGRAM, 10), 1),
            loss(DeclineKind::HotCallNotInlined, at(PROGRAM, 30), 1),
            loss(DeclineKind::LoopNotVersioned, at(PROGRAM, 30), 2),
        ]
    );
}

#[test]
fn limit_loss_names_unit() {
    let records = [
        limit_loss(ABSENT_WORD, ABSENT_WORD, 1),
        limit_loss(ABSENT_WORD, PROGRAM_FUNCTION, 1),
        limit_loss(1, PROGRAM_FUNCTION, 1),
    ];
    let found = collect_limit_losses(&records, &names());
    let kinds: Vec<SubjectKind> = found.iter().map(|loss| loss.subject_kind).collect();
    assert_eq!(kinds, [SubjectKind::Object, SubjectKind::Function, SubjectKind::Build]);
    for loss in found {
        assert_eq!(loss.reason, LIMIT_REACHED);
        assert_eq!(loss.ill_typed_cause, IllTypedCause::None);
        assert_eq!(loss.limit, LimitId::MaxValueFlowEdgesLogged);
        assert_eq!(loss.stage, Stage::AnalyzeFlow);
    }
}

#[test]
fn limit_losses_of_one_unit_are_summed() {
    let records = [
        limit_loss(ABSENT_WORD, PROGRAM_FUNCTION, 2),
        limit_loss(ABSENT_WORD, RUNTIME_FUNCTION, 7),
        limit_loss(ABSENT_WORD, PROGRAM_FUNCTION, u32::MAX),
    ];
    let found = collect_limit_losses(&records, &names());
    let counts: Vec<u64> = found.iter().map(|loss| loss.count).collect();
    assert_eq!(counts, [u64::from(u32::MAX) + 2, 7]);
}

#[test]
fn limit_stage_and_witness_separate_limit_losses() {
    let first = limit_loss(ABSENT_WORD, ABSENT_WORD, 1);
    let records = [
        first,
        LossRecord {
            limit: LimitId::MaxTypeNodes,
            ..first
        },
        LossRecord {
            stage: Stage::Optimize,
            ..first
        },
        LossRecord {
            witness: witness(ABSENT_WORD, location(PROGRAM, 5)),
            ..first
        },
    ];
    let found = collect_limit_losses(&records, &names());
    let keys: Vec<(LimitId, Stage, Option<Position>)> = found
        .iter()
        .map(|loss| (loss.limit, loss.stage, loss.witness))
        .collect();
    assert_eq!(
        keys,
        [
            (LimitId::MaxTypeNodes, Stage::AnalyzeFlow, None),
            (LimitId::MaxValueFlowEdgesLogged, Stage::AnalyzeFlow, None),
            (LimitId::MaxValueFlowEdgesLogged, Stage::AnalyzeFlow, at(PROGRAM, 5)),
            (LimitId::MaxValueFlowEdgesLogged, Stage::Optimize, None),
        ]
    );
}

#[test]
fn unit_without_recorded_position_has_no_subject() {
    let records = [
        limit_loss(ABSENT_WORD, PROGRAM_FUNCTION, 1),
        limit_loss(0, ABSENT_WORD, 1),
        limit_loss(99, ABSENT_WORD, 1),
        limit_loss(ABSENT_WORD, 99, 1),
    ];
    let found = collect_limit_losses(&records, &names());
    assert_eq!(found.len(), records.len());
    assert!(found.iter().all(|loss| loss.subject.is_none()));
}

#[test]
fn subjects_are_located_in_program() {
    let source = "export function Point(x) { this.x = x; }\nconsole.log(new Point(1).x);\n";
    let linked = link_sources(&[("main.js", source)]).expect("the program links");
    let (program, names) = (&linked.program, &linked.names);
    let mut functions = (0..program.functions.len()).map(FunctionId::new);
    let function = functions
        .find(|&function| names.function_name(function) == b"Point")
        .expect("the called constructor is retained");
    let mut layouts = program.layouts.iter();
    let layout = layouts.position(|layout| layout.constructor == Some(function));
    let layout = LayoutId::new(layout.expect("a retained constructor retains its layout"));
    let module = names.function_module(function).expect("a source function has a module");
    let at_offset = |offset| Some(Position { module, offset });

    let limits = [
        limit_loss(layout.to_word(), function.to_word(), 1),
        limit_loss(ABSENT_WORD, function.to_word(), 1),
    ];
    let found = collect_limit_losses(&limits, names);
    let subjects: Vec<Option<Position>> = found.iter().map(|loss| loss.subject).collect();
    assert_eq!(subjects, [at_offset(0), at_offset(7)]);

    let read = AccessRecord {
        location: location(module.to_word(), 60),
        layout: layout.to_word(),
        ..access(0, UnprovenCause::UnknownObject, 100)
    };
    let found = collect_access_losses(&[read], names, 0).losses;
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].subject_kind, SubjectKind::Object);
    assert_eq!(found[0].subject, at_offset(0));
}

#[test]
fn front_end_loss_keeps_count_and_position() {
    let loss = LocatedLoss {
        limit: LimitId::MaxTypeNodes,
        subject: Some(SourcePosition {
            path: b"/p/src/a.ts".to_vec(),
            line: 3,
            column: 9,
        }),
        count: 4,
    };
    let shown_path = |path: &[u8]| path.strip_prefix(b"/p/").expect("a path in /p").to_vec();
    let shown = Some(SourcePosition {
        path: b"src/a.ts".to_vec(),
        line: 3,
        column: 9,
    });
    let expected = ReportedLoss {
        stage: LimitId::MaxTypeNodes.stage(),
        reason: LIMIT_REACHED,
        ill_typed_cause: IllTypedCause::None,
        limit: LimitId::MaxTypeNodes,
        subject_kind: SubjectKind::Value,
        subject: shown.clone(),
        witness: shown,
        count: 4,
    };
    assert_eq!(front_end_loss(&loss, &shown_path), expected);
}

#[test]
fn front_end_loss_without_subject_is_about_build() {
    let loss = LocatedLoss {
        limit: LimitId::MaxProgramIds,
        subject: None,
        count: 1,
    };
    let expected = ReportedLoss {
        stage: LimitId::MaxProgramIds.stage(),
        reason: LIMIT_REACHED,
        ill_typed_cause: IllTypedCause::None,
        limit: LimitId::MaxProgramIds,
        subject_kind: SubjectKind::Build,
        subject: None,
        witness: None,
        count: 1,
    };
    let shown_path = |_: &[u8]| -> Vec<u8> { unreachable!("no subject, so no path") };
    assert_eq!(front_end_loss(&loss, &shown_path), expected);
}

fn shown(line: u32, column: u32) -> Option<SourcePosition> {
    Some(SourcePosition {
        path: b"src/a.ts".to_vec(),
        line,
        column,
    })
}

#[test]
fn engine_losses_are_shown_at_resolved_positions() {
    let located = EngineLoss {
        ill_typed_cause: IllTypedCause::StateChanged,
        subject_kind: SubjectKind::Object,
        subject: at(PROGRAM, LINE_1_COLUMN_5),
        ..access_loss(UnprovenCause::FieldDeleted, at(PROGRAM, LINE_2_COLUMN_14), 3)
    };
    let without_text = access_loss(UnprovenCause::ReachesNativeCode, at(RUNTIME, 0), 1);
    let mut list = LossList::default();
    ReportFixture::new(ResultRecords::default()).with_input(|input| {
        let mut positions = Positions::new(input, PathStyle::Posix);
        add_engine_losses(&[located, without_text], &mut positions, &mut list);
    });
    let reported = |loss: &EngineLoss, subject, witness| ReportedLoss {
        stage: loss.stage,
        reason: loss.reason,
        ill_typed_cause: loss.ill_typed_cause,
        limit: loss.limit,
        subject_kind: loss.subject_kind,
        subject,
        witness,
        count: loss.count,
    };
    assert_eq!(
        list.losses,
        [
            reported(&located, shown(1, 5), shown(2, 14)),
            reported(&without_text, None, None),
        ]
    );
}

#[test]
fn losses_are_listed_by_source_of_record() {
    let accesses = [
        AccessRecord {
            level: KnowledgeLevel::Proven,
            ..access(0, UnprovenCause::Unknown, 0)
        },
        access(LINE_1_COLUMN_5, UnprovenCause::UnknownObject, LINE_2_COLUMN_14),
    ];
    let remarks = [allocation(
        LINE_1_COLUMN_5,
        AllocationEscapeReason::RETURNED,
        LINE_2_COLUMN_14,
    )];
    let declines = [decline(DeclineKind::HotCallNotInlined, PROGRAM, LINE_3_COLUMN_1)];
    let limits = [limit_loss(ABSENT_WORD, ABSENT_WORD, 2)];
    let mut fixture = ReportFixture::new(ResultRecords {
        accesses: &accesses,
        allocation_remarks: &remarks,
        declines: &declines,
        losses: &limits,
        ..ResultRecords::default()
    });
    fixture.statistics.gave_up(LimitId::MaxTypeNodes, shown(3, 1));
    let list = fixture.with_input(|input| {
        collect_losses(input, &mut Positions::new(input, PathStyle::Posix))
    });

    let summaries: Vec<(Stage, &str, LimitId, u64)> = list
        .losses
        .iter()
        .map(|loss| (loss.stage, loss.reason, loss.limit, loss.count))
        .collect();
    assert_eq!(
        summaries,
        [
            (Stage::AnalyzeFlow, "UnknownObject", LimitId::None, 1),
            (Stage::Optimize, "Returned", LimitId::None, 1),
            (Stage::Optimize, "HotCallNotInlined", LimitId::None, 1),
            (Stage::AnalyzeFlow, LIMIT_REACHED, LimitId::MaxValueFlowEdgesLogged, 2),
            (LimitId::MaxTypeNodes.stage(), LIMIT_REACHED, LimitId::MaxTypeNodes, 1),
        ]
    );
    let witnesses: Vec<Option<SourcePosition>> =
        list.losses.iter().map(|loss| loss.witness.clone()).collect();
    assert_eq!(witnesses, [shown(2, 14), shown(2, 14), shown(3, 1), None, shown(3, 1)]);
    assert_eq!(list.loss_of_access, [None, Some(0)]);
    assert_eq!(list.loss_of_allocation, [Some(1)]);
}

#[test]
fn build_without_records_has_no_loss() {
    let list = ReportFixture::new(ResultRecords::default()).with_input(|input| {
        collect_losses(input, &mut Positions::new(input, PathStyle::Posix))
    });
    assert!(list.losses.is_empty());
    assert!(list.loss_of_access.is_empty());
    assert!(list.loss_of_allocation.is_empty());
}
