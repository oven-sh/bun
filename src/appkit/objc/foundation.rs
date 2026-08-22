//! Foundation bindings. See [`super`] for how these are generated and what
//! makes them sound. The only raw calls here are the CFString ones in
//! [`NSString::from_str`] / [`NSString::to_utf16`].

use core::ptr;

use super::{Bool, CChars, Id, Object, Ptr, Sel, objc_class, objc_global, objc_methods, rt};

objc_class!(pub struct NSObject = "NSObject");
objc_methods! { impl NSObject {
    pub(crate) fn responds_to_selector(&self, sel: Sel) -> bool = "respondsToSelector:";
    /// nil for a selector the receiver does not implement or forward.
    pub(crate) fn method_signature_for_selector(&self, sel: Sel) -> Option<NSMethodSignature> = "methodSignatureForSelector:";
    pub fn is_equal(&self, other: Option<&NSObject>) -> bool = "isEqual:";
    /// Declared nonnull; nil from a misbehaving override reads as `None` rather than a crash.
    pub fn description(&self) -> Option<NSString> = "description";
}}

impl NSObject {
    /// For IMPs that must return an object to AppKit: retains once more and
    /// autoreleases, so the pointer outlives this wrapper's drop by one pool.
    pub(crate) fn autorelease_return(&self) -> super::Obj {
        // SAFETY: self is live; the extra reference taken here is the one the
        // autorelease pool releases later.
        unsafe { (rt().objc_autorelease)((rt().objc_retain)(self.as_obj())) }
    }
}

pub(crate) trait Upcast: Object {
    /// View any object as `NSObject`.
    fn upcast(&self) -> &NSObject {
        // SAFETY: every wrapper is repr(transparent) over Id and every class
        // is an NSObject.
        unsafe { &*core::ptr::from_ref(self.as_id()).cast::<NSObject>() }
    }
}
impl<T: Object> Upcast for T {}

// ─────────────────────────── strings in and out ─────────────────────────────

objc_class!(pub struct NSString: NSObject = "NSString");
objc_methods! { impl NSString {
    pub fn length(&self) -> usize = "length";
}}

/// Text to turn into an `NSString` without transcoding first: JavaScript
/// strings arrive as Latin-1 or UTF-16, Rust literals as UTF-8.
#[derive(Clone, Copy, Debug)]
pub enum NsStr<'a> {
    Latin1(&'a [u8]),
    Utf16(&'a [u16]),
    Utf8(&'a str),
}

impl NsStr<'_> {
    pub fn is_empty(&self) -> bool {
        match self {
            NsStr::Latin1(b) => b.is_empty(),
            NsStr::Utf16(w) => w.is_empty(),
            NsStr::Utf8(s) => s.is_empty(),
        }
    }
}

impl<'a> From<&'a str> for NsStr<'a> {
    fn from(s: &'a str) -> Self {
        NsStr::Utf8(s)
    }
}

/// `kCFStringEncodingUTF8` / `kCFStringEncodingISOLatin1`.
const UTF8: u32 = 0x0800_0100;
const LATIN1: u32 = 0x0201;

impl NSString {
    /// A new string with these contents.
    pub(crate) fn from_str(s: NsStr<'_>) -> NSString {
        let cf = &rt().cf;
        // SAFETY: CFStringCreate* copy the buffer; slice lengths fit isize.
        let raw = unsafe {
            match s {
                NsStr::Latin1(b) => (cf.CFStringCreateWithBytes)(
                    ptr::null(),
                    b.as_ptr(),
                    b.len() as isize,
                    LATIN1,
                    Bool::NO,
                ),
                NsStr::Utf8(b) => (cf.CFStringCreateWithBytes)(
                    ptr::null(),
                    b.as_ptr(),
                    b.len() as isize,
                    UTF8,
                    Bool::NO,
                ),
                NsStr::Utf16(w) => {
                    (cf.CFStringCreateWithCharacters)(ptr::null(), w.as_ptr(), w.len() as isize)
                }
            }
        };
        // SAFETY: Create rule (+1); NULL only on allocation failure since
        // `&str` rules out invalid UTF-8.
        match unsafe { Id::from_retained(raw) } {
            // SAFETY: a CFString is an NSString.
            Some(id) => unsafe { <NSString as Object>::from_id(id) },
            None => super::nil_from_nonnull("CFStringCreateWithBytes/Characters", "+1"),
        }
    }

    /// The contents as UTF-16 code units.
    pub(crate) fn to_utf16(&self) -> Vec<u16> {
        let cf = &rt().cf;
        // SAFETY: self is a live NSString (toll-free bridged CFString).
        unsafe {
            let len = (cf.CFStringGetLength)(self.as_obj());
            if len <= 0 {
                return Vec::new();
            }
            let fast = (cf.CFStringGetCharactersPtr)(self.as_obj());
            if !fast.is_null() {
                return core::slice::from_raw_parts(fast, len as usize).to_vec();
            }
            let mut buf = vec![0u16; len as usize];
            (cf.CFStringGetCharacters)(
                self.as_obj(),
                super::CFRange {
                    location: 0,
                    length: len,
                },
                buf.as_mut_ptr(),
            );
            buf
        }
    }

    pub(crate) fn to_string_lossy(&self) -> String {
        String::from_utf16_lossy(&self.to_utf16())
    }
}

impl From<&str> for NSString {
    fn from(s: &str) -> NSString {
        NSString::from_str(NsStr::Utf8(s))
    }
}

// ───────────────────────────── collections ─────────────────────────────────

objc_class!(pub struct NSArray: NSObject = "NSArray");
objc_methods! { impl NSArray {
    pub fn empty() -> NSArray = "array";
    pub fn count(&self) -> usize = "count";
    /// Raises NSRangeException out of range; callers bounds-check first.
    fn object_at(&self, index: usize) -> NSObject = "objectAtIndex:";
    /// `NSNotFound` when absent.
    fn index_of(&self, object: &NSObject) -> usize = "indexOfObject:";
    pub fn copy(&self) -> Retained<NSArray> = "copy";
}}

/// `NSNotFound`.
const NS_NOT_FOUND: usize = isize::MAX as usize;

impl NSArray {
    pub(crate) fn get(&self, index: usize) -> Option<NSObject> {
        (index < self.count()).then(|| self.object_at(index))
    }

    pub(crate) fn position(&self, object: &NSObject) -> Option<usize> {
        let i = self.index_of(object);
        (i != NS_NOT_FOUND).then_some(i)
    }

    /// Iterates a snapshot (`-copy` is an O(1) retain on immutable arrays),
    /// so the loop body may mutate a live array such as `-windows` or
    /// `-constraints`.
    pub(crate) fn iter(&self) -> impl Iterator<Item = NSObject> + use<> {
        let snapshot = self.copy();
        (0..snapshot.count()).map(move |i| snapshot.object_at(i))
    }
}

objc_class!(pub struct NSMutableArray: NSArray = "NSMutableArray");
objc_methods! { impl NSMutableArray {
    pub fn with_capacity(capacity: usize) -> NSMutableArray = "arrayWithCapacity:";
    pub fn add(&self, object: &NSObject) = "addObject:";
}}

objc_class!(pub struct NSDictionary: NSObject = "NSDictionary");
objc_methods! { impl NSDictionary {
    pub fn all_keys(&self) -> NSArray = "allKeys";
    pub fn get(&self, key: &NSObject) -> Option<NSObject> = "objectForKey:";
}}

objc_class!(pub struct NSMutableDictionary: NSDictionary = "NSMutableDictionary");
objc_methods! { impl NSMutableDictionary {
    pub fn with_capacity(capacity: usize) -> NSMutableDictionary = "dictionaryWithCapacity:";
    pub fn insert(&self, object: &NSObject, key: &NSObject) = "setObject:forKey:";
}}

objc_class!(pub struct NSNull: NSObject = "NSNull");
objc_methods! { impl NSNull {
    pub fn null() -> NSNull = "null";
}}
objc_global!(pub(crate) fn default_run_loop_mode() -> NSString = "NSDefaultRunLoopMode");
objc_global!(pub(crate) fn common_run_loop_modes() -> NSString = "NSRunLoopCommonModes");

objc_class!(pub struct NSDate: NSObject = "NSDate");
objc_methods! { impl NSDate {
    pub fn distant_past() -> NSDate = "distantPast";
    pub fn distant_future() -> NSDate = "distantFuture";
    // pub fn seconds_from_now(seconds: f64) -> NSDate = "dateWithTimeIntervalSinceNow:";
}}

objc_class!(pub struct NSData: NSObject = "NSData");
objc_methods! { impl NSData {
    fn with_bytes_raw(bytes: Ptr, length: usize) -> NSData = "dataWithBytes:length:";
    fn bytes_raw(&self) -> Ptr = "bytes";
    pub fn length(&self) -> usize = "length";
}}

impl NSData {
    /// Copies `bytes` into a new NSData.
    pub(crate) fn from_bytes(bytes: &[u8]) -> NSData {
        NSData::with_bytes_raw(Ptr(bytes.as_ptr().cast()), bytes.len())
    }

    pub(crate) fn to_vec(&self) -> Vec<u8> {
        let len = self.length();
        let p = self.bytes_raw().0.cast::<u8>();
        if len == 0 || p.is_null() {
            return Vec::new();
        }
        // SAFETY: -bytes points at `length` readable bytes owned by self.
        unsafe { core::slice::from_raw_parts(p, len) }.to_vec()
    }
}

objc_class!(pub struct NSIndexSet: NSObject = "NSIndexSet");
objc_methods! { impl NSIndexSet {
    pub fn count(&self) -> usize = "count";
    /// `NSNotFound` when empty.
    fn first_index(&self) -> usize = "firstIndex";
    /// `NSNotFound` past the last.
    fn index_greater_than(&self, index: usize) -> usize = "indexGreaterThanIndex:";
    // pub fn contains(&self, index: usize) -> bool = "containsIndex:";
}}

impl NSIndexSet {
    pub(crate) fn to_vec(&self) -> Vec<usize> {
        let mut out = Vec::with_capacity(self.count());
        let mut i = self.first_index();
        while i != NS_NOT_FOUND {
            out.push(i);
            i = self.index_greater_than(i);
        }
        out
    }
}

objc_class!(pub struct NSMutableIndexSet: NSIndexSet = "NSMutableIndexSet");
objc_methods! { impl NSMutableIndexSet {
    pub fn new() -> Retained<NSMutableIndexSet> = "new";
    pub fn add(&self, index: usize) = "addIndex:";
}}

impl NSMutableIndexSet {
    pub(crate) fn from_slice(indexes: &[usize]) -> NSMutableIndexSet {
        let set = NSMutableIndexSet::new();
        for &i in indexes {
            set.add(i);
        }
        set
    }
}

objc_class!(pub struct NSNumber: NSObject = "NSNumber");
objc_methods! { impl NSNumber {
    pub fn with_f64(value: f64) -> NSNumber = "numberWithDouble:";
    pub fn with_i64(value: i64) -> NSNumber = "numberWithLongLong:";
    /// The two results are the shared `kCFBooleanTrue` / `kCFBooleanFalse`.
    pub fn with_bool(value: bool) -> NSNumber = "numberWithBool:";
    pub fn f64_value(&self) -> f64 = "doubleValue";
}}

// ───────────────────────────── invocations ─────────────────────────────────

objc_class!(pub struct NSMethodSignature: NSObject = "NSMethodSignature");
objc_methods! { impl NSMethodSignature {
    /// Counts `self` and `_cmd`.
    pub fn number_of_arguments(&self) -> usize = "numberOfArguments";
    /// Raises out of range; callers stay below `number_of_arguments`.
    pub(crate) fn argument_type_at(&self, index: usize) -> CChars = "getArgumentTypeAtIndex:";
    pub(crate) fn method_return_type(&self) -> CChars = "methodReturnType";
    pub fn method_return_length(&self) -> usize = "methodReturnLength";
}}

objc_class!(pub struct NSInvocation: NSObject = "NSInvocation");
objc_methods! { impl NSInvocation {
    pub fn with_method_signature(signature: &NSMethodSignature) -> NSInvocation = "invocationWithMethodSignature:";
    pub(crate) fn set_selector(&self, sel: Sel) = "setSelector:";
    /// Copies the argument in from `location`, sized by the signature's type at `index`.
    pub(super) fn set_argument_raw(&self, location: Ptr, index: isize) = "setArgument:atIndex:";
    pub fn invoke_with_target(&self, target: &NSObject) = "invokeWithTarget:";
    /// Writes `methodReturnLength` bytes to `location`.
    pub(super) fn get_return_value_raw(&self, location: Ptr) = "getReturnValue:";
}}
objc_class!(pub struct NSProcessInfo: NSObject = "NSProcessInfo");
objc_methods! { impl NSProcessInfo {
    pub fn process_info() -> NSProcessInfo = "processInfo";
    pub fn process_name(&self) -> NSString = "processName";
    /// `options` is `NSActivityOptions`; keep the returned token alive for as long as the activity lasts.
    pub fn begin_activity(&self, options: u64, reason: &NSString) -> NSObject = "beginActivityWithOptions:reason:";
    pub fn end_activity(&self, activity: &NSObject) = "endActivity:";
}}

// objc_class!(pub struct NSException: NSObject = "NSException");
// objc_methods! { impl NSException {
//     pub fn name(&self) -> NSString = "name";
//     pub fn reason(&self) -> Option<NSString> = "reason";
// }}

objc_class!(pub struct NSError: NSObject = "NSError");
objc_methods! { impl NSError {
    pub fn localized_description(&self) -> NSString = "localizedDescription";
    // pub fn code(&self) -> isize = "code";
    // pub fn domain(&self) -> NSString = "domain";
}}

// objc_class!(pub struct NSURL: NSObject = "NSURL");
// objc_methods! { impl NSURL {
// pub fn file_url(path: &NSString) -> NSURL = "fileURLWithPath:";
// pub fn path(&self) -> Option<NSString> = "path";
// }}
