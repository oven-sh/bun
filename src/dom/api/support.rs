//! What the areas share besides the tree.

use core::ffi::c_void;

use bun_jsc::bindgen::{self, JsHeap, JsLocal, JsScope};
use bun_jsc::{JSGlobalObject, JSValue};
use bun_markup::Chars;

use crate::api::core::*;

type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Result<'a, T = ()> = bindgen::Result<'a, T>;

unsafe extern "C" {
    fn Bun__DOM__withoutCollecting(
        global: &JSGlobalObject,
        context: *mut c_void,
        run: unsafe extern "C" fn(*mut c_void),
    );
}

#[inline(always)]
fn chars_of(string: &bun_alloc::WTFStringImplStruct) -> Chars<'_> {
    if string.is_8bit() {
        Chars::Latin1(string.latin1_slice())
    } else {
        Chars::Utf16(string.utf16_slice())
    }
}

fn narrowed(wide: &[u16]) -> Option<smallvec::SmallVec<[u8; 64]>> {
    (wide.iter().fold(0, |all, it| all | it) <= 0xff)
        .then(|| wide.iter().map(|it| *it as u8).collect())
}

impl DomString {
    #[inline(always)]
    pub(crate) fn chars(&self) -> Chars<'_> {
        chars_of(self.as_impl())
    }

    /// With 8 bits per character if they are enough.
    #[inline]
    pub(crate) fn from_chars(chars: Chars<'_>) -> DomString {
        match chars {
            Chars::Latin1(narrow) => DomString::from_latin1(narrow),
            Chars::Utf16(wide) if wide.iter().fold(0, |all, it| all | it) <= 0xff => {
                DomString::from_narrow_utf16(wide)
            }
            Chars::Utf16(wide) => DomString::from_utf16(wide),
        }
    }
}

impl Atom {
    #[inline(always)]
    pub(crate) fn chars(&self) -> Chars<'_> {
        self.as_known()
            .map_or_else(|| chars_of(self.as_impl()), Chars::from)
    }

    #[inline]
    pub(crate) fn from_chars(chars: Chars<'_>) -> Atom {
        match chars {
            Chars::Latin1(narrow) => Atom::from_latin1(narrow),
            Chars::Utf16(wide) => narrowed(wide).map_or_else(
                || Atom::from_string(&DomString::from_utf16(wide)),
                |it| Atom::from_latin1(&it),
            ),
        }
    }
}

/// For what looks something up, and has to make an object for that.
pub(crate) fn allocate_quietly<F: FnOnce(&JsHeap<'_>) -> JSValue>(
    global: &JSGlobalObject,
    make: F,
) -> JSValue {
    unsafe extern "C" fn call<F: FnOnce(&JsHeap<'_>) -> JSValue>(context: *mut c_void) {
        // SAFETY: what is passed below.
        let (global, make, made) =
            unsafe { &mut *context.cast::<(&JSGlobalObject, Option<F>, JSValue)>() };
        *made = make
            .take()
            .map_or(JSValue::UNDEFINED, |it| it(JsHeap::from_global(global)));
    }
    let mut context = (global, Some(make), JSValue::UNDEFINED);
    // SAFETY: `context` outlives the call.
    unsafe { Bun__DOM__withoutCollecting(global, (&raw mut context).cast(), call::<F>) };
    context.2
}

/// For what runs no script of the page, and keeps all that it makes.
pub(crate) fn without_collecting<'a, R, F: FnOnce(Cx<'_, 'a>) -> R>(cx: Cx<'_, 'a>, run: F) -> R {
    struct Call<'c, 'a, F, R>(Cx<'c, 'a>, Option<F>, Option<R>);
    unsafe extern "C" fn call<'a, R, F: FnOnce(Cx<'_, 'a>) -> R>(context: *mut c_void) {
        // SAFETY: what is passed below.
        let Call(cx, run, result) = unsafe { &mut *context.cast::<Call<'_, 'a, F, R>>() };
        *result = run.take().map(|run| run(cx));
    }
    let global = core::ptr::from_ref(cx.global());
    let mut context = Call(cx, Some(run), None);
    // SAFETY: `context` outlives the call, and so does the global object.
    unsafe { Bun__DOM__withoutCollecting(&*global, (&raw mut context).cast(), call::<R, F>) };
    context.2.expect("it was called")
}

/// <https://webidl.spec.whatwg.org/#js-sequence>
pub(crate) fn for_each_in_sequence<'a, F: FnMut(Cx<'_, 'a>, JsLocal<'a>) -> Result<'a>>(
    cx: Cx<'_, 'a>,
    sequence: JsLocal<'a>,
    visit: F,
) -> Result<'a> {
    struct Call<'c, 'a, F>(Cx<'c, 'a>, F);
    extern "C" fn call<'a, F: FnMut(Cx<'_, 'a>, JsLocal<'a>) -> Result<'a>>(
        _: *mut bun_jsc::VM,
        global: &JSGlobalObject,
        context: *mut c_void,
        next: JSValue,
    ) {
        // SAFETY: what is passed below.
        let Call(cx, visit) = unsafe { &mut *context.cast::<Call<'_, 'a, F>>() };
        let next = JsLocal::new(&cx.heap, next);
        if let Err(error) = visit(cx, next) {
            let _ = error.into_js_error(global);
        }
    }
    if !sequence.to_js().is_object() {
        return Err(cx
            .heap
            .type_error(format_args!("The value cannot be converted to a sequence.")));
    }
    let global = core::ptr::from_ref(cx.global());
    let mut context = Call(cx, visit);
    // SAFETY: the caller holds it.
    Ok(sequence
        .to_js()
        .for_each(unsafe { &*global }, (&raw mut context).cast(), call::<F>)?)
}

/// <https://html.spec.whatwg.org/#report-an-exception>
pub(crate) fn report_exception<'a>(cx: Cx<'_, 'a>, error: bindgen::Error<'a>) {
    let error = error.into_js_error(cx.global());
    crate::api::events::report(cx, None, error);
}
