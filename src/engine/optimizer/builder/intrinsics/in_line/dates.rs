use bun_engine_asm::{FloatCond, Sign};
use bun_engine_codegen::ir::{Binary, Type, Unary, Value as Ssa};
use bun_engine_date::{BitField, DateFields, MAX_TIME_VALUE};
use bun_engine_vm::direct::Form;
use bun_engine_vm::{DateInstance, Gc, GlobalObject, RealmSlot, SpeculatedType as T, Value};

use super::Checked;
use crate::builder::Builder;
use crate::graph::{ExitKind, Kind, heaps};

const TIME: i32 = DateInstance::OFFSET_OF_TIME as i32;
const LOCAL: i32 = DateInstance::OFFSET_OF_LOCAL_FIELDS as i32;
const UTC: i32 = DateInstance::OFFSET_OF_UTC_FIELDS as i32;

/// Where a getter finds what it returns.
fn field_for(form: Form) -> Option<(i32, BitField, Sign)> {
    use Form::*;
    use Sign::{Signed, Unsigned};
    Some(match form {
        get_full_year | get_year => (LOCAL, DateFields::YEAR, Signed),
        get_utc_full_year => (UTC, DateFields::YEAR, Signed),
        get_month => (LOCAL, DateFields::MONTH, Unsigned),
        get_utc_month => (UTC, DateFields::MONTH, Unsigned),
        get_date => (LOCAL, DateFields::DAY, Unsigned),
        get_utc_date => (UTC, DateFields::DAY, Unsigned),
        get_day => (LOCAL, DateFields::WEEK_DAY, Unsigned),
        get_utc_day => (UTC, DateFields::WEEK_DAY, Unsigned),
        get_hours => (LOCAL, DateFields::HOUR, Unsigned),
        get_utc_hours => (UTC, DateFields::HOUR, Unsigned),
        get_minutes => (LOCAL, DateFields::MINUTE, Unsigned),
        get_utc_minutes => (UTC, DateFields::MINUTE, Unsigned),
        get_seconds => (LOCAL, DateFields::SECOND, Unsigned),
        get_utc_seconds => (UTC, DateFields::SECOND, Unsigned),
        get_timezone_offset => (LOCAL, DateFields::OFFSET_MINUTES, Signed),
        _ => return None,
    })
}

impl Builder<'_> {
    pub(super) fn date_in_line(&mut self, call: Checked<'_>) -> Option<Ssa> {
        use Form::*;
        Some(match (call.form, call.passed) {
            (get_time | number_of_date, &[date]) => {
                let time = self.time_of(date);
                self.box_result(time, T::BOXED_DOUBLE, call.seen)
            }
            (set_time, &[date, time]) => {
                let (time, root) = (self.time_clip(time), self.graph.root(date));
                self.node(Kind::SetTime, &[date, time], 0);
                self.knowledge.learn_field(root, TIME, heaps::DATES, time);
                self.box_result(time, T::BOXED_DOUBLE, call.seen)
            }
            (get_milliseconds, &[date]) => self.milliseconds_of(date, call.seen),
            (new_date_now, _) => {
                let time = self.node_for_form(date_now, call.realm, &[]);
                let time = self.time_clip(time);
                self.new_date(call.realm, time)
            }
            (new_date_at, &[time]) => {
                let time = self.time_clip(time);
                self.new_date(call.realm, time)
            }
            (new_date_like, &[other]) => {
                let time = self.time_of(other);
                self.new_date(call.realm, time)
            }
            (form, &[date]) => {
                let (clock, field, kind) = field_for(form)?;
                let fields = self.date_fields(date, clock);
                let found = self.extract_field(fields, field, kind);
                let result = match form {
                    get_year => self.ir().sub(found, 1900),
                    get_timezone_offset => self.ir().unary(Unary::Neg, found),
                    _ => found,
                };
                let is_invalid = self.ir().is_zero(fields);
                self.unless_invalid(is_invalid, result, call.seen)
            }
            _ => return None,
        })
    }

    fn time_of(&mut self, date: Ssa) -> Ssa {
        self.load(Type::F64, date, TIME, heaps::DATES)
    }

    /// TimeClip
    fn time_clip(&mut self, time: Ssa) -> Ssa {
        let (fits, whole) = (
            self.is_within(time, FloatCond::Le, MAX_TIME_VALUE),
            self.toward_zero(time),
        );
        let mut ir = self.ir();
        let (zero, nan) = (
            ir.const_f64(0.0),
            ir.const_f64(f64::from_bits(Value::PURE_NAN_BITS)),
        );
        let whole = ir.add(whole, zero);
        ir.select(fits, whole, nan)
    }

    fn new_date(&mut self, realm: Gc<GlobalObject>, time: Ssa) -> Ssa {
        let date = self.new_instance_of::<DateInstance>(realm, RealmSlot::date_shape);
        let none = self.word(0);
        self.initialize(date, TIME, heaps::DATES, time);
        for offset in [LOCAL, UTC] {
            self.initialize(date, offset, heaps::DATE_FIELDS, none);
        }
        date
    }

    fn date_fields(&mut self, date: Ssa, clock: i32) -> Ssa {
        // Not the field, which may be empty.
        let (root, key) = (self.graph.root(date), !clock);
        (self.knowledge.field(root, key, heaps::DATES)).unwrap_or_else(|| {
            let fields = self.node(Kind::DateFields, &[date], clock as u32);
            self.knowledge.learn_field(root, key, heaps::DATES, fields);
            fields
        })
    }

    fn extract_field(&mut self, fields: Ssa, field: BitField, sign: Sign) -> Ssa {
        let mut ir = self.ir();
        let wide = match sign {
            Sign::Signed => {
                let high = ir.shl(fields, u64::BITS - field.shift - field.width);
                ir.sar(high, u64::BITS - field.width)
            }
            Sign::Unsigned => {
                let low = ir.shr(fields, field.shift);
                ir.and(low, field.mask())
            }
        };
        ir.wrap(wide)
    }

    fn unless_invalid(&mut self, is_invalid: Ssa, int32: Ssa, seen: T) -> Ssa {
        if seen.intersects(T::PURE_NAN) && seen != T::HEAP_TOP
            || self.has_exited(ExitKind::Overflow)
        {
            return self.int32_or_nan(is_invalid, int32);
        }
        self.exit_if(is_invalid, ExitKind::Overflow);
        self.box_int32(int32)
    }

    fn milliseconds_of(&mut self, date: Ssa, seen: T) -> Ssa {
        const PER_SECOND: i32 = 1000;
        let time = self.time_of(date);
        let mut ir = self.ir();
        let whole = ir.convert(Unary::FloatToInt(Sign::Signed), Type::I64, time);
        let rest = ir.binary(Binary::Rem, whole, PER_SECOND);
        let rest = ir.wrap(rest);
        let (is_negative, above) = (ir.less_than(rest, 0), ir.add(rest, PER_SECOND));
        let result = ir.select(is_negative, above, rest);
        let is_invalid = ir.float_compare(FloatCond::NeOrUnordered, time, time);
        self.unless_invalid(is_invalid, result, seen)
    }
}
