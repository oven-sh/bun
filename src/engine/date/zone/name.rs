use bun_engine_platform::clock;
use bun_engine_text::Text;
use bun_icu::calendar::{Calendar, ZoneName};
use bun_icu::resource_bundle::ResourceBundle;
use bun_icu::{Buffer, CText, host_language, time_zone};

use super::{TimeZone, TimeZoneId};
use crate::format::{MAX_ISO_STRING_LENGTH, write_iso_string};

impl TimeZoneId {
    /// `Pacific Standard Time`, in the language of the host.
    pub(crate) fn long_name(self, kind: ZoneName) -> Option<Buffer<u16>> {
        let id = TimeZone::Named(self).icu_id();
        let language = host_language();
        // The first calendar of a process takes milliseconds to open.
        if language == c"en-US"
            && let Some(name) = english_name(&id, kind)
        {
            return Some(name);
        }
        let calendar = Calendar::open(&id, c"").ok()?;
        (calendar.zone_name(kind, language))
            .or_else(|_| calendar.zone_name(kind, c"en-US"))
            .ok()
    }
}

/// UTS #35, part 4, section 7: that of the zone itself, or that of the metazone that it is in now.
fn english_name(id: &[u16], kind: ZoneName) -> Option<Buffer<u16>> {
    let names = ResourceBundle::open_zone_names(c"en").ok()?;
    let names = names.by_key(c"zoneStrings").ok()?;
    let kind = match kind {
        ZoneName::Standard => c"ls",
        ZoneName::Daylight => c"ld",
    };
    let name = |key: &CText| {
        let name = names.by_key(key).ok()?.by_key(kind).ok()?;
        Some(Buffer::from_slice(name.string().ok()?))
    };
    let zone = key(b"", &time_zone::canonical_id(id).ok()?)?;
    let name = name(&zone).or_else(|| name(&current_metazone(&zone)?))?;
    // U+2205 marks a name that is absent.
    (name.first() != Some(&0x2205)).then_some(name)
}

fn key(prefix: &[u8], name: &[u16]) -> Option<CText> {
    let mut key = Buffer::from_slice(prefix);
    key.extend(name.iter().map(|&unit| match unit as u8 {
        b'/' => b':',
        byte => byte,
    }));
    CText::new(&key).ok()
}

fn current_metazone(zone: &CText) -> Option<CText> {
    let mut now = [0u8; MAX_ISO_STRING_LENGTH];
    write_iso_string(clock::wall_milliseconds() as f64, &mut now)?;
    now[10] = b' ';
    let now = Text::Latin1(&now[.."1970-01-01 00:00".len()]);

    let metazones = ResourceBundle::open_direct(c"metaZones").ok()?;
    let periods = (metazones.by_key(c"metazoneInfo").ok()?)
        .by_key(zone)
        .ok()?;
    (0..periods.item_count()).find_map(|index| {
        let period = periods.by_index(index).ok()?;
        let is_current = match (period.string_at(1), period.string_at(2)) {
            (Ok(start), Ok(end)) => (Text::Utf16(start)..Text::Utf16(end)).contains(&now),
            _ => true,
        };
        key(b"meta:", period.string_at(0).ok().filter(|_| is_current)?)
    })
}
