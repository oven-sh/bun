use bun_semver::{ExternalString, String};
use bun_wyhash::Wyhash11;

// TODO(port): lifetime — PORTING.md says "no lifetime param on struct for []const u8 fields",
// but SlicedString is purely a borrowed (ptr+len) view used for offset arithmetic into a
// backing buffer; Box/&'static/raw are all wrong here. Phase B: confirm `'a` threading or
// swap to raw `*const [u8]` if borrowck fights at call sites.
#[derive(Copy, Clone)]
pub struct SlicedString<'a> {
    pub buf: &'a [u8],
    pub slice: &'a [u8],
}

impl<'a> SlicedString<'a> {
    #[inline]
    pub fn init(buf: &'a [u8], slice: &'a [u8]) -> SlicedString<'a> {
        if cfg!(debug_assertions) {
            if (buf.as_ptr() as usize) > (slice.as_ptr() as usize) {
                panic!("SlicedString.init buf is not in front of slice");
            }
        }
        SlicedString { buf, slice }
    }

    #[inline]
    pub fn external(self) -> ExternalString {
        debug_assert!(
            (self.buf.as_ptr() as usize) <= (self.slice.as_ptr() as usize)
                && ((self.slice.as_ptr() as usize) + self.slice.len())
                    <= ((self.buf.as_ptr() as usize) + self.buf.len())
        );

        ExternalString::init(self.buf, self.slice, Wyhash11::hash(0, self.slice))
    }

    #[inline]
    pub fn value(self) -> String {
        debug_assert!(
            (self.buf.as_ptr() as usize) <= (self.slice.as_ptr() as usize)
                && ((self.slice.as_ptr() as usize) + self.slice.len())
                    <= ((self.buf.as_ptr() as usize) + self.buf.len())
        );

        String::init(self.buf, self.slice)
    }

    #[inline]
    pub fn sub(self, input: &'a [u8]) -> SlicedString<'a> {
        if cfg!(debug_assertions) {
            if !bun_core::is_slice_in_buffer(input, self.buf) {
                let start_buf = self.buf.as_ptr() as usize;
                let end_buf = (self.buf.as_ptr() as usize) + self.buf.len();
                let start_i = input.as_ptr() as usize;
                let end_i = (input.as_ptr() as usize) + input.len();

                bun_core::output::panic(format_args!(
                    concat!(
                        "SlicedString.sub input [{}, {}) is not a substring of the ",
                        "slice [{}, {})"
                    ),
                    start_i, end_i, start_buf, end_buf
                ));
            }
        }
        SlicedString { buf: self.buf, slice: input }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install_types/SlicedString.zig (53 lines)
//   confidence: medium
//   todos:      1
//   notes:      added <'a> lifetime (borrowed view struct); Phase B verify vs raw *const [u8]
// ──────────────────────────────────────────────────────────────────────────
