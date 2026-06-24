// Layout-assert proof-of-concept for the 5 N-API `#[repr(C)]` POD structs
// flagged in Phase-4 finding F-10-2 / EXP-054.
//
// PROPOSED INSERTION SITE: `src/runtime/napi/napi_body.rs` (end of file).
// Pattern follows `src/libuv_sys/libuv.rs:3480-3523` (74 asserts cross-validated
// against runtime `uv_*_size()` reflection).
//
// Rationale (Phase-4 F-10-2): the 5 NAPI POD structs live at the public Bun ↔
// native-addon ABI boundary. The C headers (`js_native_api_types.h`,
// `node_api_types.h`, `node_api.h`) are the contract; the Rust ports in
// `napi_body.rs` are hand-transcribed. A field reorder, padding change, or
// `c_int` width drift (Windows long vs Linux long) silently breaks every
// shipped addon. These asserts fire at *compile time*.
//
// SIZE NUMBERS BELOW are computed for the 64-bit Linux/macOS ABI
// (sizeof(int) = 4, sizeof(long) = 8, pointers = 8). The bun_libuv_sys
// gold-standard scopes these under
// `#[cfg(all(target_arch = "x86_64", target_os = "windows"))]`; here we
// scope them under x86_64 + (linux | macos). Windows-side asserts (where
// `c_uint` matches but pointer alignment differs only on 32-bit) can be
// added in a follow-up.
//
// CROSS-REFERENCE — header definitions (verbatim from this audit):
//   napi_property_descriptor   → js_native_api_types.h:107-119
//   napi_extended_error_info   → js_native_api_types.h:121-126
//   napi_type_tag              → js_native_api_types.h:150-153
//   napi_node_version          → node_api_types.h:34-39
//   struct napi_module         → node_api.h:34-42
//
// Rust definitions audited (matching field order/types):
//   napi_property_descriptor   → src/runtime/napi/napi_body.rs:512-522
//   napi_extended_error_info   → src/runtime/napi/napi_body.rs:524-530
//   napi_type_tag              → src/runtime/napi/napi_body.rs:536-540
//   napi_node_version          → src/runtime/napi/napi_body.rs:1985-1991
//   struct_napi_module         → src/runtime/napi/napi_body.rs:2032-2041

#[cfg(all(target_arch = "x86_64", any(target_os = "linux", target_os = "macos")))]
const _: () = {
    use core::mem;

    macro_rules! assert_size {
        ($t:ty, $n:expr) => {
            assert!(
                mem::size_of::<$t>() == $n,
                concat!("layout drift: sizeof(", stringify!($t), ")")
            );
        };
    }
    macro_rules! assert_offset {
        ($t:ty, $f:ident, $n:expr) => {
            assert!(
                mem::offset_of!($t, $f) == $n,
                concat!(
                    "layout drift: offsetof(",
                    stringify!($t),
                    ".",
                    stringify!($f),
                    ")"
                )
            );
        };
    }
    macro_rules! assert_align {
        ($t:ty, $n:expr) => {
            assert!(
                mem::align_of::<$t>() == $n,
                concat!("layout drift: alignof(", stringify!($t), ")")
            );
        };
    }

    // ── napi_property_descriptor ───────────────────────────────────────────
    // Layout (LP64):
    //   utf8name   ptr   @ 0   (8B)
    //   name       ptr   @ 8   (8B)         // napi_value is opaque ptr
    //   method     ptr   @ 16  (8B)         // Option<fn> niche-optimized to ptr
    //   getter     ptr   @ 24  (8B)
    //   setter     ptr   @ 32  (8B)
    //   value      ptr   @ 40  (8B)
    //   attributes c_int @ 48  (4B)         // napi_property_attributes = c_uint
    //   <4B pad>   @ 52
    //   data       ptr   @ 56  (8B)
    //   total = 64
    assert_size!(napi_property_descriptor, 64);
    assert_align!(napi_property_descriptor, 8);
    assert_offset!(napi_property_descriptor, utf8name, 0);
    assert_offset!(napi_property_descriptor, name, 8);
    assert_offset!(napi_property_descriptor, method, 16);
    assert_offset!(napi_property_descriptor, getter, 24);
    assert_offset!(napi_property_descriptor, setter, 32);
    assert_offset!(napi_property_descriptor, value, 40);
    assert_offset!(napi_property_descriptor, attributes, 48);
    assert_offset!(napi_property_descriptor, data, 56);

    // ── napi_extended_error_info ───────────────────────────────────────────
    // Layout (LP64):
    //   error_message      ptr  @ 0   (8B)
    //   engine_reserved    ptr  @ 8   (8B)
    //   engine_error_code  u32  @ 16  (4B)
    //   error_code         enum @ 20  (4B)  // napi_status = c_uint
    //   total = 24
    assert_size!(napi_extended_error_info, 24);
    assert_align!(napi_extended_error_info, 8);
    assert_offset!(napi_extended_error_info, error_message, 0);
    assert_offset!(napi_extended_error_info, engine_reserved, 8);
    assert_offset!(napi_extended_error_info, engine_error_code, 16);
    assert_offset!(napi_extended_error_info, error_code, 20);

    // ── napi_type_tag ──────────────────────────────────────────────────────
    // Layout (LP64):
    //   lower  u64  @ 0  (8B)
    //   upper  u64  @ 8  (8B)
    //   total = 16
    assert_size!(napi_type_tag, 16);
    assert_align!(napi_type_tag, 8);
    // NOTE: napi_type_tag fields are currently `pub(crate)` not `pub`.
    // assert_offset! requires the field be name-visible; if upstreamed,
    // either bump visibility or rely on size+align alone (still catches
    // any field reorder because lower/upper are both u64).

    // ── napi_node_version ──────────────────────────────────────────────────
    // Layout (LP64):
    //   major    u32  @ 0   (4B)
    //   minor    u32  @ 4   (4B)
    //   patch    u32  @ 8   (4B)
    //   <4B pad> @ 12        // c_char* on 8B align forces tail pad here
    //   release  ptr  @ 16  (8B)
    //   total = 24
    assert_size!(napi_node_version, 24);
    assert_align!(napi_node_version, 8);
    assert_offset!(napi_node_version, major, 0);
    assert_offset!(napi_node_version, minor, 4);
    assert_offset!(napi_node_version, patch, 8);
    assert_offset!(napi_node_version, release, 16);

    // ── struct_napi_module ─────────────────────────────────────────────────
    // Layout (LP64):
    //   nm_version      c_int  @ 0   (4B)
    //   nm_flags        c_uint @ 4   (4B)
    //   nm_filename     ptr    @ 8   (8B)
    //   nm_register_func fn-ptr @ 16 (8B)
    //   nm_modname      ptr    @ 24  (8B)
    //   nm_priv         ptr    @ 32  (8B)
    //   reserved[4]     ptr    @ 40  (32B)
    //   total = 72
    assert_size!(struct_napi_module, 72);
    assert_align!(struct_napi_module, 8);
    assert_offset!(struct_napi_module, nm_version, 0);
    assert_offset!(struct_napi_module, nm_flags, 4);
    assert_offset!(struct_napi_module, nm_filename, 8);
    assert_offset!(struct_napi_module, nm_register_func, 16);
    assert_offset!(struct_napi_module, nm_modname, 24);
    assert_offset!(struct_napi_module, nm_priv, 32);
    assert_offset!(struct_napi_module, reserved, 40);
};

// ── Cross-validation work still required before merging upstream ────────────
//
// The size/offset values above are derived analytically from the C headers
// + the System V AMD64 ABI padding rules. Before landing in `napi_body.rs`,
// they must be cross-validated by compiling a tiny C program against the
// real `js_native_api_types.h` / `node_api_types.h` / `node_api.h` and
// printing sizeof + offsetof for each struct. Template (`scripts/napi_layout_dump.c`):
//
//   #include "src/runtime/napi/node_api.h"
//   #include <stdio.h>
//   #include <stddef.h>
//   int main(void) {
//       printf("napi_property_descriptor size=%zu align=%zu\n",
//           sizeof(napi_property_descriptor), _Alignof(napi_property_descriptor));
//       printf("  utf8name=%zu name=%zu method=%zu getter=%zu setter=%zu\n",
//           offsetof(napi_property_descriptor, utf8name),
//           offsetof(napi_property_descriptor, name),
//           offsetof(napi_property_descriptor, method),
//           offsetof(napi_property_descriptor, getter),
//           offsetof(napi_property_descriptor, setter));
//       printf("  value=%zu attributes=%zu data=%zu\n",
//           offsetof(napi_property_descriptor, value),
//           offsetof(napi_property_descriptor, attributes),
//           offsetof(napi_property_descriptor, data));
//       // ... napi_extended_error_info, napi_type_tag, napi_node_version,
//       //     napi_module
//       return 0;
//   }
//
// Run on x86_64 Linux + macOS + Windows (MSVC). If MSVC's c_int packing
// produces a different `napi_property_descriptor` size, gate the Windows
// asserts in their own `#[cfg(target_os = "windows")]` block with the
// MSVC-observed numbers.
//
// Once cross-validated, this PoC is ready to be applied as a single-file
// patch to `src/runtime/napi/napi_body.rs`.
