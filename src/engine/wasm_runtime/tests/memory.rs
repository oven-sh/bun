#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::clone_on_ref_ptr
)]

mod support;

use bun_engine_asm::Width;
use bun_engine_wasm_compiler::abi::{MemoryMode, Trap};
use bun_engine_wasm_format::{Limits, Memory as MemoryType, MemoryIndex};
use bun_engine_wasm_runtime::{GrowError, Options};
use support::link::Item;
use support::machine::{Failure, Machine};
use support::{engine, for_each_mode, options, with_machine};

const PAGE: u64 = 1 << 16;
const OUT_OF_BOUNDS: Result<Vec<u128>, Failure> = Err(Failure::Trap(Trap::MemoryOutOfBounds));

fn ty(address: Width, initial: u64, maximum: Option<u64>, shared: bool) -> MemoryType {
    MemoryType {
        address,
        pages: Limits { initial, maximum },
        shared,
    }
}

const ACCESSES: &str = r#"
    (func (export "load") (param i32) (result i32) (i32.load8_u (local.get 0)))
    (func (export "load_wide") (param i32) (result i64) (i64.load (local.get 0)))
    (func (export "load_far") (param i32) (result i32) (i32.load8_u offset=0xffffffff (local.get 0)))
    (func (export "load_guard") (param i32) (result i64) (i64.load offset=0x7ffffff8 (local.get 0)))
    (func (export "store") (param i32 i32) (i32.store8 (local.get 0) (local.get 1)))
    (func (export "size") (result i32) memory.size)
    (func (export "grow") (param i32) (result i32) (memory.grow (local.get 0)))
    (func (export "grow_and_store") (param i32)
        (drop (i32.load (i32.const 0)))
        (drop (memory.grow (i32.const 1)))
        (i32.store8 (local.get 0) (i32.const 9)))
    (func (export "fill") (param i32 i32 i32) (memory.fill (local.get 0) (local.get 1) (local.get 2)))
    (func (export "copy") (param i32 i32 i32) (memory.copy (local.get 0) (local.get 1) (local.get 2)))"#;

#[test]
fn accesses_end_where_the_memory_ends() {
    for_each_mode(|machine| {
        for declaration in ["(memory 1)", "(memory 1 3)", "(memory 1 3 shared)"] {
            let instance = machine.load(&format!("{declaration} {ACCESSES}"), &[]);
            let call = |name, arguments: &[u128]| machine.invoke(instance, name, arguments);
            for pages in [1, 2] {
                let end = u128::from(pages * PAGE);
                assert_eq!(call("size", &[]), Ok(vec![pages.into()]));
                assert_eq!(call("load", &[end - 1]), Ok(vec![0]));
                assert_eq!(call("load", &[end]), OUT_OF_BOUNDS);
                assert_eq!(call("load_wide", &[end - 8]), Ok(vec![0]));
                assert_eq!(call("load_wide", &[end - 7]), OUT_OF_BOUNDS);
                assert_eq!(call("store", &[end, 1]), OUT_OF_BOUNDS);
                for address in [0, 1, end, 0x7fff_ffff, 0xffff_ffff] {
                    assert_eq!(call("load_far", &[address]), OUT_OF_BOUNDS);
                    assert_eq!(call("load_guard", &[address]), OUT_OF_BOUNDS);
                }
                assert_eq!(call("load", &[0xffff_ffff]), OUT_OF_BOUNDS);
                assert_eq!(call("grow", &[1]), Ok(vec![pages.into()]));
            }
        }
    });
}

#[test]
fn a_memory_without_pages() {
    for_each_mode(|machine| {
        for declaration in ["(memory 0)", "(memory 0 0)", "(memory 0 0 shared)"] {
            let instance = machine.load(&format!("{declaration} {ACCESSES}"), &[]);
            let call = |name, arguments: &[u128]| machine.invoke(instance, name, arguments);
            assert_eq!(call("load", &[0]), OUT_OF_BOUNDS);
            assert_eq!(call("fill", &[0, 1, 0]), Ok(vec![]));
            assert_eq!(call("copy", &[0, 0, 0]), Ok(vec![]));
            assert_eq!(call("fill", &[1, 1, 0]), OUT_OF_BOUNDS);
            assert_eq!(call("grow", &[0]), Ok(vec![0]));
        }
    });
}

#[test]
fn bulk_operations_check_before_they_write() {
    for_each_mode(|machine| {
        let instance = machine.load(&format!("(memory 1) {ACCESSES}"), &[]);
        let call = |name, arguments: &[u128]| machine.invoke(instance, name, arguments);
        let bytes = |start, count| {
            let mut bytes = vec![0; count];
            instance
                .memory(MemoryIndex(0))
                .read(start, &mut bytes)
                .unwrap();
            bytes
        };
        let end = u128::from(PAGE);
        assert_eq!(call("fill", &[end - 2, 0x1ab, 3]), OUT_OF_BOUNDS);
        assert_eq!(call("fill", &[1, 7, 0xffff_ffff]), OUT_OF_BOUNDS);
        assert_eq!(bytes(PAGE - 2, 2), [0, 0]);
        assert_eq!(call("fill", &[end - 2, 0x1ab, 2]), Ok(vec![]));
        assert_eq!(bytes(PAGE - 3, 3), [0, 0xab, 0xab]);
        assert_eq!(call("fill", &[end, 1, 0]), Ok(vec![]));

        let memory = instance.memory(MemoryIndex(0));
        memory.write(0, &[1, 2, 3, 4, 5]).unwrap();
        assert_eq!(call("copy", &[1, 0, 4]), Ok(vec![]));
        assert_eq!(bytes(0, 5), [1, 1, 2, 3, 4]);
        assert_eq!(call("copy", &[0, 2, 3]), Ok(vec![]));
        assert_eq!(bytes(0, 5), [2, 3, 4, 3, 4]);
        assert_eq!(call("copy", &[0, end - 1, 2]), OUT_OF_BOUNDS);
        assert_eq!(call("copy", &[end - 1, 0, 2]), OUT_OF_BOUNDS);
        assert_eq!(bytes(0, 1), [2]);
        assert_eq!(memory.write(u64::MAX, &[1]), Err(Trap::MemoryOutOfBounds));
        assert_eq!(memory.read(PAGE, &mut [0]), Err(Trap::MemoryOutOfBounds));
    });
}

#[test]
fn every_instance_sees_the_growth() {
    for_each_mode(|machine| {
        for shared in [false, true] {
            let memory = machine
                .new_memory(ty(Width::W32, 1, Some(9), shared))
                .unwrap();
            let item = Item::Memory(memory.clone());
            let kind = if shared { "shared" } else { "" };
            let source = format!(r#"(import "" "m" (memory 1 9 {kind})) {ACCESSES}"#);
            let instances = [(); 3].map(|()| machine.load(&source, &[("m", &item)]));
            machine
                .invoke(instances[0], "grow_and_store", &[PAGE.into()])
                .unwrap();
            assert_eq!(memory.grow(1), Ok(2));
            for instance in instances {
                assert_eq!(machine.invoke(instance, "size", &[]), Ok(vec![3]));
                assert_eq!(
                    machine.invoke(instance, "load", &[PAGE.into()]),
                    Ok(vec![9])
                );
                let last = (3 * PAGE - 1).into();
                assert_eq!(machine.invoke(instance, "load", &[last]), Ok(vec![0]));
            }
        }
    });
}

#[test]
fn why_growth_fails() {
    for_each_mode(|machine| {
        for shared in [false, true] {
            let narrow = machine
                .new_memory(ty(Width::W32, 1, Some(2), shared))
                .unwrap();
            assert_eq!(narrow.grow(2), Err(GrowError::ExceedsMaximum));
            assert_eq!(narrow.grow(0xffff), Err(GrowError::ExceedsMaximum));
            assert_eq!(narrow.grow(0x1_0000), Err(GrowError::InvalidSize));
            assert_eq!(narrow.grow(u64::MAX), Err(GrowError::InvalidSize));
            let wide = machine
                .new_memory(ty(Width::W64, 1, Some(1 << 48), shared))
                .unwrap();
            assert_eq!(wide.mode(), MemoryMode::Checked);
            assert_eq!(wide.grow(0x1_0000), Err(GrowError::OutOfMemory));
            assert_eq!(wide.grow(1 << 48), Err(GrowError::InvalidSize));
            assert_eq!(wide.grow(u64::MAX), Err(GrowError::InvalidSize));
            assert_eq!((narrow.page_count(), wide.page_count()), (1, 1));
        }
        assert!(
            machine
                .new_memory(ty(Width::W64, 0x1_0001, None, false))
                .is_none()
        );
        assert!(machine.growths.borrow().is_empty());
    });
}

#[test]
fn the_host_hears_of_growth() {
    for_each_mode(|machine| {
        let plain = machine.new_memory(ty(Width::W32, 1, None, false)).unwrap();
        let shared = machine
            .new_memory(ty(Width::W32, 1, Some(4), true))
            .unwrap();
        for memory in [&plain, &shared] {
            assert_eq!(memory.grow(0), Ok(1));
            assert_eq!(memory.grow(2), Ok(1));
        }
        let expected = [(PAGE, PAGE), (PAGE, 3 * PAGE), (PAGE, 3 * PAGE)];
        assert_eq!(*machine.growths.borrow(), expected);
    });
}

#[test]
fn what_is_guarded() {
    let mode = |machine: &Machine, ty| machine.new_memory(ty).unwrap().mode();
    with_machine(engine(options()), |machine| {
        assert_eq!(
            mode(machine, ty(Width::W32, 0, None, false)),
            MemoryMode::Guarded
        );
        assert_eq!(
            mode(machine, ty(Width::W32, 1, Some(1), true)),
            MemoryMode::Guarded
        );
        assert_eq!(
            mode(machine, ty(Width::W32, 0, Some(0), false)),
            MemoryMode::Checked
        );
        let instance = machine.load("(memory 1) (memory 1)", &[]);
        assert_eq!(instance.mode(), MemoryMode::Guarded);
        assert_eq!(instance.memory(MemoryIndex(1)).mode(), MemoryMode::Checked);
        let second = Item::Memory(instance.memory(MemoryIndex(1)).clone());
        let importer = machine.load(r#"(import "" "m" (memory 1))"#, &[("m", &second)]);
        assert_eq!(importer.mode(), MemoryMode::Checked);
    });
    let without_faults = engine(Options {
        handle_faults: false,
        ..options()
    });
    assert_eq!(without_faults.layout().null_guard_size, 0);
    with_machine(without_faults, |machine| {
        assert_eq!(
            mode(machine, ty(Width::W32, 1, None, false)),
            MemoryMode::Checked
        );
    });
}

#[test]
fn all_four_gigabytes() {
    for_each_mode(|machine| {
        let instance = machine.load(&format!("(memory 0xffff) {ACCESSES}"), &[]);
        let call = |name, arguments: &[u128]| machine.invoke(instance, name, arguments);
        assert_eq!(call("load", &[0xffff_0000]), OUT_OF_BOUNDS);
        assert_eq!(call("grow", &[1]), Ok(vec![0xffff]));
        assert_eq!(call("size", &[]), Ok(vec![0x1_0000]));
        assert_eq!(call("store", &[0xffff_ffff, 5]), Ok(vec![]));
        assert_eq!(call("load_far", &[0]), Ok(vec![5]));
        assert_eq!(call("load_far", &[1]), OUT_OF_BOUNDS);
        assert_eq!(call("load_wide", &[0xffff_fff8]), Ok(vec![5 << 56]));
        assert_eq!(call("load_wide", &[0xffff_fff9]), OUT_OF_BOUNDS);
        assert_eq!(call("copy", &[0, 0xffff_ffff, 1]), Ok(vec![]));
        assert_eq!(call("copy", &[0, 0xffff_ffff, 2]), OUT_OF_BOUNDS);
        assert_eq!(call("grow", &[1]), Ok(vec![0xffff_ffff]));
        let from_the_start = machine.new_memory(ty(Width::W32, 0x1_0000, None, false));
        assert_eq!(from_the_start.unwrap().len(), 1 << 32);
    });
}

#[test]
fn addresses_of_64_bits() {
    let source = r#"
        (memory i64 1)
        (data $d "abc")
        (func (export "grow") (param i64) (result i64) (memory.grow (local.get 0)))
        (func (export "fill") (param i64 i64) (memory.fill (local.get 0) (i32.const 1) (local.get 1)))
        (func (export "init") (param i64) (memory.init $d (local.get 0) (i32.const 0) (i32.const 3)))
        (func (export "notify") (param i64) (result i32)
            (memory.atomic.notify offset=0xfffffffffffffffc (local.get 0) (i32.const 1)))"#;
    for_each_mode(|machine| {
        let instance = machine.load(source, &[]);
        let call = |name, arguments: &[u128]| machine.invoke(instance, name, arguments);
        let most = u128::from(u64::MAX);
        assert_eq!(call("grow", &[most]), Ok(vec![most]));
        assert_eq!(call("fill", &[most, 2]), OUT_OF_BOUNDS);
        assert_eq!(call("fill", &[2, most]), OUT_OF_BOUNDS);
        assert_eq!(call("fill", &[1 << 32, 0]), OUT_OF_BOUNDS);
        assert_eq!(call("init", &[most - 1]), OUT_OF_BOUNDS);
        assert_eq!(call("notify", &[4]), OUT_OF_BOUNDS);
        assert_eq!(call("init", &[u128::from(PAGE) - 3]), Ok(vec![]));
    });
}

#[cfg(target_os = "linux")]
#[test]
fn pages_are_not_touched() {
    let resident = |memory: &bun_engine_wasm_runtime::Memory| {
        let pages = memory.pages();
        let mut flags = vec![0u8; pages.len() as usize / bun_alloc::page_size()];
        // SAFETY: a byte for each page of the range, which is mapped.
        let status = unsafe {
            libc::mincore(
                pages.base().cast(),
                pages.len() as usize,
                flags.as_mut_ptr(),
            )
        };
        assert_eq!(status, 0);
        flags.iter().filter(|&flag| flag & 1 != 0).count()
    };
    for_each_mode(|machine| {
        let memory = machine
            .new_memory(ty(Width::W32, 1000, None, false))
            .unwrap();
        memory.grow(1000).unwrap();
        assert_eq!(resident(&memory), 0);
    });
}
