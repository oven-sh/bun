//! Tests for C11 atomics: `_Atomic`, the `__atomic_*` / `__sync_*` builtins and `<stdatomic.h>`.

use crate::tests::{LINUX_X64, has};
use crate::{compile, disassemble};

#[test]
fn operators_on_atomic_objects() {
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
