use core::sync::atomic::Ordering;

use bun_engine_text::Text;
use bun_icu::{Buffer, time_zone};

use super::rules::{Side, ZoneRules};
use super::table::{Entry, Table};

/// An available named time zone identifier (ECMA-402, 6.5), primary or not.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct TimeZoneId(pub(super) u16);

/// Names that ICU has and the IANA database has not.
const LEGACY_NAMES: [&str; 25] = [
    "ACT", "AET", "AGT", "ART", "AST", "BET", "BST", "CAT", "CNT", "CST", "CTT", "EAT", "ECT",
    "IET", "IST", "JST", "MIT", "NET", "NST", "PLT", "PNT", "PRT", "PST", "SST", "VST",
];

/// Zones of their own in some releases of the database and links in others. They are never primary.
const LINKS: [(&str, &str); 4] = [
    ("CST6CDT", "America/Chicago"),
    ("EST5EDT", "America/New_York"),
    ("MST7MDT", "America/Denver"),
    ("PST8PDT", "America/Los_Angeles"),
];

impl TimeZoneId {
    pub const UTC: TimeZoneId = TimeZoneId(Table::UTC);

    /// GetAvailableNamedTimeZoneIdentifier, which ignores ASCII case.
    pub fn find(name: Text<'_>) -> Option<TimeZoneId> {
        let index = Table::get().find(name)?;
        primary_at(index).map(|_| TimeZoneId(index))
    }

    /// AvailablePrimaryTimeZoneIdentifiers, in the order of their code units.
    pub fn primaries() -> Vec<TimeZoneId> {
        let table = Table::get();
        (Table::UTC + 1..table.len())
            .filter_map(|index| match table.name(index) {
                "UTC" => Some(TimeZoneId::UTC),
                _ => primary_at(index).filter(|primary| primary.0 == index),
            })
            .collect()
    }

    /// For what a system or ICU calls `name`, which need not be available.
    pub(super) fn primary_of(name: &[u16]) -> Option<TimeZoneId> {
        if names_utc(Text::Utf16(name)) {
            return Some(TimeZoneId::UTC);
        }
        let standard = time_zone::iana_id(name).or_else(|_| time_zone::canonical_id(name));
        primary_at(Table::get().find(Text::Utf16(standard.as_deref().unwrap_or(name)))?)
    }

    pub fn identifier(self) -> &'static str {
        match self {
            TimeZoneId::UTC => "UTC",
            _ => Table::get().name(self.0),
        }
    }

    pub fn primary(self) -> TimeZoneId {
        primary_at(self.0).unwrap_or(self)
    }

    #[inline]
    pub fn rules(self) -> &'static ZoneRules {
        if self == TimeZoneId::UTC {
            return ZoneRules::UTC;
        }
        let table = Table::get();
        let rules = &table.entry(self.0).rules;
        rules.get().copied().unwrap_or_else(|| {
            let loaded = table.load_rules(self.in_icu().0);
            rules.get_or_init(|| loaded)
        })
    }

    /// UTC(`local_time`) of ECMA-262 as if this were the zone of the system, for `time_clip`.
    pub fn utc(self, local_time: f64) -> f64 {
        let seconds = (local_time as i64).div_euclid(1000);
        let span = self.rules().span_at_local(seconds, Side::Before);
        local_time - f64::from(span.offset.seconds * 1000)
    }

    /// The zone to ask ICU about.
    pub(super) fn in_icu(self) -> TimeZoneId {
        match link_target(self.identifier()) {
            Some(_) => self.primary(),
            None => self,
        }
    }
}

pub(super) fn names_utc(name: Text<'_>) -> bool {
    ["UTC", "Etc/UTC", "Etc/GMT", "GMT"]
        .iter()
        .any(|utc| name.eq_ascii(utc))
}

pub(super) fn widen(ascii: &str) -> Buffer<u16> {
    ascii.bytes().map(u16::from).collect()
}

fn link_target(name: &str) -> Option<&'static str> {
    let &(_, target) = LINKS.iter().find(|&&(link, _)| link == name)?;
    Some(target)
}

/// `None` if the name is not available.
fn primary_at(index: u16) -> Option<TimeZoneId> {
    if index == Table::UTC {
        return Some(TimeZoneId::UTC);
    }
    let table = Table::get();
    let cached = &table.entry(index).primary;
    let mut primary = cached.load(Ordering::Relaxed);
    if primary == Entry::NOT_KNOWN_YET {
        primary = look_up_primary(table, table.name(index)).unwrap_or(Entry::NOT_AVAILABLE);
        cached.store(primary, Ordering::Relaxed);
    }
    (primary != Entry::NOT_AVAILABLE).then_some(TimeZoneId(primary))
}

#[cold]
fn look_up_primary(table: &Table, name: &str) -> Option<u16> {
    if LEGACY_NAMES.contains(&name) {
        return None;
    }
    if let Some(target) = link_target(name) {
        return table.find(Text::from_ascii(target));
    }
    let canonical = time_zone::canonical_id(&widen(name)).ok()?;
    let iana = time_zone::iana_id(&canonical);
    let primary = Text::Utf16(iana.as_ref().unwrap_or(&canonical));
    if names_utc(primary) {
        return Some(Table::UTC);
    }
    let is_in_database = canonical.contains(&u16::from(b'/'))
        && !Text::Utf16(&canonical).starts_with(Text::from_ascii("SystemV/"))
        && !Text::Utf16(&canonical).eq_ascii("Etc/Unknown");
    table.find(primary).filter(|_| is_in_database)
}
