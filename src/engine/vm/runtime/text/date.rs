use core::cell::Cell;
use core::mem::offset_of;

use bun_engine_date::{DateCache, DateFields, set_time_zone_override, time_clip};
use bun_engine_macros::cell;
use bun_engine_platform::clock;
use bun_engine_text::{Text, names};

use crate::{
    Cx, Gc, GlobalObject, JsObject, JsObjectInit, JsString, RealmSlot, RealmWatchpoint, Shape, Vm,
};

#[cell(name = "Date", cell_type = Date, export = "engine_class_DateInstance")]
pub struct DateInstance {
    base: JsObject,
    time: Cell<f64>,
    /// `None` until they are asked for, and if the time value is NaN.
    local_fields: Cell<Option<DateFields>>,
    utc_fields: Cell<Option<DateFields>>,
}

impl DateInstance {
    /// A double: an integer other than −0 of at most `MAX_TIME_VALUE` in magnitude, or the canonical NaN. What stores it
    /// sets both words below to zero.
    pub const OFFSET_OF_TIME: usize = offset_of!(DateInstance, time);
    /// The bits of `DateFields`, or zero, which does not mean that the time is NaN. A change of the time zone sets it to
    /// zero.
    pub const OFFSET_OF_LOCAL_FIELDS: usize = offset_of!(DateInstance, local_fields);
    /// The same, whatever the time zone.
    pub const OFFSET_OF_UTC_FIELDS: usize = offset_of!(DateInstance, utc_fields);

    /// With TimeClip(`time`).
    #[inline]
    pub fn create(vm: &Vm, shape: Gc<Shape>, time: f64) -> Gc<DateInstance> {
        vm.allocate::<DateInstance>(DateInstanceInit {
            base: JsObjectInit::new(vm, shape),
            time: Cell::new(time_clip(time)),
            local_fields: Cell::new(None),
            utc_fields: Cell::new(None),
        })
    }

    #[inline(always)]
    pub fn time(&self) -> f64 {
        self.time.get()
    }

    /// Sets and returns TimeClip(`time`).
    #[inline]
    pub fn set_time(&self, time: f64) -> f64 {
        self.time.set(time_clip(time));
        self.local_fields.set(None);
        self.utc_fields.set(None);
        self.time()
    }

    #[inline]
    pub fn local_fields(&self, vm: &Vm) -> Option<DateFields> {
        self.local_fields.get().or_else(|| {
            self.local_fields
                .set(vm.date_cache().local_fields(self.time()));
            self.local_fields.get()
        })
    }

    #[inline]
    pub fn utc_fields(&self, vm: &Vm) -> Option<DateFields> {
        self.utc_fields.get().or_else(|| {
            self.utc_fields.set(vm.date_cache().utc_fields(self.time()));
            self.utc_fields.get()
        })
    }

    /// ToDateString
    pub fn to_date_string(&self, vm: &Vm) -> Gc<JsString> {
        match self.local_fields(vm) {
            Some(fields) => JsString::new(vm, vm.date_cache().date_time_string(fields)),
            None => JsString::from_name(vm, names::invalidDate),
        }
    }

    /// Whether ToPrimitive and `JSON.stringify` would call nothing but the functions that the library started with.
    #[inline]
    pub fn has_pristine_conversions(&self, cx: &Cx) -> bool {
        let original_shape = cx.global().slot_if_initialized(RealmSlot::date_shape);
        original_shape == Some(self.shape().cell()) && cx.holds(RealmWatchpoint::DateConversions)
    }

    /// The same in its own realm, if that has been asked there before.
    #[inline]
    pub(crate) fn is_known_to_have_pristine_conversions(&self) -> bool {
        self.realm().is_some_and(|global| {
            global.slot_if_initialized(RealmSlot::date_shape) == Some(self.shape().cell())
                && (global.watchpoints_unchecked(RealmWatchpoint::DateConversions)).is_watched()
        })
    }
}

impl GlobalObject {
    /// What `Date.now()` returns.
    #[inline]
    pub fn date_now(&self) -> f64 {
        let overridden = self.overridden_date_now().get();
        if overridden.is_nan() {
            clock::wall_milliseconds() as f64
        } else {
            overridden
        }
    }
}

impl Vm {
    #[inline(always)]
    pub fn date_cache(&self) -> &DateCache {
        &self.services.text.dates
    }

    /// For the process. This `Vm` follows at once, and each of the others when it is next entered.
    pub fn set_time_zone(&self, name: Text<'_>) -> bool {
        let is_known = set_time_zone_override(name);
        self.follow_time_zone();
        is_known
    }

    /// To the one that the process is in now.
    #[inline]
    pub fn follow_time_zone(&self) {
        if self.date_cache().is_stale() && self.date_cache().refresh() {
            self.heap
                .for_each_live::<DateInstance>(|date| date.local_fields.set(None));
        }
    }
}
