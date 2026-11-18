mod support;

use bun_engine_wasm_compiler::abi::Trap;
use bun_engine_wasm_format::{CanonicalValType, GlobalIndex, RefType};
use bun_engine_wasm_runtime::{Bits, Reference};
use support::machine::Failure;
use support::{engine, for_each_mode, options, with_machine};

const MOST: Bits = 0xffff_ffff;

/// For arrays of four elements.
fn arrays(ty: &str, unpacked: &str, get: &str) -> String {
    format!(
        r#"(type $a (array (mut {ty})))
        (global $a (mut (ref null $a)) (ref.null $a)) (global $b (mut (ref null $a)) (ref.null $a))
        (func (export "new") (param {unpacked} {unpacked})
            (global.set $a (array.new $a (local.get 0) (i32.const 4)))
            (global.set $b (array.new $a (local.get 1) (i32.const 4))))
        (func (export "sized") (param i32) (result i32) (array.len (array.new_default $a (local.get 0))))
        (func (export "get") (result {unpacked} {unpacked} {unpacked} {unpacked})
            ({get} $a (global.get $a) (i32.const 0)) ({get} $a (global.get $a) (i32.const 1))
            ({get} $a (global.get $a) (i32.const 2)) ({get} $a (global.get $a) (i32.const 3)))
        (func (export "fill") (param i32 {unpacked} i32)
            (array.fill $a (global.get $a) (local.get 0) (local.get 1) (local.get 2)))
        (func (export "copy") (param i32 i32 i32)
            (array.copy $a $a (global.get $a) (local.get 0) (global.get $b) (local.get 1) (local.get 2)))
        (func (export "move") (param i32 i32 i32)
            (array.copy $a $a (global.get $a) (local.get 0) (global.get $a) (local.get 1) (local.get 2)))"#
    )
}

#[test]
fn arrays_of_all_sizes_of_elements() {
    let i31 = |value| Bits::from(Reference::from_i31(value));
    let kinds = [
        ("i8", "i32", "array.get_u", 0, [0x81, 0x72]),
        ("i16", "i32", "array.get_u", 1, [0x8182, 0x7172]),
        ("f32", "f32", "array.get", 2, [0x7fa0_0001, 0x8000_0000]),
        (
            "i64",
            "i64",
            "array.get",
            3,
            [1 << 63 | 1, 0x1234_5678_9abc],
        ),
        ("anyref", "anyref", "array.get", 3, [i31(1), i31(-1)]),
        ("v128", "v128", "array.get", 4, [1 << 127 | 5, 7 << 64]),
    ];
    for_each_mode(|machine| {
        for (ty, unpacked, get, log2_size, [x, y]) in kinds {
            let instance = machine.load(&arrays(ty, unpacked, get), &[]);
            let call = |name, arguments: &[Bits]| machine.invoke(instance, name, arguments);
            let trap = |trap| Err(Failure::Trap(trap));
            assert_eq!(call("fill", &[0, x, 0]), trap(Trap::NullReference));
            assert_eq!(call("copy", &[0, 0, 0]), trap(Trap::NullReference));
            call("new", &[x, y]).unwrap();
            for (start, count) in [(5, 0), (4, 1), (1, 4), (1, MOST), (MOST, 1), (MOST, 2)] {
                assert_eq!(
                    call("fill", &[start, y, count]),
                    trap(Trap::ArrayFillOutOfBounds)
                );
                if start != 1 || count != 4 {
                    let beyond = trap(Trap::ArrayCopyOutOfBounds);
                    assert_eq!(call("copy", &[start, 0, count]), beyond);
                    assert_eq!(call("copy", &[0, start, count]), beyond);
                }
            }
            let steps = [
                ("fill", [4, y, 0], [x, x, x, x]),
                ("fill", [1, y, 1], [x, y, x, x]),
                ("move", [1, 0, 3], [x, x, y, x]),
                ("move", [0, 1, 3], [x, y, x, x]),
                ("copy", [2, 2, 2], [x, y, y, y]),
                ("copy", [4, 4, 0], [x, y, y, y]),
                ("fill", [0, x, 4], [x, x, x, x]),
            ];
            for (name, arguments, expected) in steps {
                call(name, &arguments).unwrap();
                assert_eq!(call("get", &[]).unwrap(), expected, "{ty} {name}");
            }
            let too_many = (1 << (30 - log2_size)) + 1;
            assert_eq!(call("sized", &[too_many]), trap(Trap::ArrayNewFailure));
            assert_eq!(call("sized", &[MOST]), trap(Trap::ArrayNewFailure));
        }
    });
}

#[test]
fn arrays_from_segments() {
    let source = r#"
        (type $a (array (mut i16))) (type $f (array (mut funcref)))
        (data $d "\01\02\03\04\05") (elem $e func $one $one) (func $one)
        (global $a (mut (ref null $a)) (ref.null $a)) (global $f (mut (ref null $f)) (ref.null $f))
        (func (export "new_data") (param i32 i32) (global.set $a (array.new_data $a $d (local.get 0) (local.get 1))))
        (func (export "new_elem") (param i32 i32) (global.set $f (array.new_elem $f $e (local.get 0) (local.get 1))))
        (func (export "init_data") (param i32 i32 i32)
            (array.init_data $a $d (global.get $a) (local.get 0) (local.get 1) (local.get 2)))
        (func (export "init_elem") (param i32 i32 i32)
            (array.init_elem $f $e (global.get $f) (local.get 0) (local.get 1) (local.get 2)))
        (func (export "get") (result i32 i32)
            (array.get_u $a (global.get $a) (i32.const 0)) (array.get_u $a (global.get $a) (i32.const 1)))"#;
    with_machine(engine(options()), |machine| {
        let instance = machine.load(source, &[]);
        let call = |name, arguments: &[Bits]| machine.invoke(instance, name, arguments);
        let trap = |trap| Err(Failure::Trap(trap));
        assert_eq!(call("init_data", &[0, 0, 0]), trap(Trap::NullArrayInitData));
        assert_eq!(call("init_elem", &[0, 0, 0]), trap(Trap::NullArrayInitElem));
        for [src, count] in [[2, 2], [6, 0], [0, 0x8000_0000], [MOST, 1]] {
            assert_eq!(
                call("new_data", &[src, count]),
                trap(Trap::ArrayNewDataFailure)
            );
            assert_eq!(
                call("new_elem", &[src, count]),
                trap(Trap::ArrayNewElemFailure)
            );
        }
        call("new_data", &[1, 2]).unwrap();
        call("new_elem", &[0, 2]).unwrap();
        assert_eq!(call("get", &[]), Ok(vec![0x0302, 0x0504]));
        for range in [
            [1, 0, 2],
            [3, 0, 0],
            [0, 4, 1],
            [0, 6, 0],
            [1, 0, MOST],
            [MOST, 0, 1],
        ] {
            assert_eq!(
                call("init_data", &range),
                trap(Trap::ArrayInitDataOutOfBounds)
            );
            assert_eq!(
                call("init_elem", &range),
                trap(Trap::ArrayInitElemOutOfBounds)
            );
        }
        call("init_data", &[1, 0, 1]).unwrap();
        call("init_elem", &[2, 2, 0]).unwrap();
        assert_eq!(call("get", &[]), Ok(vec![0x0302, 0x0201]));
    });
}

#[test]
fn values_of_the_host_have_types() {
    with_machine(engine(options()), |machine| {
        let instance = machine.load(
            r#"(type $base (sub (struct))) (type $derived (sub $base (struct (field i32)))) (type $a (array i8))
            (global (export "0") (ref $base) (struct.new $base))
            (global (export "1") (ref $derived) (struct.new_default $derived))
            (global (export "2") (ref $a) (array.new_fixed $a 0))"#,
            &[],
        );
        let global = |index| instance.global(GlobalIndex(index)).unwrap();
        let [base, derived, array] = [0, 1, 2].map(|it| Reference(global(it).get() as u64));
        let values = [
            Reference::NULL,
            Reference::from_i31(0),
            machine.opaque(0),
            Reference(0x06),
            base,
            derived,
            array,
        ];
        let plain = |ty: RefType| CanonicalValType::plain(ty.into());
        let non_null = |ty: RefType| plain(ty.heap_type().non_null());
        let cases = [
            (plain(RefType::ANYREF), "1111111"),
            (non_null(RefType::ANYREF), "0111111"),
            (plain(RefType::EQREF), "1100111"),
            (non_null(RefType::I31REF), "0100000"),
            (non_null(RefType::STRUCTREF), "0000110"),
            (non_null(RefType::ARRAYREF), "0000001"),
            (global(0).ty().clone(), "0000110"),
            (global(1).ty().clone(), "0000010"),
            (global(2).ty().clone(), "0000001"),
        ];
        for (ty, expected) in cases {
            let (erased, rtt) = (
                ty.erased().as_ref().unwrap(),
                ty.defined().map(|it| it.rtt()),
            );
            // SAFETY: values of the host.
            let actual = values.map(|it| unsafe { machine.engine().has_type(it, erased, rtt) });
            assert_eq!(actual.map(|it| b'0' + u8::from(it)), expected.as_bytes());
        }
    });
}
