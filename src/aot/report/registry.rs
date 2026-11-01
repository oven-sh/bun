use super::format::lower_camel_case;
use super::json::JsonWriter;
use crate::builtins::id::Feature;
use crate::engine::{is_optional_pass, operation_names};
use crate::ir::generated::{
    FlowResultKind, PassId, RuntimeCounterId, SCHEMA_HASH, Sabotage, ValidationFailureKind,
};
use crate::statistics::{LimitId, LimitValues, StatisticId};

pub fn write() -> Vec<u8> {
    let statistics = StatisticId::ALL
        .into_iter()
        .filter(|&statistic| statistic != StatisticId::None);
    let runtime_counters = RuntimeCounterId::ALL
        .into_iter()
        .filter(|&counter| counter != RuntimeCounterId::None)
        .map(RuntimeCounterId::name);
    let features = Feature::ALL.iter().map(|&feature| feature.name());

    let mut json = JsonWriter::object();
    json.string("schemaHash", format!("{SCHEMA_HASH:016x}").as_bytes());
    write_limits(&mut json, &LimitValues::for_host());
    write_names(&mut json, "statistics", statistics.map(StatisticId::name));
    write_names(&mut json, "runtimeCounters", runtime_counters);
    write_names(&mut json, "flowResults", FlowResultKind::NAMES.into_iter());
    write_passes(&mut json);
    json.strings("operations", operation_names().into_iter());
    write_names(&mut json, "features", features);
    let sabotages = Sabotage::ALL
        .into_iter()
        .filter(|&sabotage| sabotage != Sabotage::None);
    write_names(&mut json, "sabotages", sabotages.map(Sabotage::name));
    write_validation_failures(&mut json);
    let mut document = json.finish();
    document.push(b'\n');
    document
}

fn write_limits(json: &mut JsonWriter, limits: &LimitValues) {
    let listed = LimitId::ALL
        .into_iter()
        .filter(|&limit| limit != LimitId::None);
    json.objects("limits", listed, |json, limit| {
        json.string("name", limit.name().as_bytes());
        json.number("value", limits.get(limit));
        json.string("stage", limit.stage().name().as_bytes());
        json.string("protects", &lower_camel_case(limit.protects().name()));
        json.string("degradesTo", &lower_camel_case(limit.degrades_to().name()));
        json.number("smallest", limit.smallest());
    });
}

fn write_passes(json: &mut JsonWriter) {
    let passes = PassId::ALL.into_iter().filter(|&pass| pass != PassId::None);
    json.objects("passes", passes, |json, pass| {
        json.string("name", pass.name().as_bytes());
        json.boolean("isOptional", is_optional_pass(pass));
    });
}

/// What a validating executable prints behind "AOT validation:", each with the word of `--aot-disable` that its check belongs to.
fn write_validation_failures(json: &mut JsonWriter) {
    let kinds = ValidationFailureKind::ALL;
    json.objects("validationFailures", kinds, |json, kind| {
        json.string("name", kind.name().as_bytes());
        json.string("disable", kind.disable().as_bytes());
    });
}

fn write_names<'a>(json: &mut JsonWriter, key: &str, names: impl Iterator<Item = &'a str>) {
    json.strings(key, names.map(str::as_bytes));
}

#[cfg(test)]
mod tests;
