//! The time zone of the process. Each word of the state stands by itself, so accesses need no order.

use core::sync::atomic::{AtomicU64, Ordering};

use bun_engine_text::Text;
use bun_icu::{Buffer, time_zone};

use super::data;
use super::id::{TimeZoneId, names_utc};

const LOW_BITS: u32 = 16;
const HOST: u16 = u16::MAX;
const UTC: u16 = u16::MAX - 1;

/// The generation, and below it `HOST`, `UTC` or a position in `data::names`.
static CHOICE: AtomicU64 = AtomicU64::new(1 << LOW_BITS | HOST as u64);
/// A generation, and below it the `TimeZoneId` that its choice comes to.
static RESOLVED: AtomicU64 = AtomicU64::new(0);

/// Changes whenever the result of `system_time_zone` can have changed.
#[inline]
pub(crate) fn time_zone_generation() -> u64 {
    CHOICE.load(Ordering::Relaxed) >> LOW_BITS
}

/// Puts the process in another zone, or back in that of the host if `name` is empty. Returns whether ICU knows the name, for
/// which case matters. One that is not available to scripts, such as the offset `GMT+5`, stands for UTC.
pub fn set_time_zone_override(name: Text<'_>) -> bool {
    let Some(choice) = choice_named(name) else {
        return false;
    };
    CHOICE.update(Ordering::Relaxed, Ordering::Relaxed, |state| {
        ((state >> LOW_BITS) + 1) << LOW_BITS | u64::from(choice)
    });
    true
}

/// Loads little, as a process that is started with `TZ` may never ask for the time.
fn choice_named(name: Text<'_>) -> Option<u16> {
    const LONGEST: usize = 128;
    let position_of = |name| u16::try_from(data::position_of(name)?).ok();
    if name.is_empty() {
        return Some(HOST);
    }
    if names_utc(name) {
        return Some(UTC);
    }
    if let Some(position) = position_of(name) {
        return Some(position);
    }
    if name.len() > LONGEST {
        return None;
    }
    let canonical = time_zone::canonical_id(&name.code_units().collect::<Buffer<u16>>()).ok()?;
    Some(position_of(Text::Utf16(&canonical)).unwrap_or(UTC))
}

fn resolve(choice: u16) -> Option<TimeZoneId> {
    match choice {
        HOST => TimeZoneId::primary_of(&time_zone::host().ok()?),
        UTC => Some(TimeZoneId::UTC),
        position => TimeZoneId::primary_of(data::names().ok()?.string_at(position.into()).ok()?),
    }
}

/// SystemTimeZoneIdentifier: UTC if the zone has no name that is available.
pub(crate) fn system_time_zone() -> TimeZoneId {
    let state = CHOICE.load(Ordering::Relaxed);
    let resolved = RESOLVED.load(Ordering::Relaxed);
    if resolved >> LOW_BITS == state >> LOW_BITS {
        return TimeZoneId(resolved as u16);
    }
    let zone = resolve(state as u16).unwrap_or(TimeZoneId::UTC);
    RESOLVED.store(
        state >> LOW_BITS << LOW_BITS | u64::from(zone.0),
        Ordering::Relaxed,
    );
    zone
}
