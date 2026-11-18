use bun_engine_date::{DateFields, make_date_from_integers, utc_string};
use bun_engine_macros::export;
use bun_engine_text::{StringRef, Text, names};
use bun_engine_vm::{DateInstance, Gc, Shape, Vm};

#[export]
fn date_create(vm: &Vm, shape: Gc<Shape>, time: f64) -> Gc<DateInstance> {
    DateInstance::create(vm, shape, time)
}

#[export]
fn vm_follow_time_zone(vm: &Vm) {
    vm.follow_time_zone();
}

/// From the year down to the millisecond.
#[export]
fn date_from_components(vm: &Vm, components: &[i32], is_local: bool) -> f64 {
    let time = make_date_from_integers(components.try_into().expect("seven"));
    if is_local {
        vm.date_cache().utc(time)
    } else {
        time
    }
}

/// Also of a time that is less than a day outside the range of time values.
#[export]
fn date_fields(vm: &Vm, time: f64, is_local: bool) -> u64 {
    let cache = vm.date_cache();
    let fields = if is_local {
        (cache.local_fields(time)).or_else(|| DateFields::in_zone(time, cache.time_zone()))
    } else {
        cache.utc_fields(time).or_else(|| DateFields::utc(time))
    };
    fields.map_or(0, DateFields::to_bits)
}

#[export]
fn date_parse(vm: &Vm, text: Text<'_>) -> f64 {
    vm.date_cache().parse(text)
}

#[export]
fn date_to_utc_string(time: f64) -> StringRef {
    DateFields::utc(time).map_or_else(
        || names::invalidDate.to_identifier().into_string(),
        utc_string,
    )
}
