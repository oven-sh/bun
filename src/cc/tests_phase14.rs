//! Phase 14: Microsoft's bit-field layout.

use crate::tests::{LINUX_X64, WINDOWS_X64, checked_for, error_for, has};
use crate::{compile, disassemble};

/// The family of `test/js/bun/ffi/bir/fixtures/bitfields/microsoft-bit-field-family.c`.
const FAMILY: &str = "typedef int int32_t;
enum small { ZERO, ONE, TWO, THREE };

// Neighbours share a storage unit when their types have one size, whatever the types are.
struct MS same_type { int a : 3; int b : 4; int c : 25; int d : 1; };
struct MS same_size { unsigned char a : 1; _Bool b : 1; signed char c : 6; char d : 1; };
struct MS signed_and_unsigned { int a : 10; unsigned b : 10; enum small c : 10; int32_t d : 3; };
// A type of another size starts a unit, aligned for it.
struct MS sizes_change { signed char a : 3; int b : 4; char c : 2; short d : 5; short e : 11; long long f : 1; };
struct MS narrow_then_wide { signed char a : 1; long long b : 1; signed char c : 1; };
struct MS does_not_fit { int a : 30; int b : 4; int c : 28; int d : 4; };
struct MS whole_units { char a : 8; short b : 16; int c : 32; long long d : 64; };
struct MS after_members { char c; int a : 3; char d; short b : 3; int e; long long f : 5; };
struct MS then_members { int a : 3; char c; int b : 3; short d; };
// A zero-width bit-field ends the unit of the bit-field before it, and is nothing anywhere else.
struct MS zero_width { int a : 3; int : 0; int b : 3; };
struct MS zero_width_of_another_type { int a : 3; char : 0; int b : 3; short c : 1; long long : 0; short d : 1; };
struct MS zero_width_after_a_member { char c; int : 0; char d; long long : 0; char e; };
struct MS zero_width_first { int : 0; char c; };
struct MS zero_width_twice { char a : 1; int : 0; long long : 0; char b : 1; };
struct MS zero_width_last { char a : 1; long long : 0; };
struct MS unnamed_bits { int a : 3; int : 7; int b : 3; char : 3; char c : 2; };
// Unions: each bit-field is a whole unit at the start, and adds nothing to the alignment.
union MS only_bits { int a : 3; char b : 2; };
union MS wide_bits { char c; long long a : 3; };
union MS bits_and_members { short s; int a : 17; char b : 2; };
union MS zero_width_in_a_union { char a : 3; int : 0; };
// #pragma pack limits the alignment of a unit, not its size.
#pragma pack(push, 1)
struct MS packed_to_1 { char c; int a : 3; int b : 4; short d : 3; long long e : 40; signed char f : 1; };
struct MS packed_to_1_with_zero_width { char c; int a : 3; int : 0; char d; };
#pragma pack(pop)
#pragma pack(push, 2)
struct MS packed_to_2 { char c; int a : 3; long long b : 4; char d : 3; int e; };
#pragma pack(pop)
#pragma pack(push, 4)
struct MS packed_to_4 { char c; long long a : 3; char d; long long b : 60; long long e : 5; };
#pragma pack(pop)
#pragma pack(push, 8)
struct MS packed_to_8 { char c; long long a : 3; short b : 3; };
#pragma pack(pop)
// An alignment written on a bit-field is that of its unit.
struct MS aligned_bits { char c; char a : 3 __attribute__((aligned(4))); char b : 3; };
struct MS aligned_whole { char a : 3; int b : 3; } __attribute__((aligned(16)));
// Inside other things.
struct MS outer { char c; struct same_size inner; struct sizes_change more; short s : 3; };
struct MS array_of { struct narrow_then_wide three[3]; char last : 1; };
struct MS anonymous { int a : 3; struct MS { int b : 3; char c : 3; }; union MS { int d : 5; short e; }; int f : 3; };
// The System V layout, asked for by name: what these structures are without MS, and on Windows what MinGW's GCC
// gives for the attribute. (Clang does not know it.)
struct __attribute__((gcc_struct)) the_other_layout { char a : 3; int b : 4; char c : 2; short d : 5; long long e : 1; };

";

/// Its sizes and alignments in Clang's record layouts for x86_64-pc-windows-msvc.
const SIZES: &str = "_Static_assert(sizeof(struct narrow_then_wide) == 24 && _Alignof(struct narrow_then_wide) == 8, \"narrow_then_wide\");
_Static_assert(sizeof(struct same_type) == 8 && _Alignof(struct same_type) == 4, \"same_type\");
_Static_assert(sizeof(struct same_size) == 2 && _Alignof(struct same_size) == 1, \"same_size\");
_Static_assert(sizeof(struct signed_and_unsigned) == 8 && _Alignof(struct signed_and_unsigned) == 4, \"signed_and_unsigned\");
_Static_assert(sizeof(struct sizes_change) == 24 && _Alignof(struct sizes_change) == 8, \"sizes_change\");
_Static_assert(sizeof(struct does_not_fit) == 12 && _Alignof(struct does_not_fit) == 4, \"does_not_fit\");
_Static_assert(sizeof(struct whole_units) == 16 && _Alignof(struct whole_units) == 8, \"whole_units\");
_Static_assert(sizeof(struct after_members) == 24 && _Alignof(struct after_members) == 8, \"after_members\");
_Static_assert(sizeof(struct then_members) == 16 && _Alignof(struct then_members) == 4, \"then_members\");
_Static_assert(sizeof(struct zero_width) == 8 && _Alignof(struct zero_width) == 4, \"zero_width\");
_Static_assert(sizeof(struct zero_width_of_another_type) == 24 && _Alignof(struct zero_width_of_another_type) == 8, \"zero_width_of_another_type\");
_Static_assert(sizeof(struct zero_width_after_a_member) == 3 && _Alignof(struct zero_width_after_a_member) == 1, \"zero_width_after_a_member\");
_Static_assert(sizeof(struct zero_width_first) == 1 && _Alignof(struct zero_width_first) == 1, \"zero_width_first\");
_Static_assert(sizeof(struct zero_width_twice) == 8 && _Alignof(struct zero_width_twice) == 4, \"zero_width_twice\");
_Static_assert(sizeof(struct zero_width_last) == 8 && _Alignof(struct zero_width_last) == 8, \"zero_width_last\");
_Static_assert(sizeof(struct unnamed_bits) == 8 && _Alignof(struct unnamed_bits) == 4, \"unnamed_bits\");
_Static_assert(sizeof(union only_bits) == 4 && _Alignof(union only_bits) == 1, \"only_bits\");
_Static_assert(sizeof(union wide_bits) == 8 && _Alignof(union wide_bits) == 1, \"wide_bits\");
_Static_assert(sizeof(union bits_and_members) == 4 && _Alignof(union bits_and_members) == 2, \"bits_and_members\");
_Static_assert(sizeof(union zero_width_in_a_union) == ZERO_WIDTH_UNION && _Alignof(union zero_width_in_a_union) == 1, \"zero_width_in_a_union\");
_Static_assert(sizeof(struct packed_to_1) == 16 && _Alignof(struct packed_to_1) == 1, \"packed_to_1\");
_Static_assert(sizeof(struct packed_to_1_with_zero_width) == PACKED_ZERO_WIDTH && _Alignof(struct packed_to_1_with_zero_width) == PACKED_ZERO_WIDTH_ALIGN, \"packed_to_1_with_zero_width\");
_Static_assert(sizeof(struct packed_to_2) == 20 && _Alignof(struct packed_to_2) == 2, \"packed_to_2\");
_Static_assert(sizeof(struct packed_to_4) == 32 && _Alignof(struct packed_to_4) == 4, \"packed_to_4\");
_Static_assert(sizeof(struct packed_to_8) == 24 && _Alignof(struct packed_to_8) == 8, \"packed_to_8\");
_Static_assert(sizeof(struct aligned_bits) == 8 && _Alignof(struct aligned_bits) == 4, \"aligned_bits\");
_Static_assert(sizeof(struct aligned_whole) == 16 && _Alignof(struct aligned_whole) == 16, \"aligned_whole\");
_Static_assert(sizeof(struct outer) == 40 && _Alignof(struct outer) == 8, \"outer\");
_Static_assert(sizeof(struct array_of) == 80 && _Alignof(struct array_of) == 8, \"array_of\");
_Static_assert(sizeof(struct anonymous) == 20 && _Alignof(struct anonymous) == 4, \"anonymous\");";

#[test]
fn microsoft_bit_fields_on_windows() {
    // (`gcc_struct` is GCC's: Clang ignores it.)
    let windows = "#define MS\n#define ZERO_WIDTH_UNION 4\n#define PACKED_ZERO_WIDTH 6\n#define PACKED_ZERO_WIDTH_ALIGN 1\n";
    checked_for(&format!("{windows}{FAMILY}\n{SIZES}"), WINDOWS_X64);
    // The same family with the attribute, on a target that does not have the layout by itself,
    // differs in the two places Clang's `ms_struct` differs from its Microsoft layout.
    let elsewhere = "#define MS __attribute__((ms_struct))\n#define ZERO_WIDTH_UNION 1\n#define PACKED_ZERO_WIDTH 8\n#define PACKED_ZERO_WIDTH_ALIGN 4\n";
    checked_for(&format!("{elsewhere}{FAMILY}\n{SIZES}"), LINUX_X64);
    // Without it, it is not that layout.
    let e = error_for(&format!("{windows}{FAMILY}\n{SIZES}"), LINUX_X64);
    assert!(has(&e, "static assertion failed"), "{e}");
}

/// Where the bits are: each object has one member set to all ones.
#[test]
fn microsoft_bit_field_positions() {
    let source = "struct S { char c; int a : 3; short b : 4; int : 0; long long d : 40; unsigned char e : 1; };
         struct S a = {.a = -1}, b = {.b = -1}, d = {.d = -1}, e = {.e = 1};
         int size = sizeof(struct S), align = _Alignof(struct S);";
    // c at 0, a in an int at 4, b in a short at 8, d in a long long at 16, e in a char at 24.
    let windows = disassemble(&compile(source.as_bytes(), "t.c", WINDOWS_X64).expect("compiles"))
        .expect("valid");
    for line in [
        "000000: 00 00 00 00 07 00 00 00",
        "000020: 00 00 00 00 00 00 00 00 0f 00",
        "000050: ff ff ff ff ff 00 00 00",
        "000070: 00 00 00 00 00 00 00 00 01 00",
        "000080: 20 00 00 00 08",
    ] {
        assert!(has(&windows, line), "{line}\n{windows}");
    }
    // The System V layout packs them all into the first eight bytes but d.
    let linux = disassemble(&compile(source.as_bytes(), "t.c", LINUX_X64).expect("compiles"))
        .expect("valid");
    assert!(has(&linux, "000000: 00 07 00 00"), "{linux}");
    // `#pragma ms_struct` and the attributes choose per structure.
    let chosen = "#pragma ms_struct on
         struct P { char a : 3; int b : 4; };
         struct __attribute__((gcc_struct)) G { char a : 3; int b : 4; };
         #pragma ms_struct off
         struct N { char a : 3; int b : 4; };
         struct __attribute__((ms_struct)) M { char a : 3; int b : 4; };
         _Static_assert(sizeof(struct P) == 8 && sizeof(struct G) == 4 && sizeof(struct N) == 4 && sizeof(struct M) == 8, \"\");";
    checked_for(chosen, LINUX_X64);
    let on_windows = "struct N { char a : 3; int b : 4; };
         struct __attribute__((gcc_struct)) G { char a : 3; int b : 4; };
         enum E { A, B, C, D };
         struct V { enum E e : 2; int i : 2; unsigned u : 2; } v = {D, 3, 3};
         _Static_assert(sizeof(struct N) == 8 && sizeof(struct G) == 4, \"\");
         int negative(void) { return v.e < 0 && v.i < 0 && v.u == 3; }";
    checked_for(on_windows, WINDOWS_X64);
}
