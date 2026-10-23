#[cfg(test)]
mod limit_values;

use core::time::Duration;
use std::time::Instant;

#[cfg(not(test))]
use bun_aot_interface::statistics::limit_values;
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
        self.count(
            StatisticId::SchemaArgumentsDropped,
            u64::from(queries.invalid_schema_arguments),
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
    }

    pub fn stop(&mut self) {
        if let Some((stage, started)) = self.running.take() {
            self.times[stage as usize] += started.elapsed();
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
