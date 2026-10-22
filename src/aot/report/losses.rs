use std::collections::BTreeMap;

use super::model::{LIMIT_REACHED, LossList, ReportedLoss, SubjectKind};
use super::positions::{Positions, is_listed_site, resolve_ascending};
use super::{ReportInput, declines};
use crate::diagnostics::SourcePosition;
use crate::engine::{
    AccessRecord, AllocationRemarkRecord, DeclineRecord, LossRecord, Position, position_of,
};
use crate::ir::generated::{
    AllocationEscapeReason, AllocationHeapCause, AllocationOutcome, CheckCause, DeclineKind,
    IllTypedCause, KnowledgeLevel, UnprovenCause,
};
use crate::ir::ids::{FunctionId, LayoutId};
use crate::link::ProgramNames;
use crate::statistics::{LimitId, LocatedLoss, Stage};

const UNKNOWN_REASON: &str = UnprovenCause::Unknown.name();

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
struct EngineLoss {
    stage: Stage,
    reason: &'static str,
    ill_typed_cause: IllTypedCause,
    limit: LimitId,
    subject_kind: SubjectKind,
    subject: Option<Position>,
    witness: Option<Position>,
    count: u64,
}

struct Site<K> {
    key: K,
    position: Option<Position>,
}

#[derive(Default)]
struct SiteGroup {
    count: u64,
    lowest_site: Option<Position>,
    index: Option<u32>,
}

impl SiteGroup {
    fn add_site(&mut self, site: Option<Position>) {
        self.count += 1;
        self.lowest_site = match (self.lowest_site, site) {
            (Some(lowest), Some(site)) => Some(lowest.min(site)),
            (lowest, site) => lowest.or(site),
        };
    }
}

struct SiteLosses {
    losses: Vec<EngineLoss>,
    loss_of_site: Vec<Option<u32>>,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct AccessLossKey {
    cause: UnprovenCause,
    ill_typed_cause: IllTypedCause,
    limit: LimitId,
    layout: Option<LayoutId>,
    witness: Option<Position>,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct AllocationLossKey {
    lowest_reason: u32,
    cause_without_reason: AllocationHeapCause,
    limit: LimitId,
    forced_by: Option<Position>,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum LimitSubject {
    Object(LayoutId),
    Function(FunctionId),
    Build,
}

pub(super) fn loss_reasons() -> Vec<&'static str> {
    let lists: [&[&'static str]; 4] = [
        &UnprovenCause::NAMES,
        &CheckCause::NAMES,
        &DeclineKind::NAMES,
        &AllocationEscapeReason::NAMES,
    ];
    let heap_causes = AllocationHeapCause::ALL
        .into_iter()
        .filter(|&cause| cause != AllocationHeapCause::None)
        .map(AllocationHeapCause::name);
    let mut reasons = Vec::new();
    for name in lists.into_iter().flatten().copied().chain(heap_causes) {
        if !reasons.contains(&name) {
            reasons.push(name);
        }
    }
    reasons
}

pub(super) fn collect_losses(input: &ReportInput<'_>, positions: &mut Positions<'_>) -> LossList {
    let mut list = LossList::default();
    add_access_losses(input, positions, &mut list);
    add_allocation_losses(input, positions, &mut list);
    add_decline_losses(input, positions, &mut list);
    add_limit_losses(input, positions, &mut list);
    add_front_end_losses(input, positions, &mut list);
    list
}

fn add_access_losses(input: &ReportInput<'_>, positions: &mut Positions<'_>, list: &mut LossList) {
    let records = input.engine.accesses();
    let site_losses = collect_access_losses(records, input.names, list.losses.len());
    add_engine_losses(&site_losses.losses, positions, list);
    list.loss_of_access = site_losses.loss_of_site;
}

fn add_allocation_losses(
    input: &ReportInput<'_>,
    positions: &mut Positions<'_>,
    list: &mut LossList,
) {
    let records = input.engine.allocation_remarks();
    let site_losses = collect_allocation_losses(records, input.names, list.losses.len());
    add_engine_losses(&site_losses.losses, positions, list);
    list.loss_of_allocation = site_losses.loss_of_site;
}

fn add_decline_losses(input: &ReportInput<'_>, positions: &mut Positions<'_>, list: &mut LossList) {
    let losses = collect_decline_losses(input.engine.declines(), input.names);
    add_engine_losses(&losses, positions, list);
}

fn add_limit_losses(input: &ReportInput<'_>, positions: &mut Positions<'_>, list: &mut LossList) {
    let losses = collect_limit_losses(input.engine.losses(), input.names);
    add_engine_losses(&losses, positions, list);
}

fn add_front_end_losses(
    input: &ReportInput<'_>,
    positions: &mut Positions<'_>,
    list: &mut LossList,
) {
    let shown_path = |path: &[u8]| positions.shown_path(path);
    let losses = input.statistics.losses().iter();
    list.losses
        .extend(losses.map(|loss| front_end_loss(loss, &shown_path)));
}

fn add_engine_losses(losses: &[EngineLoss], positions: &mut Positions<'_>, list: &mut LossList) {
    let wanted: Vec<Option<Position>> = losses
        .iter()
        .flat_map(|loss| [loss.subject, loss.witness])
        .collect();
    let shown = resolve_ascending(&wanted, |position| positions.resolve(position));
    let shown_losses = losses.iter().zip(shown.chunks_exact(2));
    list.losses.extend(shown_losses.map(|(loss, shown)| ReportedLoss {
        stage: loss.stage,
        reason: loss.reason,
        ill_typed_cause: loss.ill_typed_cause,
        limit: loss.limit,
        subject_kind: loss.subject_kind,
        subject: shown[0].clone(),
        witness: shown[1].clone(),
        count: loss.count,
    }));
}

fn collect_site_losses<R, K: Ord + Copy>(
    records: &[R],
    first_index: usize,
    site_of: impl Fn(&R) -> Option<Site<K>>,
    loss_of: impl Fn(K, &SiteGroup) -> EngineLoss,
) -> SiteLosses {
    let mut groups: BTreeMap<K, SiteGroup> = BTreeMap::new();
    for record in records {
        if let Some(site) = site_of(record) {
            groups.entry(site.key).or_default().add_site(site.position);
        }
    }
    let mut losses = Vec::with_capacity(groups.len());
    for (&key, group) in &mut groups {
        group.index = u32::try_from(first_index + losses.len()).ok();
        losses.push(loss_of(key, group));
    }
    let loss_of_site = records
        .iter()
        .map(|record| groups.get(&site_of(record)?.key)?.index)
        .collect();
    SiteLosses {
        losses,
        loss_of_site,
    }
}

fn collect_access_losses(
    records: &[AccessRecord],
    names: &ProgramNames,
    first_index: usize,
) -> SiteLosses {
    let site_of = |record: &AccessRecord| {
        let has_loss = record.level != KnowledgeLevel::Proven
            && is_listed_site(names, record.location, record.function_id());
        has_loss.then(|| Site {
            key: AccessLossKey {
                cause: record.cause,
                ill_typed_cause: record.ill_typed_cause,
                limit: record.limit,
                layout: record.layout_id(),
                witness: position_of(record.witness.location),
            },
            position: position_of(record.location),
        })
    };
    let loss_of = |key: AccessLossKey, group: &SiteGroup| {
        let (subject_kind, subject) = match key.layout {
            Some(layout) => (SubjectKind::Object, names.layout_position(layout)),
            None => (SubjectKind::Value, None),
        };
        EngineLoss {
            stage: Stage::AnalyzeFlow,
            reason: key.cause.name(),
            ill_typed_cause: key.ill_typed_cause,
            limit: key.limit,
            subject_kind,
            subject,
            witness: key.witness,
            count: group.count,
        }
    };
    collect_site_losses(records, first_index, site_of, loss_of)
}

fn collect_allocation_losses(
    records: &[AllocationRemarkRecord],
    names: &ProgramNames,
    first_index: usize,
) -> SiteLosses {
    let site_of = |record: &AllocationRemarkRecord| {
        let has_loss = record.outcome != AllocationOutcome::Removed
            && is_listed_site(names, record.location, record.function_id());
        has_loss.then(|| Site {
            key: AllocationLossKey {
                lowest_reason: lowest_reason(record.reasons).0,
                cause_without_reason: cause_without_reason(record),
                limit: record.limit,
                forced_by: position_of(record.forced_by),
            },
            position: position_of(record.location),
        })
    };
    let loss_of = |key: AllocationLossKey, group: &SiteGroup| EngineLoss {
        stage: Stage::Optimize,
        reason: allocation_reason(key),
        ill_typed_cause: IllTypedCause::None,
        limit: key.limit,
        subject_kind: SubjectKind::AllocationSite,
        subject: group.lowest_site,
        witness: key.forced_by,
        count: group.count,
    };
    collect_site_losses(records, first_index, site_of, loss_of)
}

fn collect_decline_losses(records: &[DeclineRecord], names: &ProgramNames) -> Vec<EngineLoss> {
    let mut counts: BTreeMap<(DeclineKind, LimitId, Option<Position>), u64> = BTreeMap::new();
    for record in records.iter().filter(|record| declines::is_listed(record, names)) {
        let witness = position_of(record.witness.location);
        *counts.entry((record.kind, record.limit, witness)).or_default() += 1;
    }
    let losses = counts.into_iter().map(|((kind, limit, witness), count)| EngineLoss {
        stage: Stage::Optimize,
        reason: kind.name(),
        ill_typed_cause: IllTypedCause::None,
        limit,
        subject_kind: SubjectKind::Value,
        subject: witness,
        witness,
        count,
    });
    losses.collect()
}

fn collect_limit_losses(records: &[LossRecord], names: &ProgramNames) -> Vec<EngineLoss> {
    let mut counts: BTreeMap<(LimitId, Stage, LimitSubject, Option<Position>), u64> =
        BTreeMap::new();
    for record in records {
        let subject = match (record.layout_id(), record.witness.function_id()) {
            (Some(layout), _) => LimitSubject::Object(layout),
            (None, Some(function)) => LimitSubject::Function(function),
            (None, None) => LimitSubject::Build,
        };
        let witness = position_of(record.witness.location);
        let count = counts
            .entry((record.limit, record.stage, subject, witness))
            .or_default();
        *count = count.saturating_add(u64::from(record.count));
    }
    let losses = counts.into_iter().map(|((limit, stage, subject, witness), count)| {
        let (subject_kind, subject) = match subject {
            LimitSubject::Object(layout) => (SubjectKind::Object, names.layout_position(layout)),
            LimitSubject::Function(function) => {
                (SubjectKind::Function, function_position(names, function))
            }
            LimitSubject::Build => (SubjectKind::Build, None),
        };
        EngineLoss {
            stage,
            reason: LIMIT_REACHED,
            ill_typed_cause: IllTypedCause::None,
            limit,
            subject_kind,
            subject,
            witness,
            count,
        }
    });
    losses.collect()
}

fn front_end_loss(loss: &LocatedLoss, shown_path: &dyn Fn(&[u8]) -> Vec<u8>) -> ReportedLoss {
    let subject = loss.subject.as_ref().map(|subject| SourcePosition {
        path: shown_path(&subject.path),
        line: subject.line,
        column: subject.column,
    });
    let subject_kind = match subject {
        Some(_) => SubjectKind::Value,
        None => SubjectKind::Build,
    };
    ReportedLoss {
        stage: loss.limit.stage(),
        reason: LIMIT_REACHED,
        ill_typed_cause: IllTypedCause::None,
        limit: loss.limit,
        subject_kind,
        witness: subject.clone(),
        subject,
        count: u64::from(loss.count),
    }
}

fn function_position(names: &ProgramNames, function: FunctionId) -> Option<Position> {
    let module = names.function_module(function)?;
    let (offset, _) = names.function_range(function)?;
    Some(Position { module, offset })
}

fn lowest_reason(reasons: AllocationEscapeReason) -> AllocationEscapeReason {
    AllocationEscapeReason(reasons.0 & reasons.0.wrapping_neg())
}

fn cause_without_reason(record: &AllocationRemarkRecord) -> AllocationHeapCause {
    if record.reasons.is_empty() {
        record.cause
    } else {
        AllocationHeapCause::None
    }
}

fn allocation_reason(key: AllocationLossKey) -> &'static str {
    match key.cause_without_reason {
        AllocationHeapCause::None => first_reason(AllocationEscapeReason(key.lowest_reason)),
        cause => cause.name(),
    }
}

fn first_reason(reasons: AllocationEscapeReason) -> &'static str {
    let lowest_bit = reasons.0.trailing_zeros() as usize;
    AllocationEscapeReason::NAMES
        .get(lowest_bit)
        .copied()
        .unwrap_or(UNKNOWN_REASON)
}

#[cfg(test)]
mod tests;
