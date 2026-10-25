#[cfg(test)]
mod limit_values;

use core::time::Duration;
use std::time::Instant;

#[cfg(not(test))]
use bun_aot_interface::statistics::limit_values;
use bun_core::current_work::{self, set_step_of_build};
use bun_sema::check::aot::QueryStatistics;

pub use self::limit_values::{HOST_ARCHITECTURE, LimitValues, can_be_lowered, fails_build};
use crate::diagnostics::{ProgramView, SourcePosition, Span, SpanLocator};
pub use crate::ir::generated::{Architecture, DegradesTo, LimitId, Stage, StatisticId};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Loss {
    pub limit: LimitId,
    pub subject: Option<Span>,
    pub count: u32,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct LocatedLoss {
    pub limit: LimitId,
    pub subject: Option<SourcePosition>,
    pub count: u32,
}

fn is_lower_subject<T: Ord>(candidate: &Option<T>, current: &Option<T>) -> bool {
    match (candidate, current) {
        (Some(candidate), Some(current)) => candidate < current,
        (Some(_), None) => true,
        (None, Some(_) | None) => false,
    }
}

#[derive(Default, Clone, Debug)]
pub struct Counters {
    counts: Vec<(StatisticId, u64)>,
    losses: Vec<Loss>,
}

impl Counters {
    pub fn count(&mut self, id: StatisticId, amount: u64) {
        if id == StatisticId::None || amount == 0 {
            return;
        }
        match self.counts.iter_mut().find(|(counted, _)| *counted == id) {
            Some((_, total)) => *total = total.saturating_add(amount),
            None => self.counts.push((id, amount)),
        }
    }

    pub fn gave_up(&mut self, limit: LimitId, subject: Option<Span>) {
        self.add_loss(Loss {
            limit,
            subject,
            count: 1,
        });
    }

    pub fn exceeds(
        &mut self,
        limits: &LimitValues,
        limit: LimitId,
        amount: u64,
        subject: Option<Span>,
    ) -> bool {
        let is_exceeded = amount > limits.get(limit);
        if is_exceeded {
            self.gave_up(limit, subject);
        }
        is_exceeded
    }

    pub fn merge(&mut self, other: Counters) {
        for (id, amount) in other.counts {
            self.count(id, amount);
        }
        for loss in other.losses {
            self.add_loss(loss);
        }
    }

    pub fn counts(&self) -> &[(StatisticId, u64)] {
        &self.counts
    }

    pub fn losses(&self) -> &[Loss] {
        &self.losses
    }

    fn add_loss(&mut self, loss: Loss) {
        debug_assert!(loss.limit != LimitId::None);
        match self
            .losses
            .iter_mut()
            .find(|known| known.limit == loss.limit)
        {
            Some(known) => {
                known.count = known.count.saturating_add(loss.count);
                if is_lower_subject(&loss.subject, &known.subject) {
                    known.subject = loss.subject;
                }
            }
            None => self.losses.push(loss),
        }
    }
}

#[derive(Clone, Debug)]
pub struct Statistics {
    values: Box<[u64]>,
    losses: Vec<LocatedLoss>,
}

impl Default for Statistics {
    fn default() -> Statistics {
        Statistics {
            values: vec![0; StatisticId::COUNT].into_boxed_slice(),
            losses: Vec::new(),
        }
    }
}

impl Statistics {
    pub fn get(&self, id: StatisticId) -> u64 {
        self.values[id as usize]
    }

    pub fn values(&self) -> &[u64] {
        &self.values
    }

    pub fn losses(&self) -> &[LocatedLoss] {
        &self.losses
    }

    pub fn count(&mut self, id: StatisticId, amount: u64) {
        if id != StatisticId::None {
            let total = &mut self.values[id as usize];
            *total = total.saturating_add(amount);
        }
    }

    pub fn add_time(&mut self, stage: Stage, time: Duration) {
        let nanoseconds = u64::try_from(time.as_nanos()).unwrap_or(u64::MAX);
        self.count(stage.time(), nanoseconds);
    }

    pub fn add_values(&mut self, values: &[u64]) {
        debug_assert_eq!(values.len(), self.values.len());
        for (total, &amount) in self.values.iter_mut().zip(values) {
            *total = total.saturating_add(amount);
        }
    }

    pub fn add_queries(&mut self, queries: QueryStatistics) {
        let sum = |counts: &[u32]| counts.iter().map(|&count| u64::from(count)).sum::<u64>();
        self.count(StatisticId::CheckerQueries, queries.asked);
        self.count(StatisticId::CheckerQueriesGivenUp, sum(&queries.gave_up));
        self.count(
            StatisticId::CheckerMembersGivenUp,
            sum(&queries.members_gave_up),
        );
    }

    pub(crate) fn add_counters(&mut self, view: ProgramView<'_, '_>, counters: Counters) {
        let mut locator = SpanLocator::new(view);
        for (id, amount) in counters.counts {
            self.count(id, amount);
        }
        for loss in counters.losses {
            self.add_loss(LocatedLoss {
                limit: loss.limit,
                subject: loss.subject.map(|span| locator.position_of(span)),
                count: loss.count,
            });
        }
    }

    pub fn gave_up(&mut self, limit: LimitId, subject: Option<SourcePosition>) {
        self.add_loss(LocatedLoss {
            limit,
            subject,
            count: 1,
        });
    }

    fn add_loss(&mut self, loss: LocatedLoss) {
        debug_assert!(loss.limit != LimitId::None);
        self.count(loss.limit.hits(), u64::from(loss.count));
        let position = self
            .losses
            .binary_search_by_key(&loss.limit, |known| known.limit);
        match position {
            Ok(index) => {
                let known = &mut self.losses[index];
                known.count = known.count.saturating_add(loss.count);
                if is_lower_subject(&loss.subject, &known.subject) {
                    known.subject = loss.subject;
                }
            }
            Err(index) => self.losses.insert(index, loss),
        }
    }
}

pub struct StageClock {
    times: [Duration; Stage::COUNT],
    running: Option<(Stage, Instant)>,
}

impl StageClock {
    pub fn new() -> StageClock {
        StageClock {
            times: [Duration::ZERO; Stage::COUNT],
            running: None,
        }
    }

    pub fn start(&mut self, stage: Stage) {
        self.stop();
        self.running = Some((stage, Instant::now()));
        set_step_of_build(match stage {
            Stage::Load => Some(current_work::Step::Load),
            Stage::BindModules => Some(current_work::Step::BindModules),
            Stage::Check => Some(current_work::Step::Check),
            Stage::Lower => Some(current_work::Step::Lower),
            Stage::LinkAndEmit => Some(current_work::Step::LinkAndEmit),
            _ => None,
        });
    }

    pub fn stop(&mut self) {
        if let Some((stage, started)) = self.running.take() {
            self.times[stage as usize] += started.elapsed();
            set_step_of_build(None);
        }
    }

    pub fn time_of(&self, stage: Stage) -> Duration {
        self.times[stage as usize]
    }

    pub fn add_to(mut self, statistics: &mut Statistics) {
        self.stop();
        for stage in Stage::ALL {
            statistics.add_time(stage, self.time_of(stage));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compile::testing::with_project_view;
    use bun_sema::program::FileId;

    fn span(file: u32, start: u32) -> Option<Span> {
        Some(Span {
            file: FileId(file),
            start,
            end: start + 1,
        })
    }

    fn position(path: &str, line: u32) -> Option<SourcePosition> {
        Some(SourcePosition {
            path: path.as_bytes().to_vec(),
            line,
            column: 1,
        })
    }

    fn wait_for_clock_tick() {
        let started = Instant::now();
        while started.elapsed().is_zero() {
            core::hint::spin_loop();
        }
    }

    #[test]
    fn limit_values_start_from_registry() {
        for architecture in [Architecture::ARM64, Architecture::X86_64] {
            let limits = LimitValues::for_target(architecture);
            for limit in LimitId::ALL {
                assert_eq!(limits.get(limit), limit.value(architecture), "{limit:?}");
            }
        }
        assert_eq!(
            LimitValues::for_host(),
            LimitValues::for_target(HOST_ARCHITECTURE)
        );
    }

    #[test]
    fn lowering_changes_one_limit() {
        let mut limits = LimitValues::for_host();
        limits.lower(LimitId::MaxTypeNodes, 1);
        for limit in LimitId::ALL {
            let expected = if limit == LimitId::MaxTypeNodes {
                1
            } else {
                limit.value(HOST_ARCHITECTURE)
            };
            assert_eq!(limits.get(limit), expected, "{limit:?}");
        }
    }

    #[test]
    #[should_panic(expected = "MaxTypeNodes")]
    fn raising_limit_panics() {
        let mut limits = LimitValues::for_host();
        let value = limits.get(LimitId::MaxTypeNodes);
        limits.lower(LimitId::MaxTypeNodes, value + 1);
    }

    #[test]
    fn build_error_limit_cannot_be_lowered() {
        assert!(fails_build(LimitId::MaxProgramIds));
        assert!(!can_be_lowered(LimitId::MaxProgramIds));
        assert!(!can_be_lowered(LimitId::None));
        assert!(can_be_lowered(LimitId::MaxTypeNodes));
    }

    #[test]
    fn exceeds_compares_and_gives_up() {
        let mut limits = LimitValues::for_host();
        limits.lower(LimitId::MaxTypeNodes, 2);
        let mut counters = Counters::default();
        assert!(!counters.exceeds(&limits, LimitId::MaxTypeNodes, 2, span(0, 1)));
        assert!(counters.losses().is_empty());
        assert!(counters.exceeds(&limits, LimitId::MaxTypeNodes, 3, span(0, 1)));
        assert_eq!(counters.losses().len(), 1);
    }

    #[test]
    fn counters_keep_lowest_subject_per_limit() {
        let mut counters = Counters::default();
        counters.gave_up(LimitId::MaxTypeNodes, None);
        counters.gave_up(LimitId::MaxTypeNodes, span(1, 9));
        counters.gave_up(LimitId::MaxTypeNodes, span(1, 4));
        counters.gave_up(LimitId::MaxTypeNodes, span(2, 0));
        counters.gave_up(LimitId::MaxNestingDepth, None);
        let expected = [
            Loss {
                limit: LimitId::MaxTypeNodes,
                subject: span(1, 4),
                count: 4,
            },
            Loss {
                limit: LimitId::MaxNestingDepth,
                subject: None,
                count: 1,
            },
        ];
        assert_eq!(counters.losses(), expected);
    }

    #[test]
    fn merged_counters_do_not_depend_on_order() {
        let mut first = Counters::default();
        first.gave_up(LimitId::MaxTypeNodes, span(3, 0));
        first.count(StatisticId::FunctionsLowered, 2);
        let mut second = Counters::default();
        second.gave_up(LimitId::MaxTypeNodes, span(1, 0));
        second.count(StatisticId::FunctionsLowered, 5);

        let mut forward = first.clone();
        forward.merge(second.clone());
        let mut backward = second;
        backward.merge(first);
        assert_eq!(forward.losses(), backward.losses());
        assert_eq!(forward.counts(), [(StatisticId::FunctionsLowered, 7)]);
        assert_eq!(backward.counts(), forward.counts());
    }

    #[test]
    fn zero_and_none_are_not_counted() {
        let mut counters = Counters::default();
        counters.count(StatisticId::None, 3);
        counters.count(StatisticId::FunctionsLowered, 0);
        assert!(counters.counts().is_empty());
        let mut statistics = Statistics::default();
        statistics.count(StatisticId::None, 3);
        assert!(statistics.values().iter().all(|&value| value == 0));
    }

    #[test]
    fn giving_up_counts_hit() {
        let mut statistics = Statistics::default();
        statistics.gave_up(LimitId::MaxDataNodes, position("b.json", 1));
        statistics.gave_up(LimitId::MaxDataNodes, position("a.json", 7));
        statistics.gave_up(LimitId::MaxDataNodes, None);
        assert_eq!(statistics.get(LimitId::MaxDataNodes.hits()), 3);
        let expected = [LocatedLoss {
            limit: LimitId::MaxDataNodes,
            subject: position("a.json", 7),
            count: 3,
        }];
        assert_eq!(statistics.losses(), expected);
    }

    #[test]
    fn added_counters_are_counted_and_located() {
        let statistics = with_project_view(&[("main.ts", "let a;\nlet b;\n")], |view| {
            let file = view.files().entry_points()[0];
            let mut counters = Counters::default();
            counters.count(StatisticId::FunctionsLowered, 2);
            counters.gave_up(LimitId::MaxTypeNodes, None);
            counters.gave_up(LimitId::MaxTypeNodes, span(file.0, 11));
            counters.gave_up(LimitId::MaxNestingDepth, None);
            let mut statistics = Statistics::default();
            statistics.add_counters(view, counters);
            statistics
        });
        assert_eq!(statistics.get(StatisticId::FunctionsLowered), 2);
        assert_eq!(statistics.get(LimitId::MaxTypeNodes.hits()), 2);
        assert_eq!(statistics.get(LimitId::MaxNestingDepth.hits()), 1);
        let [unlocated, located] = statistics.losses() else {
            panic!("{:?}", statistics.losses());
        };
        assert_eq!(unlocated.limit, LimitId::MaxNestingDepth);
        assert_eq!(unlocated.subject, None);
        assert_eq!((located.limit, located.count), (LimitId::MaxTypeNodes, 2));
        let subject = located.subject.as_ref().expect("a span has a position");
        assert!(subject.path.ends_with(b"main.ts"));
        assert_eq!((subject.line, subject.column), (2, 5));
    }

    #[test]
    fn losses_ascend_by_limit() {
        let mut statistics = Statistics::default();
        statistics.gave_up(LimitId::MaxTypeNodes, None);
        statistics.gave_up(LimitId::MaxFoldedStringBytes, None);
        statistics.gave_up(LimitId::MaxNestingDepth, None);
        let limits = statistics.losses().iter().map(|loss| loss.limit as u32);
        assert!(limits.is_sorted_by(|a, b| a < b));
    }

    #[test]
    fn counts_saturate() {
        let mut statistics = Statistics::default();
        statistics.count(StatisticId::SourceBytes, u64::MAX);
        statistics.count(StatisticId::SourceBytes, 1);
        assert_eq!(statistics.get(StatisticId::SourceBytes), u64::MAX);
    }

    #[test]
    fn engine_values_are_added() {
        let mut statistics = Statistics::default();
        statistics.count(StatisticId::TypesInterned, 2);
        let mut values = vec![0; StatisticId::COUNT];
        values[StatisticId::TypesInterned as usize] = 40;
        statistics.add_values(&values);
        assert_eq!(statistics.get(StatisticId::TypesInterned), 42);
    }

    #[test]
    fn queries_are_summed_over_reasons() {
        let mut queries = QueryStatistics {
            asked: 5,
            ..Default::default()
        };
        queries.gave_up[0] = 2;
        queries.gave_up[3] = 1;
        queries.members_gave_up[1] = 4;
        let mut statistics = Statistics::default();
        statistics.add_queries(queries);
        statistics.add_queries(queries);
        assert_eq!(statistics.get(StatisticId::CheckerQueries), 10);
        assert_eq!(statistics.get(StatisticId::CheckerQueriesGivenUp), 6);
        assert_eq!(statistics.get(StatisticId::CheckerMembersGivenUp), 8);
    }

    #[test]
    fn clock_times_each_started_stage() {
        let mut clock = StageClock::new();
        clock.start(Stage::Load);
        wait_for_clock_tick();
        clock.start(Stage::LinkAndEmit);
        wait_for_clock_tick();
        clock.stop();
        for stage in Stage::ALL {
            let has_run = matches!(stage, Stage::Load | Stage::LinkAndEmit);
            assert_eq!(!clock.time_of(stage).is_zero(), has_run, "{stage:?}");
        }
    }

    #[test]
    fn clock_accumulates_reentered_stage() {
        let mut clock = StageClock::new();
        clock.start(Stage::Load);
        wait_for_clock_tick();
        clock.stop();
        let first = clock.time_of(Stage::Load);
        clock.stop();
        assert_eq!(clock.time_of(Stage::Load), first);
        clock.start(Stage::Load);
        wait_for_clock_tick();
        clock.stop();
        assert!(clock.time_of(Stage::Load) > first);
    }

    #[test]
    fn clock_adds_running_stage_to_statistics() {
        let mut clock = StageClock::new();
        clock.start(Stage::Lower);
        wait_for_clock_tick();
        let mut statistics = Statistics::default();
        clock.add_to(&mut statistics);
        assert!(statistics.get(Stage::Lower.time()) > 0);
        assert_eq!(statistics.get(Stage::Load.time()), 0);
    }
}
