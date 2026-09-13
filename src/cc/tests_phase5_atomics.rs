//! Tests for C11 atomics: `_Atomic`, the `__atomic_*` / `__sync_*` builtins and `<stdatomic.h>`.

use crate::tests::{LINUX_X64, assert_error, checked, has};
use crate::{compile, disassemble};

#[test]
fn operators_on_atomic_objects() {
    checked(
        "_Atomic int counter = 10;
         _Atomic unsigned char small = 250;
         _Atomic short half = -32768;
         _Atomic long long wide = 1;
         _Atomic float real = 1.5f;
         _Atomic double precise;
         _Atomic _Bool flag;
         _Atomic(int *) cursor;
         int *_Atomic also_cursor;
         static int slots[8];
         struct Stats { _Atomic int hits; int plain; _Atomic long long bytes; };
         static struct Stats stats = { .hits = 3, .bytes = 1000 };
         int read(void) { return counter; }
         int assign(int v) { return counter = v; }
         int add_assign(int v) { return counter += v; }
         int sub_assign(int v) { return counter -= v; }
         int post_inc(void) { return counter++; }
         int pre_dec(void) { return --counter; }
         int bitwise(void) { counter = 0xf0; counter &= 0x3c; counter |= 1; counter ^= 0xff; return counter; }
         int multiply(int v) { return counter *= v; }
         int divide(int v) { counter /= v; return counter; }
         int modulo(int v) { return counter %= v; }
         int shifts(void) { counter = 3; counter <<= 4; int a = counter; counter >>= 2; return a * 100 + counter; }
         int mixed(void) { counter = 7; counter *= 1.5; return counter; }
         int wrap_small(void) { int a = small++; int b = small += 10; small -= 20; return a * 1000000 + b * 1000 + small; }
         int wrap_half(void) { half--; int a = half; half += 2; return a * 2 + (half == -32767); }
         long long wide_ops(void) { wide <<= 40; wide += 5; wide *= 3; return wide--; }
         float real_ops(float v) { real += v; real *= 2.0f; float old = real++; return old + real; }
         double precise_ops(void) { precise = 0.5; precise -= 2.0; precise /= 4.0; return precise; }
         int flag_ops(void) { flag = 5; int a = flag; flag ^= 1; int b = flag; flag |= 2; return a * 100 + b * 10 + flag; }
         int cursor_ops(void) {
             cursor = slots; cursor += 3; int *a = cursor++; int *b = --cursor; cursor -= 1;
             also_cursor = slots + 7; also_cursor--;
             return (int)(a - slots) * 1000 + (int)(b - slots) * 100 + (int)(cursor - slots) * 10 + (int)(also_cursor - slots);
         }
         int members(struct Stats *s) { s->hits++; s->bytes += 24; s->plain = s->hits; return s->plain + (int)s->bytes; }
         int member_ops(void) { return members(&stats); }
         int local_atomic(int v) { _Atomic int local = v; local += 2; _Atomic int other = local; return other++ + local; }
         int sizes(void) { return sizeof(counter) * 1000 + sizeof(small) * 100 + sizeof(wide) * 10 + _Alignof(_Atomic short); }
         int in_expression(int v) { counter = v; return counter + counter * 2 + (counter > 3 ? 100 : 0) + !counter; }",
    );
    // Which become one instruction and which become compare-and-swap loops.
    let text = disassemble(
        &compile(
            b"_Atomic int x; _Atomic float f; int *_Atomic p;
              void single(void) { x += 2; x -= 1; x &= 3; x |= 4; x ^= 5; x++; p += 1; x = 1; }
              void loops(void) { x *= 2; x <<= 1; f += 1.0f; }",
            "t.c",
            LINUX_X64,
        )
        .unwrap(),
    )
    .unwrap();
    let second = (0..text.len())
        .find(|&i| text[i..].starts_with("func 1 loops"))
        .expect("two functions");
    let (single, loops) = text.split_at(second);
    for op in [
        "AtomicRmw Add i32",
        "AtomicRmw Sub i32",
        "AtomicRmw And i32",
        "AtomicRmw Or i32",
        "AtomicRmw Xor i32",
        "AtomicRmw Add i64",
        "AtomicStore i32 order 4",
    ] {
        assert!(has(single, op), "missing {op} in\n{single}");
    }
    assert!(!has(single, "AtomicCas"), "{single}");
    let count = |needle: &str| {
        (0..loops.len())
            .filter(|&i| loops[i..].starts_with(needle))
            .count()
    };
    assert_eq!(count("AtomicCas i32 order 4/4"), 3, "{loops}");
    assert!(!has(loops, "AtomicRmw"), "{loops}");
}

#[test]
fn memory_orders_in_the_output() {
    let text = disassemble(
        &compile(
            b"int f(int *p, int order) {
                  int a = __atomic_load_n(p, __ATOMIC_RELAXED);
                  a += __atomic_load_n(p, __ATOMIC_CONSUME);
                  a += __atomic_load_n(p, __ATOMIC_ACQUIRE);
                  a += __atomic_load_n(p, order);
                  __atomic_store_n(p, 1, __ATOMIC_RELAXED);
                  __atomic_store_n(p, 2, __ATOMIC_RELEASE);
                  __atomic_store_n(p, 3, __ATOMIC_ACQUIRE);
                  a += __atomic_fetch_add(p, 1, __ATOMIC_ACQ_REL);
                  __atomic_thread_fence(__ATOMIC_RELEASE);
                  __atomic_thread_fence(__ATOMIC_RELAXED);
                  __atomic_signal_fence(__ATOMIC_SEQ_CST);
                  return a;
              }",
            "t.c",
            LINUX_X64,
        )
        .unwrap(),
    )
    .unwrap();
    for line in [
        "AtomicLoad i32 order 0",
        "AtomicLoad i32 order 1",
        "AtomicLoad i32 order 4",
        "AtomicStore i32 order 0",
        "AtomicStore i32 order 2",
        "AtomicStore i32 order 4",
        "AtomicRmw Add i32 order 3",
        "Fence order 2",
    ] {
        assert!(has(&text, line), "missing {line} in\n{text}");
    }
    let count = |needle: &str| {
        (0..text.len())
            .filter(|&i| text[i..].starts_with(needle))
            .count()
    };
    assert_eq!(
        count("AtomicLoad i32 order 1"),
        2,
        "consume is acquire\n{text}"
    );
    assert_eq!(
        count("Fence"),
        1,
        "relaxed and signal fences emit nothing\n{text}"
    );
}

#[test]
fn atomic_diagnostics() {
    let unsupported = "is not supported yet";
    assert_error("struct S { int a, b; }; _Atomic struct S s;", unsupported);
    assert_error("struct S { int a, b; }; _Atomic(struct S) s;", unsupported);
    assert_error(
        "struct S { char c[16]; }; void f(struct S *p, struct S *q) { __atomic_load(p, q, 5); }",
        unsupported,
    );
    assert_error(
        "_Atomic long double x; void f(void) { x = 1; }",
        "there are no 16-byte atomic operations",
    );
    // A 16-byte integer can be declared atomic; using it as one is the error.
    assert_error(
        "_Atomic __int128 x; void f(void) { x = 1; }",
        "there are no 16-byte atomic operations",
    );
    assert_error(
        "typedef int V __attribute__((vector_size(16))); _Atomic V v;",
        unsupported,
    );
    assert_error(
        "int f(int x) { return __atomic_load_n(x, 5); }",
        "must be a pointer",
    );
    assert_error(
        "int f(float *p) { return __atomic_fetch_add(p, 1, 5); }",
        "pointer to an integer",
    );
    assert_error(
        "int f(int *p) { return __atomic_fetch_add(p, 5); }",
        "three arguments",
    );
    assert_error(
        "int f(int *p, long long *e) { return __atomic_compare_exchange_n(p, e, 1, 0, 5, 5); }",
        "same size",
    );
    assert_error("_Atomic int x; void f(void) { x.y = 1; }", "not a struct");
}
