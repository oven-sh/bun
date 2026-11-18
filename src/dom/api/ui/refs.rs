//! References between cells that script never sees.

use core::marker::PhantomData;

use bun_jsc::JSValue;
use bun_jsc::bindgen::{self, JsHeap, JsInterface, JsLocal};

use crate::api::core::List;

pub(crate) trait Handle {
    /// The caller got `value` from something that keeps it alive, and from now on the stack does.
    fn from_value<'a>(value: JSValue) -> Option<&'a Self>;
    fn value(&self) -> JSValue;
}

impl<T: JsInterface> Handle for T {
    #[inline]
    fn from_value<'a>(value: JSValue) -> Option<&'a T> {
        // SAFETY: it is an instance.
        T::is(value).then(|| unsafe { T::from_js_unchecked(value) })
    }

    #[inline]
    fn value(&self) -> JSValue {
        self.to_js()
    }
}

/// `name()` and `set_name()` for internal fields that have a handle, or a list of them.
macro_rules! slots {
    ($class:ty = $js:ident { $($name:ident: $type:ty),* $(,)? } $([ $($list:ident: $item:ty),* $(,)? ])?) => {
        paste::paste! { impl $class {
            $(
                #[inline]
                pub(crate) fn $name(&self) -> Option<&$type> {
                    $js::$name(self).and_then(Handle::from_value)
                }
                #[inline]
                pub(crate) fn [<set_ $name>](&self, value: Option<&$type>) {
                    $js::[<set_ $name>](self, value.map_or(JSValue::ZERO, Handle::value));
                }
            )*
            $($(
                #[inline]
                pub(crate) fn $list(&self) -> Refs<'_, $item> {
                    Refs::from_field($js::$list(self))
                }
                #[inline]
                pub(crate) fn [<set_ $list>](&self, value: Refs<'_, $item>) {
                    $js::[<set_ $list>](self, value.to_field());
                }
            )*)?
        } }
    };
    ($class:ty = $js:ident set { $($name:ident: $type:ty,)* }) => {
        paste::paste! { impl $class {$(
            fn [<set_ $name>](&self, value: Option<&$type>) {
                $js::[<set_ $name>](self, value.map_or(JSValue::ZERO, Handle::value));
            }
        )*} }
    };
}
pub(crate) use slots;

/// A list that keeps what is in it alive. One that is in a field is replaced or appended to, so it can be walked while script runs.
pub(crate) struct Refs<'a, T>(Option<List<'a>>, PhantomData<&'a T>);

impl<T> Clone for Refs<'_, T> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Copy for Refs<'_, T> {}

impl<T> Default for Refs<'_, T> {
    fn default() -> Self {
        Refs(None, PhantomData)
    }
}

impl<'a, T: Handle + 'a> Refs<'a, T> {
    pub(crate) fn from_field(value: Option<JSValue>) -> Self {
        Refs(value.map(List::from_value), PhantomData)
    }

    pub(crate) fn to_field(self) -> JSValue {
        self.0
            .filter(|it| !it.is_empty())
            .map_or(JSValue::ZERO, List::to_js)
    }

    pub(crate) fn collect<'b>(heap: &JsHeap<'a>, items: impl IntoIterator<Item = &'b T>) -> Self
    where
        T: 'b,
    {
        let mut list = Refs::default();
        items.into_iter().for_each(|it| list.push(heap, it));
        list
    }

    pub(crate) fn push(&mut self, heap: &JsHeap<'a>, item: &T) {
        self.0
            .get_or_insert_with(|| List::new(heap))
            .push(heap, item.value());
    }

    pub(crate) fn len(self) -> usize {
        self.0.map_or(0, |it| it.len() as usize)
    }

    pub(crate) fn is_empty(self) -> bool {
        self.len() == 0
    }

    pub(crate) fn get(self, index: usize) -> Option<&'a T> {
        T::from_value(self.0?.get(index.try_into().ok()?))
    }

    pub(crate) fn first(self) -> Option<&'a T> {
        self.get(0)
    }

    pub(crate) fn last(self) -> Option<&'a T> {
        self.get(self.len().checked_sub(1)?)
    }

    pub(crate) fn iter(self) -> impl DoubleEndedIterator<Item = &'a T> + Clone + use<'a, T> {
        (0..self.len()).filter_map(move |it| self.get(it))
    }

    pub(crate) fn position(self, item: &T) -> Option<usize> {
        self.0?.position(item.value()).map(|it| it as usize)
    }

    pub(crate) fn contains(self, item: &T) -> bool {
        self.position(item).is_some()
    }

    pub(crate) fn without<'b>(self, heap: &JsHeap<'b>, item: &T) -> Refs<'b, T> {
        Refs(
            self.0.map(|it| it.copy_without(heap, item.value())),
            PhantomData,
        )
    }

    pub(crate) fn with<'b>(self, heap: &JsHeap<'b>, item: &T) -> Refs<'b, T> {
        let mut list = self.without(heap, item);
        list.push(heap, item);
        list
    }

    /// In place.
    pub(crate) fn followed_by<'b>(self, heap: &JsHeap<'b>, item: &T) -> Refs<'b, T> {
        let mut list = Refs(self.0.map(|it| List::from_value(it.to_js())), PhantomData);
        list.push(heap, item);
        list
    }

    /// A copy, for a script.
    pub(crate) fn to_array<'b>(self, heap: &JsHeap<'b>) -> bindgen::Result<'b, JSValue> {
        Ok(heap
            .create_array(self.iter(), |heap, it| Ok(JsLocal::new(heap, it.value())))?
            .to_js())
    }

    pub(crate) fn skip<'b>(self, heap: &JsHeap<'b>, count: usize) -> Refs<'b, T> {
        Refs::collect(heap, self.iter().skip(count))
    }
}
