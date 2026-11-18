//! `RegExp`, and the methods of `String.prototype` that defer to it.

mod accessors;
mod constructor;
mod iterator;
mod legacy;
mod matching;
mod prototype;
mod replace;
mod split;
pub(crate) mod string_methods;

use bun_engine_text::Text;
use bun_engine_vm::{
    RealmSlot, RealmWatchpoint, StringView, initialize_match_array_slot, species_constructor,
};

use crate::prelude::*;
use crate::watchpoints::Conditions;

pub(super) fn initialize_slot(cx: &Cx, slot: RealmSlot) -> bool {
    use RealmSlot::*;
    match slot {
        regexp_prototype | regexp_shape => prototype::initialize(cx),
        regexp_prototype_exec => prototype::initialize_exec(cx),
        regexp_constructor => constructor::initialize(cx),
        regexp_string_iterator_shape => iterator::initialize(cx),
        _ => return initialize_match_array_slot(cx, slot),
    }
    true
}

pub(super) fn add_conditions(
    cx: &Cx,
    which: RealmWatchpoint,
    conditions: &mut Conditions<'_>,
) -> bool {
    match which {
        RealmWatchpoint::RegExpPrimordialProperties => {
            let methods = [
                names::exec,
                names::flags,
                symbols::r#match,
                symbols::matchAll,
                symbols::replace,
                symbols::search,
                symbols::split,
            ];
            let properties = methods.into_iter().chain(accessors::FLAG_NAMES);
            conditions.all_pristine(&cx.regexp_prototype(), properties);
        }
        RealmWatchpoint::RegExpPrototypeTest => {
            conditions.pristine(&cx.regexp_prototype(), names::test);
        }
        RealmWatchpoint::RegExpSpecies => {
            conditions.pristine(&cx.regexp_prototype(), names::constructor);
            conditions.pristine(&cx.regexp_constructor(), symbols::species);
        }
        _ => return false,
    }
    true
}

fn this_object(cx: &Cx, frame: &CallFrame, message: &'static str) -> JsResult<Gc<JsObject>> {
    let this = frame.this_value().as_object();
    this.ok_or_else(|| cx.throw_type_error(message))
}

/// What the property `flags` says.
struct FlagsProperty {
    string: Gc<JsString>,
    letters: StringView,
}

impl FlagsProperty {
    fn of(cx: &mut Cx, regexp: &JsObject) -> JsResult<FlagsProperty> {
        let string = regexp.get(cx, names::flags)?.to_string(cx)?;
        let letters = string.view(cx)?;
        Ok(FlagsProperty { string, letters })
    }

    fn text(&self) -> Text<'_> {
        self.letters.text()
    }

    fn has(&self, letter: u8) -> bool {
        self.text().contains_unit(letter.into())
    }

    fn is_unicode_aware(&self) -> bool {
        self.has(b'u') || self.has(b'v')
    }
}

fn species(cx: &mut Cx, regexp: &JsObject) -> JsResult<Value> {
    let constructor = species_constructor(cx, regexp)?;
    Ok(constructor
        .unwrap_or_else(|| cx.regexp_constructor())
        .into())
}
