use core::cell::Cell;
use core::hash::BuildHasher;

use bun_engine_date::TimeZone;
use bun_engine_macros::cell;
use bun_engine_text::Text;
use bun_engine_vm::{FastHasher, FieldArray, JsCell, TypeFlags};

use super::prelude::*;

const ENTRY_COUNT: usize = 16;

/// The strings that lately went in and out as identifiers of time zones.
#[cell(flags = TypeFlags::SHAPE_IS_IMMORTAL)]
struct ZoneNames {
    base: JsCell,
    /// Atoms, as literals are, by the address of the string.
    pub(self) given: FieldArray<Option<Gc<JsString>>, ENTRY_COUNT>,
    found: [Cell<Option<TimeZone>>; ENTRY_COUNT],
    /// By the hash of the zone.
    asked_for: [Cell<Option<TimeZone>>; ENTRY_COUNT],
    pub(self) identifiers: FieldArray<Option<Gc<JsString>>, ENTRY_COUNT>,
}

pub(super) fn initialize(cx: &Cx) {
    let names = cx.allocate::<ZoneNames>(ZoneNamesInit {
        base: cx.shape_for::<ZoneNames>(),
        given: [None; ENTRY_COUNT],
        found: [const { Cell::new(None) }; ENTRY_COUNT],
        asked_for: [const { Cell::new(None) }; ENTRY_COUNT],
        identifiers: [None; ENTRY_COUNT],
    });
    cx.global().init_temporal_zone_names(names.cell());
}

/// `find_time_zone`
#[inline]
pub(super) fn find(cx: &Cx, identifier: Gc<JsString>) -> JsResult<Option<TimeZone>> {
    let names = cx.temporal_zone_names().cast::<ZoneNames>();
    let index = FastHasher::default().hash_one(identifier.address()) as usize % ENTRY_COUNT;
    if names.given().at(index) == Some(identifier) {
        return Ok(names.found[index].get());
    }
    let found = crate::find_time_zone(identifier.view(cx)?.text());
    if found.is_some() && identifier.is_atom() {
        names.given().set(index, Some(identifier));
        names.found[index].set(found);
    }
    Ok(found)
}

#[inline]
pub(super) fn identifier(cx: &Cx, time_zone: TimeZone) -> Gc<JsString> {
    let names = cx.temporal_zone_names().cast::<ZoneNames>();
    let index = FastHasher::default().hash_one(time_zone) as usize % ENTRY_COUNT;
    if names.asked_for[index].get() == Some(time_zone)
        && let Some(identifier) = names.identifiers().at(index)
    {
        return identifier;
    }
    let identifier = JsString::from_text(cx, Text::from_ascii(&time_zone.identifier()));
    names.asked_for[index].set(Some(time_zone));
    names.identifiers().set(index, Some(identifier));
    identifier
}
