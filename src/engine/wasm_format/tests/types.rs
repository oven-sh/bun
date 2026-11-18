mod support;

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::sync::Barrier;
use std::thread;

use bun_engine_wasm_format::*;
use support::*;

thread_local! {
    static LIVE_BYTES: Cell<isize> = const { Cell::new(0) };
}

struct Counting;

// SAFETY: the system allocator does the work.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        LIVE_BYTES.set(LIVE_BYTES.get() + layout.size() as isize);
        // SAFETY: the caller keeps the same contract.
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        LIVE_BYTES.set(LIVE_BYTES.get() - layout.size() as isize);
        // SAFETY: the caller keeps the same contract.
        unsafe { System.dealloc(pointer, layout) }
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

fn with_types(groups: &[&[u8]]) -> Module {
    valid(&module(&[(TYPE, &list(groups))]))
}

fn address(module: &Module, index: u32) -> usize {
    module.types().rtt(TypeIndex(index)).address()
}

/// Each type is a subtype of the one before.
fn chain(length: usize, in_group: impl Fn(Vec<u8>) -> Vec<u8>) -> Vec<u8> {
    list_of(length, |i| match i {
        0 => vec![SUB, 0, STRUCT, 0],
        _ => in_group([&[SUB, 1][..], &unsigned(i - 1), &[STRUCT, 0]].concat()),
    })
}

#[test]
fn equal_types_have_one_index() {
    let module = with_types(&[
        &[REC, 2, STRUCT, 1, NULLABLE, 1, 0, STRUCT, 1, NULLABLE, 0, 0],
        &[REC, 2, STRUCT, 1, NULLABLE, 3, 0, STRUCT, 1, NULLABLE, 2, 0],
        &[REC, 2, STRUCT, 1, NULLABLE, 4, 0, STRUCT, 1, NULLABLE, 4, 0],
        &[FUNC, 1, REF, 0, 0],
        &[REC, 1, SUB_FINAL, 0, FUNC, 1, REF, 2, 0],
        &[SUB, 0, FUNC, 1, REF, 0, 0],
        &[FUNC, 0, 1, REF, 0],
        &[FUNC, 1, REF, 1, 0],
        &[REC, 0],
        &[ARRAY, I8, 0],
        &[ARRAY, I8, 1],
        &[STRUCT, 1, I8, 0],
    ]);
    let types = module.types();
    let first = |index| types.first_index(TypeIndex(index)).0;
    let firsts: Vec<_> = (0..types.len()).map(first).collect();
    assert_eq!(firsts, [0, 1, 0, 1, 4, 5, 6, 6, 8, 9, 10, 11, 12, 13]);
    for (a, b) in (0..14).flat_map(|a| (0..14).map(move |b| (a, b))) {
        assert_eq!(
            address(&module, a) == address(&module, b),
            first(a) == first(b)
        );
    }
    assert_eq!(
        types.func_type(TypeIndex(7)).params,
        [types.heap_type(TypeIndex(0)).non_null().into()]
    );
}

#[test]
fn a_heap_type_knows_its_kind() {
    let fields = [STRUCT, 3, NULLABLE, 0, 0, REF, 1, 0, REF, 2, 0];
    let module = with_types(&[&[
        &[REC, 3][..],
        &fields,
        &[ARRAY, REF, 2, 0, FUNC, 0, 1, REF, 1],
    ]
    .concat()]);
    let kind = |ty: ValType| ty.as_ref().unwrap().heap_type().abstract_type();
    let fields = module.types().struct_type(TypeIndex(0)).fields.iter();
    assert_eq!(
        fields
            .map(|field| kind(field.ty.storage.unpacked()))
            .collect::<Vec<_>>(),
        [
            AbstractHeapType::Struct,
            AbstractHeapType::Array,
            AbstractHeapType::Func
        ]
    );
    assert_eq!(
        kind(module.types().func_type(TypeIndex(2)).results[0]),
        AbstractHeapType::Array
    );
    let element = module.types().rtt(TypeIndex(1)).element().unwrap();
    assert_eq!(element.storage.unpacked(), HeapType::FUNC.non_null().into());
}

#[test]
fn modules_share_types() {
    let a = with_types(&[
        &[SUB, 0, STRUCT, 1, I64, 0],
        &[FUNC, 2, REF, 0, NULLABLE, 1, 1, EQREF],
    ]);
    let b = with_types(&[
        &[FUNC, 1, EXTERNREF, 0],
        &[SUB, 0, STRUCT, 1, I64, 0],
        &[SUB, 1, 1, STRUCT, 2, I64, 0, I8, 0],
        &[FUNC, 2, REF, 1, NULLABLE, 3, 1, EQREF],
    ]);
    assert_eq!(
        (address(&a, 0), address(&a, 1)),
        (address(&b, 1), address(&b, 3))
    );

    let value = |module: &Module, index, nullable| {
        let heap_type = module.types().heap_type(TypeIndex(index));
        module
            .types()
            .canonical_value(RefType::new(heap_type, nullable).into())
    };
    let plain = |ty: RefType| CanonicalValType::plain(ty.into());
    let none = HeapType::of(AbstractHeapType::None);
    assert!(value(&a, 0, true) == value(&b, 1, true));
    assert!(value(&a, 0, true) != value(&b, 1, false));
    assert!(value(&b, 2, false).is_subtype_of(&value(&a, 0, true)));
    assert!(!value(&b, 2, true).is_subtype_of(&value(&a, 0, false)));
    assert!(!value(&a, 0, false).is_subtype_of(&value(&b, 2, false)));
    assert!(value(&a, 0, false).is_subtype_of(&plain(RefType::EQREF)));
    assert!(!value(&a, 1, false).is_subtype_of(&plain(RefType::ANYREF)));
    assert!(!plain(HeapType::STRUCT.non_null()).is_subtype_of(&value(&a, 0, true)));
    assert!(plain(none.nullable()).is_subtype_of(&value(&a, 0, true)));
    assert!(!plain(none.nullable()).is_subtype_of(&value(&a, 0, false)));
    assert!(!plain(none.nullable()).is_subtype_of(&value(&a, 1, true)));

    let function = a.types().canonical(TypeIndex(1));
    drop(a);
    assert!(
        function
            .params()
            .eq([value(&b, 1, false), value(&b, 3, true)])
    );
    assert!(function.results().eq([plain(RefType::EQREF)]));
    let made = CanonicalType::function(&[ValType::EXTERNREF], &[]).unwrap();
    assert!(made == b.types().canonical(TypeIndex(0)));
}

#[test]
fn subtyping_of_abstract_types() {
    use AbstractHeapType::*;
    let above = |ty: AbstractHeapType| {
        let all = AbstractHeapType::ALL.into_iter();
        all.filter(|&other| other != ty && ty.is_subtype_of(other))
            .collect::<Vec<_>>()
    };
    let expected: [&[AbstractHeapType]; 12] = [
        &[],
        &[Func],
        &[],
        &[Extern],
        &[],
        &[Exn],
        &[],
        &[Any],
        &[Any, Eq],
        &[Any, Eq],
        &[Any, Eq],
        &[Any, Eq, I31, Struct, Array],
    ];
    assert_eq!(AbstractHeapType::ALL.map(above), expected);
}

#[test]
fn declared_subtypes_have_to_match() {
    let base = [SUB, 0, STRUCT, 0];
    let derived = [SUB, 1, 0, STRUCT, 1, I32, 0];
    let check = |sup: &[u8], sub: &[u8]| {
        let (sup, sub) = ([&[SUB, 0], sup].concat(), [&[SUB, 1, 2], sub].concat());
        let apart = parse(&module(&[(TYPE, &list(&[&base, &derived, &sup, &sub]))]));
        let group = [&[1, REC][..], &list(&[&base, &derived, &sup, &sub])].concat();
        assert_eq!(apart.is_ok(), parse(&module(&[(TYPE, &group)])).is_ok());
        apart.is_ok()
    };
    let cases: &[(&[u8], &[u8], bool)] = &[
        (
            &[FUNC, 1, REF, 1, 1, REF, 0],
            &[FUNC, 1, REF, 0, 1, REF, 1],
            true,
        ),
        (&[FUNC, 1, REF, 0, 0], &[FUNC, 1, REF, 1, 0], false),
        (&[FUNC, 0, 1, REF, 1], &[FUNC, 0, 1, REF, 0], false),
        (&[FUNC, 1, I32, 0], &[FUNC, 0, 1, I32], false),
        (
            &[STRUCT, 1, NULLABLE, 0, 0],
            &[STRUCT, 2, REF, 1, 0, I8, 1],
            true,
        ),
        (
            &[STRUCT, 1, NULLABLE, 2, 0],
            &[STRUCT, 1, NULLABLE, 3, 0],
            true,
        ),
        (&[STRUCT, 1, REF, 0, 1], &[STRUCT, 1, REF, 1, 1], false),
        (&[STRUCT, 1, I32, 0], &[STRUCT, 1, I32, 1], false),
        (&[STRUCT, 1, I32, 0], &[STRUCT, 1, I8, 0], false),
        (&[STRUCT, 1, I32, 0], &[STRUCT, 0], false),
        (&[STRUCT, 1, I32, 0], &[ARRAY, I32, 0], false),
        (&[ARRAY, ANYREF, 0], &[ARRAY, REF, 1, 0], true),
        (&[ARRAY, I8, 1], &[ARRAY, I16, 1], false),
    ];
    for &(sup, sub, expected) in cases {
        assert_eq!(check(sup, sub), expected, "{sub:?} {sup:?}");
    }
}

#[test]
fn depth_of_subtyping() {
    let forms: [&dyn Fn(usize) -> Vec<u8>; 3] = [
        &|length| chain(length, |ty| ty),
        &|length| chain(length, |ty| [vec![REC, 1], ty].concat()),
        &|length| [vec![1, REC], chain(length, |ty| ty)].concat(),
    ];
    let names = [
        "Type section's 64th",
        "recursion group's 0th",
        "recursion group's 64th",
    ];
    for (form, name) in forms.into_iter().zip(names) {
        let error = parse(&module(&[(TYPE, &form(65))])).err().unwrap();
        assert_eq!(
            error.reason(),
            format!("subtype depth for {name} signature exceeded the limits of 63")
        );

        let module = valid(&module(&[(TYPE, &form(64))]));
        let types = module.types();
        for (a, b) in (0..64).flat_map(|a| (0..64).map(move |b| (TypeIndex(a), TypeIndex(b)))) {
            assert_eq!(
                types.is_heap_subtype(types.heap_type(a), types.heap_type(b)),
                a >= b
            );
            assert_eq!(types.rtt(a).is_subtype_of(types.rtt(b)), a >= b);
        }
    }
}

#[test]
fn generated_code_finds_the_parts_of_a_type() {
    fn read<T: Copy>(address: usize, offset: i32) -> T {
        // SAFETY: the test keeps the module, and the offsets are those of values of `T`.
        unsafe { *std::ptr::with_exposed_provenance(address + offset as usize) }
    }
    let types = [
        chain(9, |ty| ty),
        vec![SUB_FINAL, 1, 8, STRUCT, 0, ARRAY, I8, 0],
    ]
    .concat();
    let module = valid(&module(&[(TYPE, &[&[11], &types[1..]].concat())]));
    for depth in 0..10 {
        let rtt = address(&module, depth);
        assert_eq!(read::<u32>(rtt, Rtt::DEPTH_OFFSET), depth);
        assert_eq!(read::<u8>(rtt, Rtt::KIND_OFFSET), TypeKind::Struct as u8);
        assert_eq!(read::<u8>(rtt, Rtt::IS_FINAL_OFFSET), u8::from(depth == 9));
        for i in 0..Rtt::INLINE_DISPLAY_LENGTH {
            let expected = if i <= depth { address(&module, i) } else { 0 };
            assert_eq!(
                read::<usize>(rtt, Rtt::DISPLAY_OFFSET + 8 * i as i32),
                expected
            );
        }
        for i in (0..=depth).filter(|_| depth >= Rtt::INLINE_DISPLAY_LENGTH) {
            let display = read(rtt, Rtt::LONG_DISPLAY_OFFSET);
            assert_eq!(read::<usize>(display, 8 * i as i32), address(&module, i));
        }
    }
    assert_eq!(
        read::<u8>(address(&module, 10), Rtt::KIND_OFFSET),
        TypeKind::Array as u8
    );
}

#[test]
fn layout_of_structs() {
    let layout = |fields: &[u8]| {
        let module =
            with_types(&[&[vec![STRUCT], list_of(fields.len(), |i| vec![fields[i], 0])].concat()]);
        let (ty, rtt) = (
            module.types().struct_type(TypeIndex(0)),
            module.types().rtt(TypeIndex(0)),
        );
        assert_eq!(rtt.struct_size(), ty.size);
        let offsets: Vec<_> = ty.fields.iter().map(|field| field.offset).collect();
        (offsets, ty.size, rtt.reference_offsets().to_vec())
    };
    assert_eq!(layout(&[]), (vec![], 0, vec![]));
    assert_eq!(layout(&[I8]), (vec![0], 8, vec![]));
    assert_eq!(
        layout(&[ANYREF, I32, FUNCREF, F32]),
        (vec![0, 8, 16, 12], 24, vec![0, 16])
    );
    assert_eq!(
        layout(&[I8, V128, I8, I8, F64, I16, I8, I8, EQREF]),
        (vec![0, 16, 1, 2, 8, 4, 3, 6, 32], 40, vec![32])
    );

    let kinds = [(I8, 1), (I16, 2), (I32, 4), (I64, 8), (V128, 16)];
    let mut random = Random(1);
    for _ in 0..200 {
        let fields: Vec<_> = (0..12).map(|_| kinds[random.below(5)]).collect();
        let codes: Vec<_> = fields.iter().map(|field| field.0).collect();
        let (offsets, size, _) = layout(&codes);
        assert_eq!(layout(&codes[..7]).0, offsets[..7]);
        let mut used = vec![false; size as usize];
        for (&offset, &(_, size)) in offsets.iter().zip(&fields) {
            assert_eq!(offset % size, 0);
            let bytes = &mut used[offset as usize..][..size as usize];
            assert!(!bytes.contains(&true));
            bytes.fill(true);
        }
    }
}

#[test]
fn groups_end_with_their_last_user() {
    let count = 20_000;
    let types = list_of(count, |i| match i {
        0 => vec![STRUCT, 2, F32, 1, I16, 1],
        _ => [&[ARRAY, NULLABLE][..], &signed(i - 1), &[0]].concat(),
    });
    let bytes = module(&[(TYPE, &types)]);
    let small_stack = thread::Builder::new().stack_size(128 << 10);
    let work = small_stack.spawn(move || {
        let before = LIVE_BYTES.get();
        let last = valid(&bytes).types().canonical(TypeIndex(count as u32 - 1));
        let held = LIVE_BYTES.get() - before;
        drop(last);
        (held, LIVE_BYTES.get() - before)
    });
    let (held, left) = work.unwrap().join().unwrap();
    assert!(held > 100 * count as isize, "{held}");
    assert!(left < 5 * count as isize, "{left}");
}

#[test]
fn threads_agree_on_types() {
    let bytes = module(&[(
        TYPE,
        &list(&[&[STRUCT, 2, F64, 1, V128, 1], &[ARRAY, REF, 0, 1]]),
    )]);
    let barrier = Barrier::new(4);
    let run = || {
        for _ in 0..300 {
            drop(valid(&bytes));
        }
        let module = valid(&bytes);
        barrier.wait();
        let addresses = (address(&module, 0), address(&module, 1));
        barrier.wait();
        addresses
    };
    thread::scope(|scope| {
        let addresses = [(); 4]
            .map(|()| scope.spawn(run))
            .map(|thread| thread.join().unwrap());
        assert_eq!(addresses, [addresses[0]; 4]);
    });
}
