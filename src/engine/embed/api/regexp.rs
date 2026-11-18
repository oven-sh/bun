use core::ffi::c_void;

use bun_engine_macros::export;
use bun_engine_regexp::Flags;
use bun_engine_text::{StringImpl, StringRef, Text};
use bun_engine_vm::{
    CaptureBuffer, Cx, Gc, JsResult, JsString, RegExp, RegExpObject, Shape, Value, Vm,
};

#[export]
fn regexp_parse_flags(text: Text<'_>, flags: &mut u8) -> bool {
    Flags::parse(text).map(|it| *flags = it.bits()).is_some()
}

#[export]
fn regexp_flags_to_string(flags: u8) -> StringRef {
    StringRef::from_text(Flags::from_bits_retain(flags).to_text().text())
}

#[export]
fn regexp_try_create(vm: &Vm, pattern: &StringImpl, flags: u8) -> Option<Gc<RegExp>> {
    RegExp::try_create(vm, pattern, Flags::from_bits_retain(flags)).ok()
}

#[export]
fn regexp_create(cx: &Cx, pattern: &StringImpl, flags: u8) -> JsResult<Gc<RegExp>> {
    RegExp::create(cx, pattern, Flags::from_bits_retain(flags))
}

#[export]
fn regexp_find(
    regexp: &RegExp,
    cx: &Cx,
    subject: Text<'_>,
    start: u32,
    match_start: &mut u32,
    match_end: &mut u32,
) -> JsResult<bool> {
    let found = regexp.find(cx, subject, start)?;
    Ok(found
        .map(|it| (*match_start, *match_end) = (it.start, it.end))
        .is_some())
}

/// `receive` gets the offsets if there is a match.
#[export]
unsafe fn regexp_exec(
    regexp: &RegExp,
    cx: &Cx,
    subject: Text<'_>,
    start: u32,
    receive: unsafe extern "C" fn(*mut c_void, *const u32, usize),
    context: *mut c_void,
) -> JsResult<()> {
    if let Some(captures) = regexp.exec(cx, subject, start, &mut CaptureBuffer::default())? {
        let offsets = captures.offsets();
        // SAFETY: the two go together.
        unsafe { receive(context, offsets.as_ptr(), offsets.len()) };
    }
    Ok(())
}

#[export]
fn regexp_object_create(vm: &Vm, shape: Gc<Shape>, regexp: Gc<RegExp>) -> Gc<RegExpObject> {
    RegExpObject::create_with_shape(vm, shape, regexp)
}

#[export]
fn regexp_object_last_index(object: &RegExpObject) -> Value {
    object.last_index()
}

#[export]
fn regexp_object_test(object: &RegExpObject, cx: &mut Cx, string: Gc<JsString>) -> JsResult<bool> {
    object.test(cx, string)
}
