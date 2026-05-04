use core::ffi::c_void;
use core::marker::{PhantomData, PhantomPinned};

use bun_jsc::{JSGlobalObject, JSObject, JSValue, JsResult};
use bun_str::ZigString;
// TODO(port): ZigString::Slice is a nested type in Zig; Phase B should expose it as
// `bun_str::zig_string::Slice` (or an associated type) — using a path alias here.
use bun_str::zig_string::Slice as ZigStringSlice;

/// Opaque JSC `JSString*` cell. Never constructed in Rust; only handled by reference.
#[repr(C)]
pub struct JSString {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn JSC__JSString__toObject(this: *mut JSString, global: *mut JSGlobalObject) -> *mut JSObject;
    fn JSC__JSString__toZigString(
        this: *mut JSString,
        global: *mut JSGlobalObject,
        zig_str: *mut ZigString,
    );
    fn JSC__JSString__eql(
        this: *const JSString,
        global: *mut JSGlobalObject,
        other: *mut JSString,
    ) -> bool;
    fn JSC__JSString__iterator(
        this: *mut JSString,
        global_object: *mut JSGlobalObject,
        iter: *mut c_void,
    );
    fn JSC__JSString__length(this: *const JSString) -> usize;
    fn JSC__JSString__is8Bit(this: *const JSString) -> bool;
}

impl JSString {
    pub fn to_js(&self) -> JSValue {
        JSValue::from_cell(self)
    }

    pub fn to_object<'a>(&self, global: &'a JSGlobalObject) -> Option<&'a JSObject> {
        // SAFETY: JSC__JSString__toObject returns either null or a valid JSObject* owned by the GC.
        unsafe {
            JSC__JSString__toObject(
                self as *const Self as *mut Self,
                global as *const _ as *mut _,
            )
            .as_ref()
        }
    }

    pub fn to_zig_string(&self, global: &JSGlobalObject, zig_str: &mut ZigString) {
        // SAFETY: self/global are valid GC cells; zig_str is a valid out-param.
        unsafe {
            JSC__JSString__toZigString(
                self as *const Self as *mut Self,
                global as *const _ as *mut _,
                zig_str,
            )
        }
    }

    pub fn ensure_still_alive(&self) {
        // SAFETY: matches Zig's std.mem.doNotOptimizeAway(this) — JSString is always a cell.
        core::hint::black_box(self as *const Self);
    }

    pub fn get_zig_string(&self, global: &JSGlobalObject) -> ZigString {
        let mut out = ZigString::init(b"");
        self.to_zig_string(global, &mut out);
        out
    }

    // pub const view = getZigString;
    #[inline]
    pub fn view(&self, global: &JSGlobalObject) -> ZigString {
        self.get_zig_string(global)
    }

    /// doesn't always allocate
    pub fn to_slice(&self, global: &JSGlobalObject) -> ZigStringSlice {
        let mut str = ZigString::init(b"");
        self.to_zig_string(global, &mut str);
        str.to_slice()
    }

    pub fn to_slice_clone(&self, global: &JSGlobalObject) -> JsResult<ZigStringSlice> {
        let mut str = ZigString::init(b"");
        self.to_zig_string(global, &mut str);
        str.to_slice_clone()
    }

    pub fn to_slice_z(&self, global: &JSGlobalObject) -> ZigStringSlice {
        let mut str = ZigString::init(b"");
        self.to_zig_string(global, &mut str);
        str.to_slice_z()
    }

    pub fn eql(&self, global: &JSGlobalObject, other: &JSString) -> bool {
        // SAFETY: all pointers are valid GC cells / borrowed refs.
        unsafe {
            JSC__JSString__eql(
                self,
                global as *const _ as *mut _,
                other as *const _ as *mut _,
            )
        }
    }

    pub fn iterator(&self, global_object: &JSGlobalObject, iter: *mut c_void) {
        // SAFETY: iter points to a caller-owned Iterator (extern struct) passed through to C++.
        unsafe {
            JSC__JSString__iterator(
                self as *const Self as *mut Self,
                global_object as *const _ as *mut _,
                iter,
            )
        }
    }

    pub fn length(&self) -> usize {
        // SAFETY: self is a valid JSString cell.
        unsafe { JSC__JSString__length(self) }
    }

    pub fn is_8bit(&self) -> bool {
        // SAFETY: self is a valid JSString cell.
        unsafe { JSC__JSString__is8Bit(self) }
    }
}

pub type JStringIteratorAppend8Callback =
    unsafe extern "C" fn(*mut Iterator, *const u8, u32);
pub type JStringIteratorAppend16Callback =
    unsafe extern "C" fn(*mut Iterator, *const u16, u32);
pub type JStringIteratorWrite8Callback =
    unsafe extern "C" fn(*mut Iterator, *const u8, u32, u32);
pub type JStringIteratorWrite16Callback =
    unsafe extern "C" fn(*mut Iterator, *const u16, u32, u32);

#[repr(C)]
pub struct Iterator {
    pub data: *mut c_void,
    pub stop: u8,
    pub append8: Option<JStringIteratorAppend8Callback>,
    pub append16: Option<JStringIteratorAppend16Callback>,
    pub write8: Option<JStringIteratorWrite8Callback>,
    pub write16: Option<JStringIteratorWrite16Callback>,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/JSString.zig (103 lines)
//   confidence: medium
//   todos:      2
//   notes:      allocator params dropped from to_slice*; ZigString::Slice path is provisional
// ──────────────────────────────────────────────────────────────────────────
