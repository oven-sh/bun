use bun_core::fmt::{ItoaBuf, itoa};
use bun_options_types::aot_options::ExplainSet;

use super::{ReportEntry, ReportInput};
use crate::statistics::{StatisticId, StatisticStage};

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

fn stage_line(stage: StatisticStage) -> Vec<u8> {
    let mut line = b"stage ".to_vec();
    line.extend_from_slice(stage.name().as_bytes());
    line.push(b':');
    for id in StatisticId::ALL {
        if id.stage() == stage {
            line.push(b' ');
            line.extend_from_slice(id.name().as_bytes());
        }
    }
    line
}

fn collect_stages(out: &mut Vec<ReportEntry>) {
    let stages = StatisticStage::ALL
        .into_iter()
        .filter(|&stage| stage != StatisticStage::None);
    out.extend(stages.map(|stage| ReportEntry::line(ExplainSet::STATISTICS, stage_line(stage))));
}

fn collect_developer_options(option_words: &[Box<[u8]>], out: &mut Vec<ReportEntry>) {
    out.extend(option_words.iter().map(|word| {
        let line = [b"developer option --aot-".as_slice(), word].concat();
        ReportEntry::line(ExplainSet::STATISTICS, line)
    }));
}

pub(super) fn collect(input: &ReportInput<'_>, out: &mut Vec<ReportEntry>) {
    collect_lines(|id| input.statistics.get(id), out);
    collect_stages(out);
    collect_developer_options(&input.options.option_words, out);
}

#[cfg(test)]
mod tests;
