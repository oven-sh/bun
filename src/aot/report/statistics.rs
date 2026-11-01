use bun_core::fmt::{ItoaBuf, itoa};
use bun_options_types::aot_options::ExplainSet;

use super::{ReportEntry, ReportInput};
use crate::statistics::StatisticId;

fn statistic_line(id: StatisticId, value: u64) -> Vec<u8> {
    let mut line = id.name().as_bytes().to_vec();
    line.push(b' ');
    line.extend_from_slice(itoa(&mut ItoaBuf::new(), value));
    line
}

fn collect_lines(value_of: impl Fn(StatisticId) -> u64, out: &mut Vec<ReportEntry>) {
    let ids = StatisticId::ALL
        .into_iter()
        .filter(|&id| id != StatisticId::None);
    out.extend(
        ids.map(|id| ReportEntry::line(ExplainSet::STATISTICS, statistic_line(id, value_of(id)))),
    );
}

pub(super) fn collect(input: &ReportInput<'_>, out: &mut Vec<ReportEntry>) {
    collect_lines(|id| input.statistics.get(id), out);
}

#[cfg(test)]
mod tests;
