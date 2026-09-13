//! Tests for the volatile access bit, the returns-twice function flag, and the constructs
//! the library corpus needed.

use crate::tests::{LINUX_X64, checked, has};
use crate::{compile, disassemble};

fn count(text: &str, needle: &str) -> usize {
    (0..text.len())
        .filter(|&i| text[i..].starts_with(needle))
        .count()
}

fn function<'t>(text: &'t str, name: &str) -> &'t str {
    let header = format!(" {name}");
    let start = (0..text.len())
        .find(|&i| {
            text[i..].starts_with("\nfunc ")
                && text[i + 6..].split_once_line().contains_name(&header)
        })
        .unwrap_or_else(|| panic!("no function {name} in\n{text}"));
    let rest = &text[start + 1..];
    let end = (1..rest.len())
        .find(|&i| rest[i..].starts_with("\nfunc "))
        .unwrap_or(rest.len());
    &rest[..end]
}

trait FirstLine {
    fn split_once_line(&self) -> &str;
}

impl FirstLine for str {
    fn split_once_line(&self) -> &str {
        let end = (0..self.len())
            .find(|&i| self.as_bytes()[i] == 10)
            .unwrap_or(self.len());
        &self[..end]
    }
}

trait ContainsName {
    fn contains_name(&self, name: &str) -> bool;
}

impl ContainsName for str {
    fn contains_name(&self, name: &str) -> bool {
        has(self, &format!("{name} ")) || has(self, &format!("{name}:"))
    }
}

#[test]
fn volatile_accesses_carry_the_bit() {
    let src = "typedef volatile int vint;
         struct device { int id; volatile unsigned status; unsigned ready : 1; unsigned code : 7; };
         vint global_flag;
         int plain_global;
         int through_pointer(int *p) { return *(volatile int *)p + *p; }
         void store_pointer(volatile short *p, short v) { *p = v; p[2] = v; }
         int typedefed(void) { vint local = 3; local++; return local + global_flag; }
         unsigned member(struct device *d) { d->id = 1; d->status |= 4; return d->status; }
         unsigned whole(volatile struct device *d) { d->id = 2; d->code = 5; return d->ready + d->id; }
         int pointer_itself(int *volatile *slot) { return **slot; }
         int not_volatile(struct device *d) { return d->id + plain_global; }
         int wait_for(volatile int *flag) { int spins = 0; while (!*flag) spins++; return spins; }";
    let bir = compile(src.as_bytes(), "t.c", LINUX_X64).unwrap_or_else(|d| panic!("{}", d[0]));
    // Load with kind I32 | 0x80; Store with kind I16U | 0x80.
    assert!(
        (0..bir.len()).any(|i| bir[i..].starts_with(&[0x40, 0x84])),
        "{bir:?}"
    );
    assert!(
        (0..bir.len()).any(|i| bir[i..].starts_with(&[0x41, 0x83])),
        "{bir:?}"
    );
    let text = disassemble(&bir).unwrap();
    let f = function(&text, "through_pointer");
    assert_eq!(
        (count(f, "Load volatile i32"), count(f, "Load i32")),
        (1, 1),
        "{f}"
    );
    let f = function(&text, "store_pointer");
    assert_eq!(count(f, "Store volatile i16u"), 2, "{f}");
    let f = function(&text, "typedefed");
    assert!(
        count(f, "Load volatile i32") >= 3
            && count(f, "Store volatile i32") >= 1
            && has(f, "slot 0"),
        "{f}"
    );
    let f = function(&text, "member");
    assert_eq!(
        (
            count(f, "Load volatile i32"),
            count(f, "Store volatile i32"),
            count(f, "Store i32")
        ),
        (2, 1, 1),
        "{f}"
    );
    // Every member of a volatile struct, bit-fields included: the container is loaded and stored volatile.
    let f = function(&text, "whole");
    assert_eq!(
        count(f, "Store i32") + count(f, "Load i32") + count(f, "Load i8u") + count(f, "Store i8u"),
        0,
        "{f}"
    );
    assert!(
        count(f, "Load volatile") >= 3 && count(f, "Store volatile") >= 2,
        "{f}"
    );
    let f = function(&text, "pointer_itself");
    assert_eq!(
        (count(f, "Load volatile i64"), count(f, "Load i32")),
        (1, 1),
        "{f}"
    );
    let f = function(&text, "not_volatile");
    assert_eq!(
        count(f, "Load volatile") + count(f, "Store volatile"),
        0,
        "{f}"
    );
    let f = function(&text, "wait_for");
    assert_eq!(count(f, "Load volatile i32"), 1, "{f}");
    crate::validate(&bir).unwrap();
    // The decoder keeps the bit.
    assert_eq!(disassemble(&bir).unwrap(), text);
    checked(src);
}

#[test]
fn setjmp_callers_are_flagged() {
    let bir = compile(
        b"typedef long jmp_buf[32]; int _setjmp(jmp_buf); void other(jmp_buf);
          int guarded(void) { jmp_buf env; if (_setjmp(env)) return 1; other(env); return 0; }
          int plain(void) { return 2; }
          static int helper(jmp_buf env) { return _setjmp(env); }
          int uses_helper(void) { jmp_buf env; return helper(env); }",
        "t.c",
        LINUX_X64,
    )
    .unwrap();
    // A declaration is the name, the signature index and the flags.
    let decl = |name: &[u8], flags: u8| -> Vec<Vec<u8>> {
        (0u8..4)
            .map(|sig| {
                let mut bytes = vec![name.len() as u8];
                bytes.extend_from_slice(name);
                bytes.push(sig);
                bytes.push(flags);
                bytes
            })
            .collect()
    };
    let contains = |needles: &[Vec<u8>]| {
        needles
            .iter()
            .any(|needle| (0..bir.len()).any(|i| bir[i..].starts_with(needle)))
    };
    // bit0 exported, bit1 calls a function that returns twice.
    assert!(contains(&decl(b"guarded", 3)), "{bir:?}");
    assert!(contains(&decl(b"plain", 1)), "{bir:?}");
    assert!(contains(&decl(b"helper", 2)), "{bir:?}");
    assert!(contains(&decl(b"uses_helper", 1)), "{bir:?}");
    crate::validate(&bir).unwrap();
}

#[test]
fn constructors_and_destructors_are_listed() {
    let src = "int order[8]; int n;
         static void last(void) __attribute__((constructor));
         static void last(void) { order[n++] = 3; }
         __attribute__((constructor(101))) static void first(void) { order[n++] = 1; }
         __attribute__((constructor(200))) void second(void) { order[n++] = 2; }
         __attribute__((destructor)) static void bye(void) { order[n++] = 9; }
         __attribute__((destructor(101))) static void bye_late(void) { order[n++] = 8; }
         static void unused(void) { order[0] = 7; }
         int main(void) { return n; }";
    let bir = compile(src.as_bytes(), "t.c", LINUX_X64).unwrap_or_else(|d| panic!("{}", d[0]));
    crate::validate(&bir).unwrap();
    let text = disassemble(&bir).unwrap();
    // Functions are numbered in source order: last 0, first 1, second 2, bye 3, bye_late 4,
    // main 5. Constructors: ascending priority, none given last; destructors the reverse.
    assert!(bir.ends_with(&[0, 3, 1, 2, 0, 2, 3, 4]), "{bir:?}\n{text}");
    assert!(
        has(
            &text,
            "constructor func 1 first\nconstructor func 2 second\nconstructor func 0 last\ndestructor func 3 bye\ndestructor func 4 bye_late"
        ),
        "{text}"
    );
    assert!(!has(&text, "unused"), "{text}");
    checked(src);
    // glibc hands constructors (argc, argv, envp); here they take none, through a
    // `void f(void)` function the loader can call.
    checked(
        "int seen = -1; __attribute__((constructor)) static int with_args(int argc, char **argv, char **envp) { seen = argc + (argv != 0) + (envp != 0); return 5; }
         int main(void) { return seen; }",
    );
    assert!(has(
        &crate::tests::error_for(
            "struct s { int x; }; __attribute__((constructor)) void bad(struct s v) { (void)v; }",
            LINUX_X64
        ),
        "a constructor must take and return scalars"
    ));
    // Across translation units: priority first, then unit order.
    let units: [(&[u8], &str); 2] = [
        (b"extern int log_[]; extern int n; __attribute__((constructor)) static void a(void) { log_[n++] = 1; }
           __attribute__((constructor(500))) static void b(void) { log_[n++] = 2; }", "a.c"),
        (b"int log_[4]; int n; __attribute__((constructor(300))) static void c(void) { log_[n++] = 3; }
           __attribute__((constructor)) static void d(void) { log_[n++] = 4; }
           int count(void) { return n; }", "b.c"),
    ];
    let linked = crate::compile_many(&units, &crate::CompileOptions::new(LINUX_X64))
        .unwrap_or_else(|d| panic!("{}", d[0]));
    let text = disassemble(&linked.bir).unwrap();
    assert!(
        has(
            &text,
            "constructor func 2 c\nconstructor func 1 b\nconstructor func 0 a\nconstructor func 3 d"
        ),
        "{text}"
    );
}

#[test]
fn old_style_definitions_and_unprototyped_calls() {
    let src = "int later();
         double scale();
         int narrow(c, f, s, p, n) char c; float f; short s; int *p; { return c + (int)(f * 2) + s + *p + n; }
         int call_narrow(void) { int x = 1000; return narrow('a' + 256, 1.5f, (short)70000, &x, 7); }
         int call_later(void) { char c = 5; float f = 2.5f; return later(c, f, 40000L); }
         int later(int a, double b, long c) { return a + (int)(b * 10) + (int)(c / 1000); }
         double call_scale(void) { return scale(3, 0.5f); }
         double scale(n, by) double by; { return n * by; }
         int through_pointer(void) { int (*fp)() = later; return fp(1, 2.0, 3000L); }
         int no_params() { return 9; }
         int call_no_params(void) { return no_params(); }";
    checked(src);
    let text = disassemble(&compile(src.as_bytes(), "t.c", LINUX_X64).unwrap()).unwrap();
    // An old-style function takes what callers without a prototype pass: promoted types.
    assert!(
        has(&text, "narrow (exported): sig")
            && has(
                function(&text, "narrow"),
                "(i32, f64, i32, i64, i32) -> i32"
            ),
        "{text}"
    );
    // The definition is known by the time code is generated: a direct call.
    assert!(has(function(&text, "call_later"), "= Call "), "{text}");
    // An extern without a prototype is called through a signature made of the arguments.
    let text = disassemble(
        &compile(
            b"int mystery(); int f(void) { return mystery(1, 2.5); }",
            "t.c",
            LINUX_X64,
        )
        .unwrap(),
    )
    .unwrap();
    assert!(
        has(&text, "ExternAddr") && has(&text, "CallIndirect"),
        "{text}"
    );
    assert!(has(
        &crate::tests::error_for("int f(a, b) int c; { return a; }", LINUX_X64),
        "'c' is not a parameter of the function"
    ));
}

#[test]
fn pragma_pack_and_push_macro() {
    let src = "#include <stddef.h>
         struct natural { char c; int i; short s; long long l; };
         #pragma pack(push, 1)
         struct one { char c; int i; short s; long long l; };
         #pragma pack(2)
         struct two { char c; int i; short s; long long l; };
         #pragma pack(push, 4)
         struct four { char c; long long l; int bits : 3; };
         #pragma pack(pop)
         struct two_again { char c; int i; };
         #pragma pack(pop)
         struct back { char c; int i; };
         _Pragma(\"pack(1)\") struct by_operator { char c; int i; }; _Pragma(\"pack()\")
         struct reset { char c; int i; };
         #pragma pack(8)
         struct capped_not_raised { char c; short s; };
         #pragma pack()
         int sizes[] = { sizeof(struct natural), sizeof(struct one), sizeof(struct two), sizeof(struct four),
                         sizeof(struct two_again), sizeof(struct back), sizeof(struct by_operator), sizeof(struct reset),
                         sizeof(struct capped_not_raised) };
         int offsets[] = { offsetof(struct one, i), offsetof(struct one, l), offsetof(struct two, i), offsetof(struct two, l),
                           offsetof(struct four, l), _Alignof(struct one), _Alignof(struct two), _Alignof(struct four) };
         int size(int i) { return sizes[i]; }
         int offset(int i) { return offsets[i]; }
         struct one global_one = { 1, 0x01020304, 5, 6 };
         int unaligned_read(void) { struct one *p = &global_one; return p->i + (int)p->l; }";
    checked(src);
    let macros = "#define X 1
         #pragma push_macro(\"X\")
         #undef X
         #define X 2
         int second = X;
         #pragma push_macro(\"X\")
         #undef X
         int third =
         #ifdef X
           100;
         #else
           3;
         #endif
         #pragma pop_macro(\"X\")
         int fourth = X;
         #pragma pop_macro(\"X\")
         int fifth = X;
         #pragma pop_macro(\"X\")
         int sixth = X;
         #pragma push_macro(\"NEVER\")
         #define NEVER 1
         #pragma pop_macro(\"NEVER\")
         #ifdef NEVER
         #error pop_macro must undefine a name that was not a macro
         #endif
         int sum(void) { return second * 1000 + third * 100 + fourth * 10 + fifth + sixth * 10000; }";
    checked(macros);
    // -E keeps the pragma the parser needs.
    let text = crate::preprocess(b"#pragma pack(push, 2)\nstruct s { int x; };\n#pragma pack(pop)\n#pragma omp parallel\nint y;", "t.c", &crate::CompileOptions::new(LINUX_X64)).unwrap();
    assert_eq!(
        text,
        "#pragma pack(push, 2)\nstruct s { int x; } ;\n#pragma pack(pop)\nint y;\n"
    );
    assert!(has(
        &crate::tests::error_for("#pragma pack(3)\nint x;", LINUX_X64),
        "#pragma pack expects 1, 2, 4, 8 or 16"
    ));
}

#[test]
fn bit_field_layout_and_promotion_match_gcc() {
    // From tcc's 95_bitfields.c; the layouts are what GCC produces.
    let src = "#include <stddef.h>
         struct t1 { unsigned x : 12; unsigned char y : 7; unsigned z : 28; unsigned a : 4; unsigned b : 5; };
         struct t2 { int x : 12; char y : 6; long long z : 63; char a : 4; long long b : 2; };
         struct __attribute__((packed)) p2 { int x : 12; char y : 6; long long z : 63; char a : 4; long long b : 2; };
         struct t3 { unsigned x : 5, y : 5, : 0, z : 5; char a : 5; short b : 5; };
         struct a3 { unsigned x : 5, y : 5, : 0, z : 5; char a : 5; __attribute__((aligned(16))) short b : 5; };
         #pragma pack(push, 1)
         struct k1 { unsigned x : 12; unsigned char y : 7; unsigned z : 28; unsigned a : 4; unsigned b : 5; };
         struct k6 { int a; signed char b; int x : 12, y : 4, : 0, : 4, z : 3; char d; };
         #pragma pack(pop)
         struct edge { char c; int x : 17; };
         int sizes[] = { sizeof(struct t1), sizeof(struct t2), sizeof(struct p2), sizeof(struct t3), sizeof(struct a3),
                         sizeof(struct k1), sizeof(struct k6), _Alignof(struct t2), _Alignof(struct p2), _Alignof(struct a3),
                         _Alignof(struct k6), sizeof(struct edge) };
         int size(int i) { return sizes[i]; }
         void fill(unsigned char *out, int which) {
             if (which == 1) { struct t1 s; __builtin_memset(&s, 0, sizeof s); s.x = -1; s.y = -1; s.z = -1; s.a = -1; s.b = -1; __builtin_memcpy(out, &s, sizeof s); }
             if (which == 2) { struct p2 s; __builtin_memset(&s, 0, sizeof s); s.x = 3; s.y = 30; s.z = 0x123456789abcdef0LL; s.a = 5; s.b = 2; __builtin_memcpy(out, &s, sizeof s); }
         }
         long long wide(void) { struct p2 s; s.x = -1; s.y = -1; s.a = -1; s.b = -1; s.z = 0x123456789abcdef0LL; s.z += 1; return s.z; }
         struct p2 initialized = { 3, 30, 0x123456789abcdef0LL, 5, -2 };
         long long from_data(void) { return initialized.z + initialized.b; }
         struct edge edges[2];
         int neighbour(void) { edges[1].c = 77; edges[0].x = -1; edges[0].c = 5; return edges[1].c * 100 + edges[0].c + (edges[0].x == -1); }
         struct promo { unsigned u31 : 31; unsigned u32 : 32; unsigned long ul31 : 31; unsigned long ul32 : 32; unsigned long long ull33 : 33; long long b : 2; } p;
         int promotions(void) {
             return (p.u31 - 100 < 0) * 100000 + (p.u32 - 100 < 0) * 10000 + (p.ul31 - 100 < 0) * 1000
                  + (p.ul32 - 100 < 0) * 100 + (p.ull33 - 100 < 0) * 10 + (sizeof(p.b + 0) == 4);
         }";
    checked(src);
    // Storing a 17-bit field that ends a struct writes three bytes, not four.
    let text = disassemble(
        &compile(
            b"struct edge { char c; int x : 17; }; void set(struct edge *e) { e->x = 1; }",
            "t.c",
            LINUX_X64,
        )
        .unwrap(),
    )
    .unwrap();
    let f = function(&text, "set");
    assert!(
        count(f, "Store i16u") == 1 && count(f, "Store i8u") == 1 && count(f, "Store i32") == 0,
        "{f}"
    );
}

#[test]
fn flexible_array_members_and_zero_length_arrays() {
    let src = "struct message { int length; char text[]; };
         struct message hello = { 5, \"hello\" };
         struct message listed = { 3, { 'a', 'b', 'c', 0 } };
         static struct message designated = { .text = { [3] = 'x' }, .length = 4 };
         struct numbers { char count; long long values[]; } numbers = { 2, { 10, 20 } };
         struct zero { int n; int tail[0]; };
         union either { int whole; char bytes[]; };
         struct only { int items[]; };
         int after = 77;
         int sizes(void) { return sizeof(struct message) * 1000 + sizeof hello * 100 + sizeof(struct zero) * 10 + sizeof(union either); }
         int read(void) { return hello.text[4] + listed.text[2] + designated.text[3] + designated.length + (int)numbers.values[1] + after; }
         int local_static(void) { static struct message m = { 1, \"xy\" }; return m.text[1] + m.length; }
         int through_zero(struct zero *z) { return z->tail[1]; }";
    checked(src);
    // The object grows by the initializer: 4 + 6 bytes for `hello`.
    let text = disassemble(&compile(b"struct message { int length; char text[]; }; struct message hello = { 5, \"hello\" }; int after = 1;", "t.c", LINUX_X64).unwrap()).unwrap();
    assert!(has(&text, "data: size 16"), "{text}");
    assert!(has(
        &crate::tests::error_for(
            "struct m { int n; char t[]; }; int f(void) { struct m x = { 1, \"a\" }; return x.n; }",
            LINUX_X64
        ),
        "can only be initialized in an object with static storage duration"
    ));
}

#[test]
fn range_designators_and_obsolete_spellings() {
    let src = "unsigned char classes[256] = { [0 ... 255] = 7, ['a' ... 'z'] = 1, ['0' ... '9'] = 2, ['_'] = 3 };
         struct cell { int kind; int value; };
         struct cell grid[2][3] = { [0 ... 1][1 ... 2] = { 4, 5 }, [1][0].value = 9 };
         struct cell old_style = { value: 8, kind: 2 };
         int spaced[4] = { [1] 10, [3] 30 };
         int class_of(int c) { return classes[c]; }
         int grid_sum(void) { int s = 0; for (int i = 0; i < 2; i++) for (int j = 0; j < 3; j++) s += grid[i][j].kind * 10 + grid[i][j].value; return s; }
         int local(int seed) { int table[8] = { [2 ... 5] = seed, [7] = 1 }; int s = 0; for (int i = 0; i < 8; i++) s = s * 3 + table[i]; return s; }
         int others(void) { return old_style.kind * 100 + old_style.value * 10 + spaced[1] + spaced[3] + spaced[0]; }";
    checked(src);
    assert!(has(
        &crate::tests::error_for("int a[4] = { [3 ... 1] = 0 };", LINUX_X64),
        "array range designator is empty"
    ));
    assert!(has(
        &crate::tests::error_for("int a[4] = { [1 ... 4] = 0 };", LINUX_X64),
        "exceeds the array bounds"
    ));
}

#[test]
fn aliases_are_other_names_for_the_target() {
    let src = "int calls;
         int target(int x) { calls++; return x + 1; }
         int also_target(int) __attribute__((alias(\"target\")));
         static int hidden(int) __attribute__((alias(\"target\")));
         int by_label(int) __asm__(\"target\");
         int counter = 34;
         extern int counter_alias __attribute__((alias(\"counter\")));
         int labelled __asm__(\"counter\");
         int use(void) { counter_alias += 1; labelled += 1; return also_target(1) + hidden(2) + by_label(3) + counter * 100 + calls * 1000; }
         int same_address(void) { return also_target == target && &counter_alias == &counter; }";
    checked(src);
    let bir = compile(src.as_bytes(), "t.c", LINUX_X64).unwrap();
    assert!(
        crate::export_names(&bir)
            .unwrap()
            .contains(&"also_target".to_string())
    );
    assert!(
        !crate::export_names(&bir)
            .unwrap()
            .contains(&"hidden".to_string())
    );
    assert!(has(
        &crate::tests::error_for(
            "void f(void) __attribute__((alias(\"nowhere\")));",
            LINUX_X64
        ),
        "alias target 'nowhere' must be a function declared earlier"
    ));
}

#[test]
fn builtins_the_libraries_use() {
    let src = "#include <stddef.h>
         #include <stdint.h>
         int add_u32(unsigned a, unsigned b) { unsigned r; int o = __builtin_add_overflow(a, b, &r); return o * 2 + (r == a + b); }
         int add_i32(int a, int b) { int r; return __builtin_sadd_overflow(a, b, &r) * 1000 + (r & 0xff); }
         int sub_i64(long a, long b) { long r; int o = __builtin_sub_overflow(a, b, &r); return o * 2 + (r == (long)((unsigned long)a - (unsigned long)b)); }
         int mul_size(size_t a, size_t b) { size_t r; int o = __builtin_mul_overflow(a, b, &r); return o * 2 + (r == a * b); }
         int mul_i64(long long a, long long b) { long long r; return __builtin_smulll_overflow(a, b, &r) * 2 + (r == (long long)((unsigned long long)a * (unsigned long long)b)); }
         int mixed(int a, unsigned long b) { unsigned char r; int o = __builtin_add_overflow(a, b, &r); return o * 1000 + r; }
         int mixed_sign(long long a, unsigned long long b) { long long r; return __builtin_sub_overflow(a, b, &r); }
         int into_wider(unsigned a, unsigned b) { unsigned long long r; return __builtin_mul_overflow(a, b, &r) * 2 + (r == (unsigned long long)a * b); }
         int calls; int next(void) { return ++calls; }
         int once(void) { int r; calls = 0; __builtin_add_overflow(next(), next(), &r); return calls * 10 + r; }
         unsigned rotl32(unsigned x, unsigned n) { return __builtin_rotateleft32(x, n); }
         unsigned long long rotr64(unsigned long long x, unsigned n) { return __builtin_rotateright64(x, n); }
         int rot8(int x, int n) { return __builtin_rotateleft8(x, n) * 1000 + __builtin_rotateright16(x, n); }
         int bits(unsigned x, unsigned long long y) { return __builtin_ffs(x) * 10000 + __builtin_ffsll(y) * 100 + __builtin_parity(x) * 10 + __builtin_parityll(y); }
         static char table[64] __attribute__((aligned(16)));
         long misc(char *p) {
             __builtin_prefetch(p); __builtin_prefetch(p + 64, 0, 3);
             char *q = __builtin_assume_aligned(table, 16);
             __builtin_cpu_init();
             __builtin_assume(p != 0);
             return (q == table) + (__builtin_object_size(p, 0) == (size_t)-1) * 2 + (__builtin_object_size(p, 2) == 0) * 4
                  + __builtin_cpu_supports(\"avx2\") * 8 + __builtin_choose_expr(sizeof(long) == 8, 16, table) + __builtin_unpredictable(p != 0) * 32;
         }
         size_t library(const char *s) { return __builtin_strlen(s) + (__builtin_strstr(s, \"lo\") - s) + __builtin_strspn(s, \"eh\"); }
         #if __has_builtin(__builtin_mul_overflow) && __has_builtin(__builtin_rotateleft32) && __has_builtin(__builtin_frame_address)
         int has(void) { return 1; }
         #endif";
    checked(src);
    assert!(has(
        &crate::tests::error_for(
            "int f(int a, _Bool *r) { return __builtin_add_overflow(a, a, r); }",
            LINUX_X64
        ),
        "needs integer operands of at most 64 bits, not '_Bool'"
    ));
}

#[test]
fn inline_assembly_that_needs_no_assembler() {
    let src = "static inline void relax(void) { __asm__ __volatile__(\"rep; nop\" ::: \"memory\"); }
         static inline void barrier(void) { __asm__ volatile(\"\" ::: \"memory\"); }
         static inline void hint(void) { asm(\"pause\"); }
         int spin(volatile int *flag) { int n = 0; while (!*flag && n < 3) { relax(); barrier(); hint(); n++; } return n; }
         typedef struct { unsigned a, b, c, d; } regs;
         regs identify(unsigned leaf) {
             regs r = { 1, 2, 3, 4 };
             __asm__(\"cpuid\" : \"=a\"(r.a), \"=b\"(r.b), \"=c\"(r.c), \"=d\"(r.d) : \"a\"(leaf), \"c\"(0));
             return r;
         }
         unsigned saved_rbx(void) { unsigned n = 9; __asm__(\"pushq %%rbx\\n\\tcpuid\\n\\tpopq %%rbx\\n\\t\" : \"=a\"(n) : \"a\"(0) : \"rcx\", \"rdx\"); return n; }
         unsigned long long xcr0(void) { unsigned lo = 7, hi = 7; __asm__(\".byte 0x0f, 0x01, 0xd0\" : \"=a\"(lo), \"=d\"(hi) : \"c\"(0)); return ((unsigned long long)hi << 32) | lo; }
         #include <cpuid.h>
         int from_header(void) { unsigned a = 5, b = 5, c = 5, d = 5; int ok = __get_cpuid(1, &a, &b, &c, &d); return ok * 100 + __get_cpuid_max(0, 0) * 10 + (a == 5); }
         unsigned moved(void) { unsigned f7b, f7c; __asm__(\"pushq %%rbx\\n\\tcpuid\\n\\tmovq %%rbx, %%rax\\n\\tpopq %%rbx\" : \"=a\"(f7b), \"=c\"(f7c) : \"a\"(7), \"c\"(0) : \"rdx\"); return f7b; }
         int exchanged(int info_type) { int info[4]; __asm__ volatile(\"mov %%ebx, %%edi\\n\" \"cpuid\\n\" \"xchg %%edi, %%ebx\\n\" : \"=a\"(info[0]), \"=D\"(info[1]), \"=c\"(info[2]), \"=d\"(info[3]) : \"a\"(info_type), \"c\"(0)); return info[1]; }
         int supports(void) { __builtin_cpu_init(); return __builtin_cpu_supports(\"sse2\") + __builtin_cpu_supports(\"bmi2\") * 2 + __builtin_cpu_supports(\"avx2\") * 4 + __builtin_cpu_supports(\"avx512f\") * 8; }";
    let output = crate::compile_with_warnings(
        src.as_bytes(),
        "t.c",
        &crate::CompileOptions::new(LINUX_X64),
    )
    .unwrap_or_else(|d| panic!("{}", d[0]));
    assert!(output.warnings.is_empty(), "{:?}", output.warnings.first());
    let text = disassemble(&output.bir).unwrap();
    assert_eq!(count(&text, "= CpuId"), 10, "{text}");
    // A memory clobber is a fence; the hints themselves are nothing.
    assert_eq!(count(&text, "Fence order"), 2, "{text}");
    assert_eq!(count(function(&text, "hint"), "Fence"), 0, "{text}");
    assert!(has(
        &crate::tests::error_for(
            "void f(void) { __asm__(\"cpuid\"); }",
            crate::tests::LINUX_ARM64
        ),
        "inline assembly is not supported yet ('cpuid')"
    ));
    assert!(has(
        &crate::tests::error_for(
            "int f(int x) { __asm__(\"frobnicate %0\" : \"+r\"(x)); return x; }",
            LINUX_X64
        ),
        "inline assembly: unsupported instruction 'frobnicate'"
    ));
    assert!(has(
        &crate::tests::error_for(
            "int f(void) { int x; __asm__(\"cpuid\" : \"=r\"(x) : \"a\"(0)); return x; }",
            LINUX_X64
        ),
        "an output of 'cpuid' that is not in a named register"
    ));
    // The validator knows the instruction only exists on x86-64.
    let mut module = crate::bir::Module::decode(&output.bir).unwrap();
    module.arch = 1;
    assert!(has(
        &crate::bir::validate(&module).unwrap_err(),
        "CpuId outside x86-64"
    ));
    assert!(has(
        &crate::tests::error_for("__asm__(\".globl x\");", LINUX_X64),
        "inline assembly is not supported yet"
    ));
}

#[test]
fn weak_symbols_and_frame_addresses() {
    let src = "__attribute__((weak)) int maybe(int); extern int missing_object __attribute__((weak));
         #pragma weak by_pragma
         void by_pragma(void);
         int weak_definition(void) __attribute__((weak));
         int weak_definition(void) { return 1; }
         extern int present;
         int f(void) { int n = 0; if (maybe) n += maybe(1); if (&missing_object) n += missing_object; if (by_pragma) by_pragma(); return n + weak_definition(); }
         int (*table[])(int) = { maybe };
         int from_table(void) { return table[0] == 0 && &present != 0; }
         void *frame(void) { return __builtin_frame_address(0); }
         void *caller(void) { return __builtin_return_address(0); }
         void *grand(void) { return __builtin_extract_return_addr(__builtin_return_address(1)); }";
    let output = crate::compile_with_warnings(
        src.as_bytes(),
        "t.c",
        &crate::CompileOptions::new(LINUX_X64),
    )
    .unwrap_or_else(|d| panic!("{}", d[0]));
    assert!(output.warnings.is_empty(), "{:?}", output.warnings.first());
    let text = disassemble(&output.bir).unwrap();
    assert!(
        has(&text, ": maybe sig")
            && has(&text, "missing_object data weak")
            && has(&text, ": present data\n"),
        "{text}"
    );
    assert_eq!(count(&text, " weak\n"), 3, "{text}");
    // Extern kind bytes: Function | 0x80 and Data | 0x80.
    let contains =
        |needle: &[u8]| (0..output.bir.len()).any(|i| output.bir[i..].starts_with(needle));
    assert!(
        contains(b"\x05maybe\x80")
            && contains(b"\x0emissing_object\x81")
            && contains(b"\x07present\x01"),
        "{:?}",
        output.bir
    );
    // FrameAddress; [it + 8] is the return address; one level up follows [it] first.
    assert!(has(function(&text, "frame"), "FrameAddress"), "{text}");
    let caller = function(&text, "caller");
    assert!(
        has(caller, "FrameAddress") && has(caller, "+ 8]"),
        "{caller}"
    );
    let grand = function(&text, "grand");
    assert!(
        count(grand, "Load i64") == 2 && has(grand, "+ 0]") && has(grand, "+ 8]"),
        "{grand}"
    );
    // One unit's strong declaration makes the symbol required.
    let units: [(&[u8], &str); 2] = [
        (
            b"__attribute__((weak)) void hook(void); void a(void) { if (hook) hook(); }",
            "a.c",
        ),
        (b"void hook(void); void b(void) { hook(); }", "b.c"),
    ];
    let linked = crate::compile_many(&units, &crate::CompileOptions::new(LINUX_X64))
        .unwrap_or_else(|d| panic!("{}", d[0]));
    assert!(!has(&disassemble(&linked.bir).unwrap(), " weak"));
    let units: [(&[u8], &str); 2] = [
        (
            b"__attribute__((weak)) void hook(void); int a(void) { return hook != 0; }",
            "a.c",
        ),
        (b"void hook(void) {}", "b.c"),
    ];
    crate::compile_many(&units, &crate::CompileOptions::new(LINUX_X64))
        .unwrap_or_else(|d| panic!("{}", d[0]));
}

#[test]
fn thread_local_initializers_with_addresses() {
    let src = "int global = 5; static int other = 6; int twice(int x) { return 2 * x; } extern int elsewhere;
         _Thread_local int *to_global = &global;
         static _Thread_local int *to_static = &other + 0;
         _Thread_local int (*to_function)(int) = twice;
         _Thread_local int counter = 40;
         _Thread_local int *to_counter = &counter;
         _Thread_local struct { int pad; int *p; char *text; } record = { 1, &counter, \"tls\" };
         _Thread_local int *to_extern = &elsewhere;
         int use(void) { *to_counter += 1; return *to_global + *to_static + to_function(10) + counter + *record.p + record.text[1] + (to_extern != 0); }";
    let bir = compile(src.as_bytes(), "t.c", LINUX_X64).unwrap_or_else(|d| panic!("{}", d[0]));
    crate::validate(&bir).unwrap();
    let text = disassemble(&bir).unwrap();
    assert_eq!(count(&text, "  tls reloc @"), 7, "{text}");
    assert!(
        has(&text, "tls reloc @")
            && has(&text, ": tls+")
            && has(&text, ": func ")
            && has(&text, ": extern "),
        "{text}"
    );
    // A data object still cannot start out pointing into a thread's copy.
    assert!(has(
        &crate::tests::error_for("_Thread_local int t; int *p = &t;", LINUX_X64),
        "address of a thread-local object is not a constant"
    ));
}

#[test]
fn const_is_a_real_qualifier() {
    let src = "typedef const int cint;
         const int limit = 10; cint other = 20; const char *const names[] = { \"a\", \"bc\" };
         struct point { int x; const int id; };
         int read(const struct point *p, const int *q) { return p->x + p->id + *q + limit + other + names[1][1]; }
         int pick(void) {
             const int local = 1; int plain = 2; const int *pc = &local; int *pp = &plain; int *const cp = &plain;
             *cp = 3;
             return _Generic(local, int: 1, default: 0)
                  + _Generic(&local, const int *: 10, int *: 20)
                  + _Generic(pc, const int *: 100, int *: 200)
                  + _Generic(pp, const int *: 1000, int *: 2000)
                  + _Generic(cp, int *: 10000, default: 0)
                  + _Generic(0 ? pc : pp, const int *: 100000, int *: 200000)
                  + _Generic(0 ? (volatile long *)0 : (const long *)0, const volatile long *: 1000000, default: 0)
                  + _Generic(\"text\", char *: 10000000, const char *: 20000000)
                  + _Generic((const int)plain, int: 100000000, default: 0);
         }";
    checked(src);
    for (source, message) in [
        (
            "const int x = 1; void f(void) { x = 2; }",
            "cannot assign to an lvalue of const-qualified type 'const int'",
        ),
        (
            "void f(const int *p) { *p = 2; }",
            "const-qualified type 'const int'",
        ),
        ("void f(const int *p) { (*p)++; }", "const-qualified"),
        (
            "struct s { int a; }; void f(const struct s *p) { p->a += 1; }",
            "const-qualified type 'const int'",
        ),
        (
            "struct s { const int a; }; void f(struct s *p) { p->a = 1; }",
            "const-qualified",
        ),
        (
            "void f(int *const p) { p = 0; }",
            "const-qualified type 'int * const'",
        ),
        (
            "void f(const char c[4]) { c[0] = 1; }",
            "const-qualified type 'const char'",
        ),
        (
            "int f(const char *); int f(char *);",
            "conflicting types for 'f'",
        ),
    ] {
        assert!(
            has(&crate::tests::error_for(source, LINUX_X64), message),
            "{source}: {}",
            crate::tests::error_for(source, LINUX_X64)
        );
    }
    let output = crate::compile_with_warnings(
        b"void take(char *); char *f(const char *s, volatile int *v) { char *p = s; take(s); int *q = v; (void)q; p = (char *)s; return s; }",
        "t.c",
        &crate::CompileOptions::new(LINUX_X64),
    )
    .unwrap();
    let warnings: Vec<String> = output.warnings.iter().map(ToString::to_string).collect();
    assert_eq!(warnings.len(), 4, "{warnings:?}");
    assert!(
        has(
            &warnings[0],
            "initializing discards the 'const' qualifier: 'const char *' to 'char *'"
        ),
        "{warnings:?}"
    );
    assert!(
        has(&warnings[1], "passing an argument discards the 'const'")
            && has(&warnings[2], "'volatile'")
            && has(&warnings[3], "returning"),
        "{warnings:?}"
    );
}

#[test]
fn inlining_flags_reach_the_function_declarations() {
    let src = "static inline int hinted(int x) { return x + 1; }
         static __inline__ __attribute__((always_inline)) int forced(int x) { return x + 2; }
         static __attribute__((noinline)) int kept(int x) { return x + 3; }
         __attribute__((__always_inline__, __noinline__)) static int both(int x) { return x + 4; }
         static int late(int x); inline static int late(int x) { return x + 5; }
         int plain(int x) { return hinted(x) + forced(x) + kept(x) + both(x) + late(x); }";
    let bir = crate::compile(src.as_bytes(), "t.c", LINUX_X64).unwrap();
    let module = crate::bir::Module::decode(&bir).unwrap();
    let flags = |name: &str| {
        module
            .funcs
            .iter()
            .find(|f| f.name == name)
            .map(|f| f.inlining)
    };
    assert_eq!(flags("hinted"), Some(crate::bir::INLINE_HINT));
    assert_eq!(
        flags("forced"),
        Some(crate::bir::INLINE_HINT | crate::bir::INLINE_ALWAYS)
    );
    assert_eq!(flags("kept"), Some(crate::bir::INLINE_NEVER));
    assert_eq!(flags("both"), Some(crate::bir::INLINE_NEVER));
    assert_eq!(flags("late"), Some(crate::bir::INLINE_HINT));
    assert_eq!(flags("plain"), Some(0));
    let text = crate::bir::disassemble(&module).unwrap();
    assert!(
        has(&text, "forced: sig 0 (i32) -> i32 always_inline inline"),
        "{text}"
    );
    // Bits 2..4 of the flags byte, as BIR.h numbers them.
    assert_eq!(
        (
            crate::bir::INLINE_ALWAYS,
            crate::bir::INLINE_NEVER,
            crate::bir::INLINE_HINT
        ),
        (4, 8, 16)
    );
    checked(src);
}

#[test]
fn assembly_that_only_hides_a_value_or_aligns_code() {
    let src = "unsigned long hide(unsigned long acc) { __asm__(\"\" : \"+r\"(acc)); return acc * 3; }
         int copy(int *in) { int out; __asm__ volatile(\"\" : \"=r\"(out) : \"0\"(*in)); return out + 1; }
         int memory(int *p) { __asm__ volatile(\"\" : \"+m\"(*p) : : \"memory\"); return *p; }
         int loop(int n) { int total = 0; __asm__(\".p2align 6\"); __asm__ volatile(\".balign 16\\n.align 32\");
             for (int i = 0; i < n; i++) total += i; return total; }";
    checked(src);
    // Anything else is assembled on x86-64 (see asm_stmt.rs) and refused elsewhere.
    let error = crate::tests::error_for(
        "int f(int a, int b) { __asm__(\"cmp %w1, %w0\" : \"+r\"(a) : \"r\"(b)); return a; }",
        crate::tests::LINUX_ARM64,
    );
    assert!(
        has(&error, "inline assembly is not supported yet ('cmp')"),
        "{error}"
    );
}

#[test]
fn memcpy_of_a_whole_scalar_is_a_load_or_a_store() {
    let src = "void *memcpy(void *, const void *, unsigned long); void *memmove(void *, const void *, unsigned long); void *memset(void *, int, unsigned long);
         typedef unsigned int u32; typedef unsigned long long u64;
         static u32 read32(const void *p) { u32 v; memcpy(&v, p, sizeof v); return v; }
         static u64 read64(const void *p) { u64 v; __builtin_memcpy(&v, p, sizeof(v)); return v; }
         static void write16(void *p, unsigned short v) { memcpy(p, &v, sizeof v); }
         u64 reads(const unsigned char *p) { return read32(p + 1) + read64(p + 3); }
         void writes(unsigned char *p, int v) { write16(p + 1, (unsigned short)v); }
         u64 bits_of(double d) { u64 u; memcpy(&u, &d, sizeof u); return u; }
         float float_of(u32 u) { float f; (void)memmove(&f, &u, 4); return f; }
         int narrow(const void *p) { signed char c; short s; _Bool b; memcpy(&c, p, 1); memcpy(&s, p, 2); memcpy(&b, p, 1); return c * 100000 + s + b * 10000000; }
         short resign(unsigned short u) { short s; memcpy(&s, &u, 2); return s; }
         int partial(const void *p) { int v = 0; memcpy(&v, p, 3); return v; }
         int escapes(const void *p) { int v; int *q = &v; memcpy(&v, p, sizeof v); return *q; }
         void *result_used(void *d, const void *s) { int v; void *r = memcpy(&v, s, 4); memcpy(d, &v, 4); return r == (void *)&v ? d : 0; }
         void *general(void *d, const void *s, unsigned long n) { memset(d, 0x5a, n + 4); return memcpy(d, s, n); }";
    let bir = crate::compile(src.as_bytes(), "t.c", LINUX_X64).unwrap();
    let text = crate::bir::disassemble(&crate::bir::Module::decode(&bir).unwrap()).unwrap();
    let body = |name: &str| -> String {
        let start = (0..text.len())
            .find(|&i| {
                text[i..].starts_with(&format!(" {name}"))
                    && text[..i].ends_with(|c: char| c.is_ascii_digit())
            })
            .unwrap_or(0);
        let rest = &text[start..];
        let end = (1..rest.len())
            .find(|&i| rest[i..].starts_with("\nfunc "))
            .unwrap_or(rest.len());
        rest[..end].to_string()
    };
    for name in [
        "read32", "read64", "write16", "bits_of", "float_of", "narrow", "resign",
    ] {
        let code = body(name);
        assert!(
            !has(&code, "MemCopy") && !has(&code, "slot") && !has(&code, "CallExtern"),
            "{name}: {code}"
        );
    }
    assert!(
        has(&body("read32"), "Load i32") && has(&body("write16"), "Store i16"),
        "{text}"
    );
    assert!(
        has(&body("bits_of"), "Bitcast") && has(&body("float_of"), "Bitcast"),
        "{text}"
    );
    for name in ["partial", "escapes", "result_used"] {
        assert!(
            has(&body(name), "MemCopy") && has(&body(name), "slot"),
            "{name}: {}",
            body(name)
        );
    }
    assert!(
        has(&body("general"), "MemSet")
            && has(&body("general"), "MemCopy")
            && !has(&text, "extern"),
        "{text}"
    );
}

#[test]
fn gnu_inline_and_constant_string_elements() {
    // What glibc's headers do when the compiler says it is GCC and optimizes.
    let src = "extern double my_atof(const char *);
         extern __inline __attribute__((__gnu_inline__)) double my_atof(const char *s) { return s[0] - '0'; }
         extern double my_atof(const char *);
         __inline __attribute__((__gnu_inline__)) int emitted(int x) { return x + 1; }
         char second[] = { \"ab\"[1], \"xy\" \"z\"[2], 0 };
         int use(void) { return (int)my_atof(\"7\") + emitted(1) + second[0] + second[1]; }";
    let bir = crate::compile(src.as_bytes(), "t.c", LINUX_X64).unwrap();
    let module = crate::bir::Module::decode(&bir).unwrap();
    let exported = |name: &str| {
        module
            .funcs
            .iter()
            .find(|f| f.name == name)
            .map(|f| f.exported)
    };
    assert_eq!(exported("my_atof"), Some(false));
    assert_eq!(exported("emitted"), Some(true));
    checked(src);
}

#[test]
fn narrowing_stores_and_branches_do_no_extra_work() {
    let src = "typedef unsigned short u16; typedef unsigned char u8;
         void stores(u16 *p, u8 *q, int x, long y) { *p = (u16)x; *q = (u8)y; p[1] = x; (*q)++; q[1] += 3; p[2] -= x; }
         int chain(u8 *q, int x) { int kept = (*q = x); return kept + (q[1] += 1) + q[2]++; }
         _Bool flags(_Bool *b, int x) { *b = x; return *b; }
         int branches(int a, long b, double c) { if (a) return 1; if (!b) return 2; if (c) return 3; while (a & 4) a++; return a ? 5 : 6; }";
    let bir = crate::compile(src.as_bytes(), "t.c", LINUX_X64).unwrap();
    let text = crate::bir::disassemble(&crate::bir::Module::decode(&bir).unwrap()).unwrap();
    let body = |name: &str| -> String {
        let start = (0..text.len())
            .find(|&i| text[i..].starts_with(&format!(" {name} (exported)")))
            .unwrap_or(0);
        let rest = &text[start..];
        let end = (1..rest.len())
            .find(|&i| rest[i..].starts_with("\nfunc "))
            .unwrap_or(rest.len());
        rest[..end].to_string()
    };
    // A statement that stores into a narrow object masks nothing; the store truncates.
    assert!(
        !has(&body("stores"), "And") && !has(&body("stores"), "SExt"),
        "{}",
        body("stores")
    );
    // Where the value of the assignment is used, it is the converted one.
    assert!(has(&body("chain"), "And"), "{}", body("chain"));
    // An int branches on itself; a long or a double is compared with zero first.
    let branches = body("branches");
    let count = |needle: &str| {
        (0..branches.len())
            .filter(|&i| branches[i..].starts_with(needle))
            .count()
    };
    assert_eq!(count("= Ne "), 2, "{branches}");
}

#[test]
fn gnu_c_corner_cases_that_tcctest_exercises() {
    let src = "typedef unsigned long long __attribute__((aligned(4))) unaligned_u64;
         struct lowered { unsigned int n; unaligned_u64 start; };
         struct natural { unsigned int n; unsigned long long start; };
         typedef struct later later_t; typedef __attribute__((aligned(64))) struct later { int x; } later_t;
         typedef float four __attribute__((__mode__(__V4SF__)));
         struct pair { int a, b; } table[2] __attribute__((aligned(32)));
         int layout(void) { return sizeof(struct lowered) * 1000000 + __alignof__(struct lowered) * 100000 + sizeof(struct natural) * 1000
             + __alignof__(table) + (sizeof(four) == 16) * 100 + (__alignof__(later_t) == 64) * 200; }
         static int v1 = 34 ?: -1, v2 = 0 ?: -1;
         int old_style(a, b) int a; char *b; { return a + (b != 0); }
         static int num(int x) { return x + 1; }
         int gnu(void) { int (*f)(int) = num; long diff; f = num + 0; diff = f - num;
             int here = ({ __label__ l; l: 40 + 2; });
             switch (diff) { case 0: __extension__({ here++; }); }
             return v1 * 1000 + v2 * -100 + old_style((void *)3, \"s\") * 10000 + (f + diff)(here) * 100000; }
         void fences(int *p) { __asm__ volatile(\"lock; orl $0, (%%rsp)\" ::: \"memory\"); *p = 1; __asm__ volatile(\"mfence\"); __asm__ volatile(\"sfence\" ::: \"memory\"); }
         void stop(unsigned long why) { __asm__ volatile(\"int3\" : : \"r\"(why)); __builtin_unreachable(); }
         static inline int wide_cas(unsigned __int128 *p, unsigned __int128 *e, unsigned __int128 v) { return __atomic_compare_exchange_n(p, e, v, 0, 5, 5); }
         #define inc < dir name >
         #define dir std
         #define name def.h
         #include inc
         size_t from_header(void) { return sizeof(ptrdiff_t); }";
    checked(src);
    let bir = crate::compile(src.as_bytes(), "t.c", LINUX_X64).unwrap();
    let text = crate::bir::disassemble(&crate::bir::Module::decode(&bir).unwrap()).unwrap();
    assert!(
        has(&text, "Fence order 4") && has(&text, "Fence order 3"),
        "{text}"
    );
    assert!(has(&text, "Trap"), "{text}");
    // The 16-byte compare-and-swap is an error only where it is compiled.
    let error = crate::tests::error_for(
        "int f(unsigned __int128 *p, unsigned __int128 *e) { return __atomic_compare_exchange_n(p, e, 1, 0, 5, 5); }",
        LINUX_X64,
    );
    assert!(
        has(&error, "there are no 16-byte atomic operations"),
        "{error}"
    );
}

#[test]
fn claiming_to_be_gnu_c() {
    assert_eq!(crate::parse_gnu_version("4.2.1"), Some(Some((4, 2, 1))));
    assert_eq!(crate::parse_gnu_version("13"), Some(Some((13, 0, 0))));
    assert_eq!(crate::parse_gnu_version("0"), Some(None));
    assert_eq!(crate::parse_gnu_version("4..1"), None);
    assert_eq!(crate::parse_gnu_version("x"), None);
    let src = b"#if defined __GNUC__ && __GNUC__ == 9 && __GNUC_MINOR__ == 1 && __GNUC_PATCHLEVEL__ == 2 && __GNUC_STDC_INLINE__ && __OPTIMIZE__ && !defined __NO_INLINE__ && !defined __clang__
         int gnu(void) { return sizeof __VERSION__ > 1; }
         #else
         int plain(void) { return __GCC_ATOMIC_LONG_LOCK_FREE + __GCC_HAVE_SYNC_COMPARE_AND_SWAP_8; }
         #endif
         _Float64 f64(_Float32 x) { _Float32x y = x; return y; }
         extern __float128 q; extern _Complex _Float128 cq; extern _Float64x e;
         int sizes(void) { return sizeof q * 10000 + sizeof cq * 100 + sizeof e; }";
    let mut options = crate::CompileOptions::new(LINUX_X64);
    let names = |options: &crate::CompileOptions<'_>| {
        crate::export_names(&crate::compile_with(src, "t.c", options).unwrap()).unwrap()
    };
    assert_eq!(names(&options), ["plain", "f64", "sizes"]);
    options.gnu_version = Some((9, 1, 2));
    assert_eq!(names(&options), ["gnu", "f64", "sizes"]);
    assert!(has(
        &crate::predefined_macros_as_gnu(LINUX_X64, (4, 2, 1)),
        "#define __GNUC_MINOR__ 2\n"
    ));
    assert!(!has(&crate::predefined_macros(LINUX_X64), "__GNUC__"));
}

#[test]
fn typescript_declarations_for_the_exports() {
    let src = b"struct point { int x, y; };
         int add(int a, int b) { return a + b; }
         unsigned long long hash(const unsigned char *data, unsigned long len) { return len ? data[0] : 0; }
         _Bool ready(void) { return 1; }
         void *make(unsigned long n, const char *function, int) { (void)function; return (void *)n; }
         static int hidden(int x) { return x; }
         struct point origin(void) { struct point p = {hidden(0), 0}; return p; }
         int print(const char *fmt, ...) { return fmt != 0; }
         float half(float value) { return value / 2; }
         int other(int x) __asm__(\"real_name\"); int other(int x) { return x; }";
    let text =
        crate::typescript_declarations(src, "t.c", &crate::CompileOptions::new(LINUX_X64)).unwrap();
    for line in [
        "import type { Pointer } from \"bun:ffi\";",
        "/** `int add(int a, int b)` */\nexport function add(a: number, b: number): number;",
        "export function hash(data: Pointer | NodeJS.TypedArray | null, len: bigint): bigint;",
        "export function ready(): boolean;",
        "export function make(n: bigint, function_: Pointer | NodeJS.TypedArray | null, arg2: number): Pointer | null;",
        "// origin: `struct point origin(void)` takes or returns a value that cannot cross into JavaScript.",
        "// print: `int print(const char * fmt, ...)` takes a variable number of arguments",
        "export function half(value: number): number;",
        "export function real_name(x: number): number;",
        "declare const _default: {\n  add: typeof add;\n  hash: typeof hash;\n  ready: typeof ready;\n  make: typeof make;\n  half: typeof half;\n  real_name: typeof real_name;\n};\nexport default _default;\n",
    ] {
        assert!(has(&text, line), "missing {line:?} in\n{text}");
    }
    assert!(!has(&text, "hidden"), "{text}");
}

#[test]
fn reads_of_constant_objects_are_constants() {
    let src = "typedef unsigned long long u64;
         static const unsigned char rhotates[5][5] = { { 0, 1, 62, 28, 27 }, { 36, 44, 6, 55, 20 }, { 3, 10, 43 } };
         static u64 rol(u64 v, int n) { return n == 0 ? v : (v << n) | (v >> (64 - n)); }
         u64 keccak(u64 a) { return rol(a, rhotates[1][1]) ^ rol(a, rhotates[0][0]) ^ rol(a, rhotates[2][4]); }
         static const unsigned crc_table[4] = { 0, 0x77073096, 0xee0e612c, 0x990951ba };
         unsigned crc(unsigned c) { return crc_table[2] ^ (c >> 8) ^ crc_table[3]; }
         static const struct config { int width; double scale; const char *name; struct { short lo, hi; } range; int (*handler)(int); } settings
             = { 640, 1.5, \"screen\", { -2, 7 }, 0 };
         static const int limit = 5; static const float ratio = 0.25f; static const _Bool on = 1; static const signed char negative = -3;
         double scalars(void) { return settings.width * settings.scale + settings.range.lo + settings.range.hi + limit + ratio + on + negative; }
         static const char *const names[] = { \"zero\", \"one\", \"two\" }; static const int numbers[3] = { 7, 8, 9 }; static const int *const third = &numbers[2];
         const char *name(void) { return names[1]; } const int *address(void) { return third; } int through(void) { return *third; }
         int literal(void) { return \"abc\"[1] + \"xyz\"[0]; } const char *text(void) { return settings.name; } void *nothing(void) { return (void *)settings.handler; }

         static int mutable_table[2] = { 1, 2 }; static const volatile int hardware = 3; extern const int elsewhere; const int tentative;
         static const int later[2]; const int weak_value __attribute__((weak)) = 4; static struct { const int fixed; int loose; } mixed = { 5, 6 };
         int not_folded(int i) { return mutable_table[1] + hardware + elsewhere + tentative + weak_value + mixed.fixed + crc_table[i] + later[0]; }
         static const int later[2] = { 11, 12 };
         void poke(void) { *(int *)&limit = 6; }";
    let bir = crate::compile(src.as_bytes(), "t.c", LINUX_X64).unwrap();
    let text = crate::bir::disassemble(&crate::bir::Module::decode(&bir).unwrap()).unwrap();
    let body = |name: &str| -> String {
        let start = (0..text.len())
            .find(|&i| text[i..].starts_with(&format!(" {name} (exported)")))
            .unwrap_or(0);
        let rest = &text[start..];
        let end = (1..rest.len())
            .find(|&i| rest[i..].starts_with("\nfunc "))
            .unwrap_or(rest.len());
        rest[..end].to_string()
    };
    for name in ["keccak", "crc", "scalars", "literal", "through", "nothing"] {
        assert!(!has(&body(name), "Load"), "{name}: {}", body(name));
    }
    assert!(
        has(&body("keccak"), "ConstI32 44") && has(&body("keccak"), "ConstI32 0"),
        "{}",
        body("keccak")
    );
    assert!(
        has(&body("crc"), "ConstI32 -301047508") && has(&body("crc"), "ConstI32 -1727442502"),
        "{}",
        body("crc")
    );
    // A pointer kept in a constant object is the address it was initialized with.
    for name in ["name", "address", "text"] {
        assert!(
            !has(&body(name), "Load") && has(&body(name), "DataAddr"),
            "{name}: {}",
            body(name)
        );
    }
    let loads = body("not_folded");
    let count = (0..loads.len())
        .filter(|&i| loads[i..].starts_with("= Load"))
        .count();
    assert_eq!(count, 7, "{loads}");
    assert!(has(&loads, "ConstI32 11"), "{loads}");
}

#[test]
fn rotation_idioms_become_rotate_instructions() {
    let src = "typedef unsigned int u32; typedef unsigned long long u64;
         u64 rol64(u64 x, int n) { return (x << n) | (x >> (64 - n)); }
         u64 ror64(u64 x, unsigned n) { return (x >> n) | (x << (64 - n)); }
         u32 rol32(u32 x, unsigned n) { return (x << (n & 31)) | (x >> (-n & 31)); }
         u32 ror32(u32 x, unsigned char n) { return (x >> (n & 31)) + (x << ((32 - n) & 31)); }
         u64 xor_form(u64 x, u64 n) { return (x >> (n & 63)) ^ (x << ((0 - n) & 63)); }
         u32 member(const struct { u32 w[2]; } *s, int n) { return (s->w[1] << n) | (s->w[1] >> (32 - n)); }
         u32 builtins(u32 x, u64 y, int n) { return __builtin_rotateleft32(x, n) ^ (u32)__builtin_rotateright64(y, n) ^ _rotl(x, 3) ^ (u32)_rotr64(y, 5) ^ (u32)_lrotl(y, 7); }
         unsigned char narrow(unsigned char x, int n) { return __builtin_rotateleft8(x, n); }
         u32 not_a_rotation(u32 x, u32 y, int n, int m) { return ((x << n) | (y >> (32 - n))) + ((x << n) | (x >> (32 - m))) + ((x << n) | (x >> (31 - n))); }
         int signed_one(int x, int n) { return (x << n) | (x >> (32 - n)); }
         u32 side_effects(u32 *p, int n) { return (*p++ << n) | (*p++ >> (32 - n)); }";
    let bir = crate::compile(src.as_bytes(), "t.c", LINUX_X64).unwrap();
    let text = crate::bir::disassemble(&crate::bir::Module::decode(&bir).unwrap()).unwrap();
    let body = |name: &str| -> String {
        let start = (0..text.len())
            .find(|&i| text[i..].starts_with(&format!(" {name} (exported)")))
            .unwrap_or(0);
        let rest = &text[start..];
        let end = (1..rest.len())
            .find(|&i| rest[i..].starts_with("\nfunc "))
            .unwrap_or(rest.len());
        rest[..end].to_string()
    };
    for (name, op) in [
        ("rol64", "RotL"),
        ("ror64", "RotR"),
        ("rol32", "RotL"),
        ("ror32", "RotR"),
        ("xor_form", "RotR"),
        ("member", "RotL"),
    ] {
        let code = body(name);
        assert!(
            has(&code, op) && !has(&code, "Shl") && !has(&code, "ShrU"),
            "{name}: {code}"
        );
    }
    assert!(
        has(&body("builtins"), "RotL")
            && has(&body("builtins"), "RotR")
            && !has(&body("builtins"), "Shl"),
        "{}",
        body("builtins")
    );
    for name in ["not_a_rotation", "signed_one", "side_effects", "narrow"] {
        assert!(!has(&body(name), "Rot"), "{name}: {}", body(name));
    }
    // The opcodes BIR.h gives them.
    assert_eq!(
        (crate::bir::BinOp::RotL as u8, crate::bir::BinOp::RotR as u8),
        (0x2e, 0x2f)
    );
}

#[test]
fn wide_integers_are_computed_in_registers() {
    let src = "typedef unsigned long long u64; typedef unsigned __int128 u128; typedef __int128 i128;
         u128 mul(u64 a, u64 b) { return (u128)a * b; }
         u64 high(u64 a, u64 b) { return (u128)a * b >> 64; }
         long long signed_high(long long a, long long b) { return ((i128)a * b) >> 64; }
         u64 mac(u64 *r, u64 a, u64 w, u64 c) { u128 t = (u128)a * w + *r + c; *r = (u64)t; return (u64)(t >> 64); }
         u64 fe(const u64 f[3], const u64 g[3]) {
             u128 h0 = (u128)f[0] * g[0] + (u128)f[1] * (g[2] * 19) + (u128)f[2] * (g[1] * 19);
             u128 h1 = (u128)f[0] * g[1] + (u128)f[1] * g[0];
             h1 += (u64)(h0 >> 51); h0 &= 0x7ffffffffffff; h1 -= 3; h1 ^= h0 << 70; h1 |= 1; h1++; --h0; h0 *= 5; h0 <<= 3; h0 /= 7; h0 %= 1000003;
             const u128 five = 5; u128 unset; unset = h1; unset = (h0 & 1) ? unset + five : unset - five;
             return (u64)h0 ^ (u64)h1 ^ (u64)(h1 >> 64) ^ (u64)(unset >> 3) ^ (u64)((i128)-2 >> 100) ^ (u64)(((u128)1 << 127) >> 120) ^ (u64)((i128)(long long)f[0] * -3 >> 64);
         }
         int compare(u64 a, u64 b) { u128 x = (u128)a << 64 | b, y = x; y += 1; return (x < y) + (y != x) * 2 + (x == x) * 4 + ((i128)x < 0) * 8; }";
    let bir = crate::compile(src.as_bytes(), "t.c", LINUX_X64).unwrap();
    let text = crate::bir::disassemble(&crate::bir::Module::decode(&bir).unwrap()).unwrap();
    let body = |name: &str| -> String {
        let start = (0..text.len())
            .find(|&i| text[i..].starts_with(&format!(" {name} (exported)")))
            .unwrap_or(0);
        let rest = &text[start..];
        let end = (1..rest.len())
            .find(|&i| rest[i..].starts_with("\nfunc "))
            .unwrap_or(rest.len());
        rest[..end].to_string()
    };
    let count = |code: &str, needle: &str| {
        (0..code.len())
            .filter(|&i| code[i..].starts_with(needle))
            .count()
    };
    // The high half of the full product and nothing else: no cross terms, no memory.
    for (name, op) in [("high", "UMulHigh"), ("signed_high", "= MulHigh")] {
        let code = body(name);
        assert!(
            has(&code, op)
                && count(&code, "= Mul ") == 0
                && !has(&code, "slot")
                && !has(&code, "Store"),
            "{name}: {code}"
        );
    }
    let mac = body("mac");
    assert!(
        count(&mac, "= Mul ") == 1
            && count(&mac, "UMulHigh") == 1
            && count(&mac, "ULt") == 2
            && !has(&mac, "slot"),
        "{mac}"
    );
    assert!(count(&body("mul"), "= Mul ") == 1, "{}", body("mul"));
}

#[test]
fn unreachable_code_is_not_emitted_and_int128_is_announced() {
    let src = "#if __SIZEOF_INT128__ != 16
         #error no __int128
         #endif
         #define BIT_INTERLEAVE (0)
         static unsigned long long rol(unsigned long long val, int offset) {
             if (offset == 0) { return val; } else if (!BIT_INTERLEAVE) { return (val << offset) | (val >> (64 - offset)); }
             else { unsigned hi = (unsigned)(val >> 32), lo = (unsigned)val; if (offset & 1) { unsigned tmp = hi; offset >>= 1; hi = lo << offset | lo >> (32 - offset); lo = tmp; } return ((unsigned long long)hi << 32) | lo; }
         }
         unsigned long long use(unsigned long long v, int n) { return rol(v, n); }
         int after_return(int x) { return x; x++; return x + 1; }";
    let bir = crate::compile(src.as_bytes(), "t.c", LINUX_X64).unwrap();
    let module = crate::bir::Module::decode(&bir).unwrap();
    let blocks = |name: &str| {
        module
            .funcs
            .iter()
            .find(|f| f.name == name)
            .map(|f| f.blocks.len())
    };
    // The test, the early return, the (empty) else and the rotation.
    assert_eq!(blocks("rol"), Some(4));
    assert_eq!(blocks("after_return"), Some(1));
    let text = crate::bir::disassemble(&module).unwrap();
    assert!(has(&text, "RotL") && !has(&text, "Unreachable"), "{text}");
    checked(src);
}

#[test]
fn wide_integers_cross_calls_as_two_values() {
    let src = "typedef unsigned long long u64; typedef unsigned __int128 u128; typedef __int128 i128;
         u64 mulhi(u64 a, u64 b) { return (u128)a * b >> 64; }
         static __attribute__((noinline)) u128 square(u128 x, int shift) { x *= x; return x >> shift; }
         static __attribute__((noinline)) i128 negate(i128 x) { return -x; }
         u64 chain(u64 a) { u128 s = square((u128)a << 3 | 1, 2); i128 n = negate((i128)s); return (u64)(s >> 60) ^ (u64)(~n >> 64) ^ (u64)n ^ (s > (u128)a) ^ ((n < 0) << 1) ^ ((n == -(i128)s) << 2); }
         u128 id(u128 x) { return x; }
         u64 variadic_like(int pick, u128 a, u64 pad, u128 b) { return pick ? (u64)(a >> 64) + pad : (u64)(b >> 64) + pad; }
         u64 caller(u64 v) { return variadic_like(0, (u128)v, 1, (u128)v << 64 | 5) + variadic_like(1, id((u128)v << 65), 2, 0); }";
    let bir = crate::compile(src.as_bytes(), "t.c", LINUX_X64).unwrap();
    let text = crate::bir::disassemble(&crate::bir::Module::decode(&bir).unwrap()).unwrap();
    // No 128-bit value goes through memory anywhere in this unit.
    assert!(
        !has(&text, "slot ") && !has(&text, "Store") && !has(&text, "Load"),
        "{text}"
    );
    let start = (0..text.len())
        .find(|&i| text[i..].starts_with(" mulhi (exported)"))
        .unwrap();
    let end = start
        + (1..)
            .find(|&i| text[start + i..].starts_with("\nfunc "))
            .unwrap();
    // Apart from moving the parameters into their variables: one instruction and the return.
    let mulhi = &text[start..end];
    let count = |needle: &str| {
        (0..mulhi.len())
            .filter(|&i| mulhi[i..].starts_with(needle))
            .count()
    };
    assert_eq!(count("\n    v"), 3, "{mulhi}");
    assert!(
        count("= LocalGet") == 2 && count("UMulHigh") == 1 && count("\n    Ret v") == 1,
        "{mulhi}"
    );
}

#[test]
fn local_aggregates_used_element_by_element_are_not_in_memory() {
    let src = "typedef unsigned int u32; typedef unsigned long long u64;
         void *memcpy(void *, const void *, unsigned long); void *memset(void *, int, unsigned long);
         typedef union { u32 u[16]; unsigned char c[64]; } block;
         #define ROTATE(v, n) (((v) << (n)) | ((v) >> (32 - (n))))
         #define QR(a, b, c, d) (x[a] += x[b], x[d] = ROTATE((x[d] ^ x[a]), 16), x[c] += x[d], x[b] = ROTATE((x[b] ^ x[c]), 12))
         void core(block *output, const u32 input[16]) {
             u32 x[16]; int i;
             memcpy(x, input, sizeof(x));
             for (i = 20; i > 0; i -= 2) { QR(0, 4, 8, 12); QR(1, 5, 9, 13); QR(2, 6, 10, 14); QR(3, 7, 11, 15); }
             for (i = 0; i < 16; ++i) output->u[i] = x[i] + input[i];
         }
         struct point { int x, y; struct { short lo, hi; } range; double w; };
         double members(const struct point *p, int k) {
             struct point a = *p, b = { 1, 2, { 3, 4 }, 0.5 }, c;
             memset(&c, 0, sizeof c); c.range.hi = (short)k; a.x += b.y; b = a; c.w = b.w * 2;
             struct point d; d = c; return a.x + b.x * 10 + b.range.lo * 100 + d.range.hi * 1000 + d.w + c.y;
         }
         u64 theta(const u64 a[5]) { u64 C[5], D[5]; int i;
             for (i = 0; i < 5; i++) C[i] = a[i] ^ (a[i] << 1);
             D[0] = C[4] ^ C[1]; D[1] = C[0] ^ C[2]; D[2] = C[1] ^ C[3]; D[3] = C[2] ^ C[4]; D[4] = C[3] ^ C[0];
             return D[0] + D[1] * 3 + D[2] * 5 + D[3] * 7 + D[4] * 11; }
         int escapes(int k) { int v[4] = { 1, 2, 3, 4 }; int *p = &v[1]; return p[k] + v[0]; }
         int variable_index(int k) { int v[4] = { 1, 2, 3, 4 }; return v[k & 3]; }
         extern int sum(const int *, int); int passed(void) { int v[3] = { 1, 2, 3 }; return sum(v, 3); }
         int punned(void) { union { int i; float f; } u; u.f = 1.0f; return u.i; }
         int counter_changes(void) { int v[4] = { 0 }, i; for (i = 0; i < 4; i++) { v[i] = i; if (i == 1) i++; } return v[0] + v[1] + v[2] * 10 + v[3] * 100 + i * 1000; }";
    let bir = crate::compile(src.as_bytes(), "t.c", LINUX_X64).unwrap();
    let text = crate::bir::disassemble(&crate::bir::Module::decode(&bir).unwrap()).unwrap();
    let body = |name: &str| -> String {
        let start = (0..text.len())
            .find(|&i| text[i..].starts_with(&format!(" {name} (exported)")))
            .unwrap_or(0);
        let rest = &text[start..];
        let end = (1..rest.len())
            .find(|&i| rest[i..].starts_with("\nfunc "))
            .unwrap_or(rest.len());
        rest[..end].to_string()
    };
    for name in ["core", "members", "theta"] {
        assert!(
            !has(&body(name), "slot ")
                && !has(&body(name), "MemCopy")
                && !has(&body(name), "MemSet"),
            "{name}: {}",
            body(name)
        );
    }
    assert!(has(&body("core"), "RotL"), "{}", body("core"));
    for name in [
        "escapes",
        "variable_index",
        "passed",
        "punned",
        "counter_changes",
    ] {
        assert!(has(&body(name), "slot "), "{name}: {}", body(name));
    }
    let output = crate::compile_with_warnings(
        src.as_bytes(),
        "t.c",
        &crate::CompileOptions::new(LINUX_X64),
    )
    .unwrap();
    assert_eq!(output.replaced_aggregates, 1 + 4 + 2);
}

#[test]
fn byte_by_byte_integers_become_one_access() {
    let src = "typedef unsigned char u8; typedef unsigned int u32; typedef unsigned long long u64; typedef unsigned long long SHA_LONG64;
         #define B(x, j) (((SHA_LONG64)(*(((const unsigned char *)(&x)) + j))) << ((7 - j) * 8))
         #define PULL64(x) (B(x, 0) | B(x, 1) | B(x, 2) | B(x, 3) | B(x, 4) | B(x, 5) | B(x, 6) | B(x, 7))
         u64 pull64(const u64 *w) { return PULL64(w[1]); }
         #define HOST_c2l_fixed(c, l) (l = (((unsigned long)((c)[0])) << 24), l |= (((unsigned long)((c)[1])) << 16), l |= (((unsigned long)((c)[2])) << 8), l |= (((unsigned long)((c)[3]))))
         u32 sqlite3Get4byte(const u8 *p) { return ((unsigned)p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]; }
         void sqlite3Put4byte(unsigned char *p, u32 v) { p[0] = (u8)(v >> 24); p[1] = (u8)(v >> 16); p[2] = (u8)(v >> 8); p[3] = (u8)v; }
         #define get2byte(x) ((x)[0] << 8 | (x)[1])
         #define put2byte(p, v) ((p)[0] = (u8)((v) >> 8), (p)[1] = (u8)(v))
         int two(u8 *p, int v) { int old = get2byte(p + 2); put2byte(p + 2, v); return old; }
         #define U8TO32_LITTLE(p) (((u32)((p)[0])) | ((u32)((p)[1]) << 8) | ((u32)((p)[2]) << 16) | ((u32)((p)[3]) << 24))
         #define U32TO8_LITTLE(p, v) do { (p)[0] = (u8)(v >> 0); (p)[1] = (u8)(v >> 8); (p)[2] = (u8)(v >> 16); (p)[3] = (u8)(v >> 24); } while (0)
         void little(u8 *out, const u8 *in) { u32 v = U8TO32_LITTLE(in + 4) + 1; U32TO8_LITTLE(out, v); }
         u64 le64(const u8 *p) { return (u64)p[0] + ((u64)p[1] << 8) + ((u64)p[2] << 16) + ((u64)p[3] << 24) + ((u64)p[4] << 32) + ((u64)p[5] << 40) + ((u64)p[6] << 48) + ((u64)p[7] << 56); }
         void be64(u8 *p, u64 v) { p[7] = (u8)v; p[6] = (u8)(v >> 8); p[5] = (u8)(v >> 16); p[4] = (u8)(v >> 24); p[3] = (u8)(v >> 32); p[2] = (u8)(v >> 40); p[1] = (u8)(v >> 48); p[0] = (u8)(v >> 56); }
         u32 advance(const u8 **cursor) { const u8 *c = *cursor; u32 l = (u32)c[0] << 24 | (u32)c[1] << 16 | (u32)c[2] << 8 | c[3]; c += 4; *cursor = c; return l; }
         int signed_chars(const char *p) { return (p[0] & 0xff) | (p[1] & 0xff) << 8; }

         u32 mixed(const u8 *p, const u8 *q) { return (u32)p[0] << 24 | (u32)q[1] << 16 | (u32)p[2] << 8 | p[3]; }
         u32 watched(const volatile u8 *p) { return (u32)p[0] << 24 | (u32)p[1] << 16 | (u32)p[2] << 8 | p[3]; }
         u32 three(const u8 *p) { return (u32)p[0] << 16 | (u32)p[1] << 8 | p[2]; }
         u32 walking(const u8 *c) { u32 l; l = ((u32)(*(c++))) << 24; l |= ((u32)(*(c++))) << 16; l |= ((u32)(*(c++))) << 8; l |= ((u32)(*(c++))); return l; }
         u32 sign_extended(const u8 *p) { return (unsigned long long)((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >> 32; }
         void aliasing(u8 *p, const u32 *v) { p[0] = (u8)(*v >> 24); p[1] = (u8)(*v >> 16); p[2] = (u8)(*v >> 8); p[3] = (u8)*v; }
         void gap(u8 *p, u32 v) { p[0] = (u8)(v >> 24); p[1] = (u8)(v >> 16); p[3] = (u8)(v >> 8); p[4] = (u8)v; }";
    let output = crate::compile_with_warnings(
        src.as_bytes(),
        "t.c",
        &crate::CompileOptions::new(LINUX_X64),
    )
    .unwrap();
    let text = crate::bir::disassemble(&crate::bir::Module::decode(&output.bir).unwrap()).unwrap();
    let body = |name: &str| -> String {
        let start = (0..text.len())
            .find(|&i| text[i..].starts_with(&format!(" {name} (exported)")))
            .unwrap_or(0);
        let rest = &text[start..];
        let end = (1..rest.len())
            .find(|&i| rest[i..].starts_with("\nfunc "))
            .unwrap_or(rest.len());
        rest[..end].to_string()
    };
    let count = |code: &str, needle: &str| {
        (0..code.len())
            .filter(|&i| code[i..].starts_with(needle))
            .count()
    };
    for (name, access, swapped) in [
        ("pull64", "Load i64", true),
        ("sqlite3Get4byte", "Load i32", true),
        ("sqlite3Put4byte", "Store i32", true),
        ("le64", "Load i64", false),
        ("be64", "Store i64", true),
        ("advance", "Load i32", true),
        ("signed_chars", "Load i16u", false),
    ] {
        let code = body(name);
        assert!(
            has(&code, access) && !has(&code, "i8") && has(&code, "Bswap") == swapped,
            "{name}: {code}"
        );
    }
    let two = body("two");
    assert!(
        has(&two, "Load i16u")
            && has(&two, "Store i16")
            && !has(&two, "i8")
            && count(&two, "Bswap") == 2,
        "{two}"
    );
    let little = body("little");
    assert!(
        has(&little, "Load i32")
            && has(&little, "Store i32")
            && !has(&little, "i8")
            && !has(&little, "Bswap"),
        "{little}"
    );
    // The `int` inside is the four bytes; what widens it afterwards still sign-extends.
    let widened = body("sign_extended");
    assert!(
        has(&widened, "Load i32") && has(&widened, "SExt32"),
        "{widened}"
    );
    // Only the two low bytes of `v` sit next to each other.
    let gap = body("gap");
    assert!(
        count(&gap, "Store i8u") == 2 && count(&gap, "Store i16u") == 1,
        "{gap}"
    );
    for name in ["mixed", "watched", "three", "walking", "aliasing"] {
        assert!(
            has(&body(name), "i8") && !has(&body(name), "Bswap"),
            "{name}: {}",
            body(name)
        );
    }
    assert_eq!(output.combined_accesses, (8, 5));
}
