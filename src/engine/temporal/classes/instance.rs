use core::cell::Cell;

use bun_engine_vm::{CellType, GlobalObject, Shape, Vm};

use super::prelude::*;
use crate::{
    Duration, InputError, Instant, PlainDate, PlainDateTime, PlainMonthDay, PlainTime,
    PlainYearMonth, ZonedDateTime,
};

/// What the instances of a class hold in their internal slots.
pub(super) trait Instance: Copy {
    const CLASS_NAME: &'static str;
    const VALUE_OF: Error;

    fn of(object: &JsObject) -> Option<Self>;

    fn shape(global: &GlobalObject, vm: &Vm) -> Gc<Shape>;

    fn allocate(self, cx: &Cx, shape: Gc<Shape>) -> Gc<JsObject>;

    #[inline(always)]
    fn of_value(value: Value) -> Option<Self> {
        Self::of(&*value.as_object()?)
    }

    /// RequireInternalSlot
    #[inline(always)]
    fn this(cx: &Cx, value: Value, member: PropertyName<'_>) -> JsResult<Self> {
        let class = Self::CLASS_NAME;
        Self::of_value(value).ok_or_else(|| throw(cx, InputError::Receiver { class, member }))
    }

    /// `this`, for a member that looks at the local date or time.
    #[inline(always)]
    fn this_local(cx: &Cx, value: Value, member: PropertyName<'_>) -> JsResult<Self> {
        Self::this(cx, value, member)
    }

    #[inline(always)]
    fn to_object(self, cx: &Cx) -> Gc<JsObject> {
        self.allocate(cx, Self::shape(&cx.global(), cx))
    }

    #[inline(always)]
    fn returned(self, cx: &Cx) -> JsResult<Value> {
        Ok(self.to_object(cx).into())
    }

    /// The last step of the constructor.
    #[inline(always)]
    fn constructed(self, cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
        let shape = cx.shape_from_new_target(frame.new_target(), &frame.callee(), Self::shape)?;
        Ok(self.allocate(cx, shape).into())
    }
}

/// The field that holds the value of an instance.
pub(super) trait Slot<T> {
    fn load(&self) -> T;
}

impl<T: Instance> Slot<T> for T {
    #[inline(always)]
    fn load(&self) -> T {
        *self
    }
}

impl<T: Instance> Slot<T> for Cell<T> {
    #[inline(always)]
    fn load(&self) -> T {
        self.get()
    }
}

macro_rules! temporal_values {
    ($($name:ident,)*) => {
        /// What an instance of any of the classes holds.
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        pub enum TemporalValue {
            $($name($name),)*
        }

        impl TemporalValue {
            #[inline]
            pub fn of(object: &JsObject) -> Option<TemporalValue> {
                if object.cell_type() != CellType::Object {
                    return None;
                }
                $(if let Some(value) = $name::of(object) {
                    return Some(TemporalValue::$name(value));
                })*
                None
            }

            /// A new instance, in the realm of `cx`.
            pub fn to_object(&self, cx: &Cx) -> Gc<JsObject> {
                match *self {
                    $(TemporalValue::$name(value) => value.to_object(cx),)*
                }
            }
        }
    };
}

temporal_values! {
    Duration,
    Instant,
    PlainDate,
    PlainDateTime,
    PlainMonthDay,
    PlainTime,
    PlainYearMonth,
    ZonedDateTime,
}
