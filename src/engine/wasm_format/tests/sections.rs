mod support;

use bun_engine_asm::Width;
use bun_engine_wasm_format::limits::*;
use bun_engine_wasm_format::*;
use support::*;

const VOID: &[u8] = &[1, FUNC, 0, 0];
const ONE_BODY: &[u8] = &[1, 2, 0, 0x0b];

#[test]
fn imports_come_first_in_each_index_space() {
    let imports = list(&[
        &[1, b'a', 1, b'f', 0, 1],
        &[1, b'a', 1, b't', 1, REF, FUNCREF, 1, 2, 3],
        &[1, b'b', 0, 2, 3, 1, 2],
        &[0, 2, 0xc3, 0xa9, 3, I64, 1],
        &[1, b'c', 1, b'e', 4, 0, 0],
    ]);
    let exports = list(&[
        &[1, b'f', 0, 1],
        &[1, b't', 1, 1],
        &[1, b'm', 2, 0],
        &[0, 3, 1],
        &[1, b'e', 4, 1],
    ]);
    let module = valid(&module(&[
        (TYPE, &list(&[&[FUNC, 0, 0], &[FUNC, 0, 0]])),
        (IMPORT, &imports),
        (FUNCTION, &[2, 0, 1]),
        (TABLE, &list(&[&[EMPTY, 0, REF, 0, 5, 7, 8, 0xd2, 2, 0x0b]])),
        (MEMORY, &list(&[&[4, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01]])),
        (TAG, &[1, 0, 1]),
        (GLOBAL, &list(&[&[F32, 0, 0x43, 1, 2, 3, 4, 0x0b]])),
        (EXPORT, &exports),
        (START, &[2]),
        (CODE, &code(&[&[0, 0x0b], &[0, 0x0b]])),
    ]));

    let names = |import: &Import| {
        (
            module.bytes(import.module),
            module.bytes(import.field),
            import.item,
        )
    };
    assert_eq!(
        module.imports().iter().map(names).collect::<Vec<_>>(),
        [
            (&b"a"[..], &b"f"[..], Extern::Func(FuncIndex(0))),
            (b"a", b"t", Extern::Table(TableIndex(0))),
            (b"b", b"", Extern::Memory(MemoryIndex(0))),
            (b"", "é".as_bytes(), Extern::Global(GlobalIndex(0))),
            (b"c", b"e", Extern::Tag(TagIndex(0))),
        ]
    );
    let name = |export: &Export| (module.bytes(export.name), export.item);
    assert_eq!(
        module.exports().iter().map(name).collect::<Vec<_>>(),
        [
            (&b"f"[..], Extern::Func(FuncIndex(1))),
            (b"t", Extern::Table(TableIndex(1))),
            (b"m", Extern::Memory(MemoryIndex(0))),
            (b"", Extern::Global(GlobalIndex(1))),
            (b"e", Extern::Tag(TagIndex(1))),
        ]
    );
    let one_of_each = ImportCounts {
        funcs: 1,
        tables: 1,
        memories: 1,
        globals: 1,
        tags: 1,
    };
    assert_eq!(module.imported(), one_of_each);
    assert_eq!(module.funcs(), [TypeIndex(0); 3]);
    assert_eq!(module.tags(), [TypeIndex(0); 2]);
    assert_eq!(module.start(), Some(FuncIndex(2)));
    assert_eq!(module.code_index(FuncIndex(0)), None);
    assert_eq!(module.code_index(FuncIndex(2)), Some(CodeIndex(1)));
    assert_eq!(module.func_index(CodeIndex(1)), FuncIndex(2));
    assert_eq!(
        [0, 1, 2].map(|func| module.is_declared(FuncIndex(func))),
        [false, true, true]
    );

    let limits = |initial, maximum| Limits { initial, maximum };
    let table = |element, address, limits, init| Table {
        element,
        address,
        limits,
        init,
    };
    let defined = module.types().heap_type(TypeIndex(0)).non_null();
    let init = Some(ConstExpr::RefFunc(FuncIndex(2)));
    assert_eq!(
        module.tables(),
        [
            table(
                HeapType::FUNC.non_null(),
                Width::W32,
                limits(2, Some(3)),
                None
            ),
            table(defined, Width::W64, limits(7, Some(8)), init),
        ]
    );
    let memory = |address, pages, shared| Memory {
        address,
        pages,
        shared,
    };
    assert_eq!(
        module.memories(),
        [
            memory(Width::W32, limits(1, Some(2)), true),
            memory(Width::W64, limits(1 << 35, None), false),
        ]
    );
    let global = |ty, mutable, exported, init| Global {
        ty,
        mutable,
        exported,
        init,
    };
    assert_eq!(
        module.globals(),
        [
            global(ValType::I64, true, false, None),
            global(ValType::F32, false, true, Some(ConstExpr::F32(0x0403_0201))),
        ]
    );
}

#[test]
fn every_form_of_segment() {
    let elems = list(&[
        &[0, 0x41, 0x7f, 0x0b, 1, 0],
        &[1, 0, 2, 1, 0],
        &[2, 1, 0x42, 5, 0x0b, 0, 0],
        &[3, 0, 1, 2],
        &[4, 0x23, 0, 0x0b, 2, 0xd0, FUNCREF, 0x0b, 0xd2, 3, 0x0b],
        &[5, EXTERNREF, 1, 0x23, 1, 0x0b],
        &[6, 0, 0x41, 1, 0x41, 2, 0x6a, 0x0b, REF, FUNCREF, 0],
        &[7, I31REF, 1, 0x41, 9, 0xfb, 28, 0x0b],
    ]);
    let data = list(&[
        &[0, 0x41, 3, 0x0b, 2, b'a', b'b'],
        &[1, 0],
        &[2, 1, 0x42, 1, 0x42, 2, 0x7e, 0x0b, 1, b'c'],
    ]);
    let bytes = module(&[
        (TYPE, VOID),
        (
            IMPORT,
            &list(&[&[0, 0, 3, I32, 0], &[0, 0, 3, EXTERNREF, 0]]),
        ),
        (FUNCTION, &[5, 0, 0, 0, 0, 0]),
        (TABLE, &list(&[&[FUNCREF, 0, 0], &[FUNCREF, 4, 0]])),
        (MEMORY, &list(&[&[0, 0], &[4, 0]])),
        (ELEMENT, &elems),
        (CODE, &code(&[&[0, 0x0b]; 5].map(|body| &body[..]))),
        (DATA, &data),
    ]);
    let module = valid(&bytes);
    let code_at = |expr| match expr {
        ConstExpr::Code(code) => &bytes[code.offset() as usize..],
        _ => panic!("{expr:?}"),
    };

    let func = |index| ConstExpr::RefFunc(FuncIndex(index));
    let global = |index| ConstExpr::GlobalGet(GlobalIndex(index));
    let active = |table, offset| ElemMode::Active {
        table: TableIndex(table),
        offset,
    };
    let items = |elem| {
        module
            .elem_items(elem)
            .iter()
            .map(|item| item.expr())
            .collect::<Vec<_>>()
    };
    let summary = |elem| {
        (
            module.elem(ElemIndex(elem)).ty,
            module.elem(ElemIndex(elem)).mode,
        )
    };
    let non_null = HeapType::FUNC.non_null();
    assert_eq!(
        [0, 1, 2, 3, 4, 5, 7].map(summary),
        [
            (non_null, active(0, ConstExpr::I32(-1))),
            (non_null, ElemMode::Passive),
            (non_null, active(1, ConstExpr::I64(5))),
            (non_null, ElemMode::Declared),
            (RefType::FUNCREF, active(0, global(0))),
            (RefType::EXTERNREF, ElemMode::Passive),
            (RefType::I31REF, ElemMode::Declared),
        ]
    );
    assert_eq!(
        module.elems()[..7].iter().map(items).collect::<Vec<_>>(),
        [
            vec![func(0)],
            vec![func(1), func(0)],
            vec![],
            vec![func(2)],
            vec![ConstExpr::RefNull, func(3)],
            vec![global(1)],
            vec![],
        ]
    );
    assert!(code_at(items(&module.elems()[7])[0]).starts_with(&[0x41, 9, 0xfb, 28, 0x0b]));
    let ElemMode::Active { offset, .. } = module.elems()[6].mode else {
        panic!();
    };
    assert!(code_at(offset).starts_with(&[0x41, 1, 0x41, 2, 0x6a, 0x0b]));
    assert_eq!(
        [0, 1, 2, 3, 4].map(|func| module.is_declared(FuncIndex(func))),
        [true, true, true, true, false]
    );

    let contents = [0, 1, 2].map(|data| module.bytes(module.data(DataIndex(data)).bytes));
    assert_eq!(contents, [&b"ab"[..], b"", b"c"]);
    let at_three = DataMode::Active {
        memory: MemoryIndex(0),
        offset: ConstExpr::I32(3),
    };
    assert_eq!(module.data_segments()[0].mode, at_three);
    assert_eq!(module.data_segments()[1].mode, DataMode::Passive);
    let DataMode::Active { memory, offset } = module.data_segments()[2].mode else {
        panic!();
    };
    assert_eq!(memory, MemoryIndex(1));
    assert!(code_at(offset).starts_with(&[0x42, 1, 0x42, 2, 0x7e, 0x0b]));
}

#[test]
fn names() {
    let with_names = |sections: &[&[u8]]| {
        let mut bytes = module(&[
            (TYPE, VOID),
            (IMPORT, &list(&[&[0, 0, 0, 0]; 3].map(|i| &i[..]))),
        ]);
        for section in sections {
            bytes.push(0);
            bytes.extend(sized(&custom("name", section)));
        }
        valid(&bytes)
    };
    let funcs = |module: &Module| {
        let name = |func| {
            Some(
                module
                    .bytes(module.names()?.func(FuncIndex(func))?)
                    .to_vec(),
            )
        };
        [0, 1, 2, 3].map(name)
    };
    let named = |name: &str| Some(name.as_bytes().to_vec());

    let locals = [2, 6, 1, 0, 1, 0, 1, b'x'];
    let all = [
        &[0, 2, 1, b'm', 1, 6, 2, 0, 1, b'a', 2, 0][..],
        &locals,
        &[9, 1, 0xff],
    ]
    .concat();
    let module = with_names(&[&all, &[1, 4, 1, 1, 1, b'z']]);
    assert_eq!(module.custom_sections().len(), 2);
    assert_eq!(
        module.bytes(module.names().unwrap().module().unwrap()),
        b"m"
    );
    assert_eq!(funcs(&module), [named("a"), None, named(""), None]);

    let unordered = with_names(&[&[1, 10, 3, 2, 1, b'a', 0, 1, b'b', 2, 1, b'c']]);
    assert_eq!(funcs(&unordered), [named("b"), None, named("c"), None]);
    assert_eq!(unordered.names().unwrap().module(), None);

    assert!(with_names(&[]).names().is_none());
    let malformed: [&[u8]; 8] = [
        &[1, 4, 1, 3, 1, b'a'],
        &[1, 4, 1, 0, 1, 0xff],
        &[1, 5, 1, 0, 1, b'a'],
        &[1, 3, 1, 0, 1, b'a'],
        &[2, 2, 1, 0],
        &[0x80, 0],
        &[1, 4, 1, 0, 1, b'a', 0, 2, 1, b'm'],
        &[1, 4, 1, 0, 1, b'a', 1, 4, 1, 1, 1, b'b'],
    ];
    for section in malformed {
        assert!(with_names(&[section]).names().is_none(), "{section:?}");
        let second = with_names(&[section, &[1, 4, 1, 1, 1, b'z']]);
        assert_eq!(funcs(&second), [None, named("z"), None, None]);
    }
}

#[test]
fn branch_hints() {
    let hints = |payload: &[u8]| {
        let module = valid(&module(&[(
            0,
            &custom("metadata.code.branch_hint", payload),
        )]));
        let pairs = |func| {
            let hints = module.branch_hints().of(FuncIndex(func));
            hints
                .iter()
                .map(|hint| (hint.offset, hint.likely))
                .collect::<Vec<_>>()
        };
        [0, 1, 2].map(pairs)
    };
    let first = vec![(3, true), (5, false)];
    assert_eq!(
        hints(&[2, 0, 2, 3, 1, 1, 5, 1, 0, 2, 1, 9, 1, 1]),
        [first.clone(), vec![], vec![(9, true)]]
    );
    let malformed: [&[u8]; 5] = [
        &[0, 1, 9, 1, 1],
        &[2, 2, 9, 1, 1, 9, 1, 1],
        &[2, 1, 9, 2, 1],
        &[2, 1, 9, 1, 2],
        &[2, 1, 9, 1],
    ];
    for second in malformed {
        let payload = [&[2, 0, 2, 3, 1, 1, 5, 1, 0], second].concat();
        assert_eq!(
            hints(&payload),
            [first.clone(), vec![], vec![]],
            "{second:?}"
        );
    }
}

#[test]
fn custom_sections_are_anywhere() {
    let module = valid(&module(&[
        (0, &custom("a", b"1")),
        (TYPE, VOID),
        (0, &custom("", b"")),
        (FUNCTION, &[1, 0]),
        (CODE, ONE_BODY),
        (0, &custom("a", b"23")),
    ]));
    let contents =
        |section: &CustomSection| (module.bytes(section.name), module.bytes(section.payload));
    assert_eq!(
        module
            .custom_sections()
            .iter()
            .map(contents)
            .collect::<Vec<_>>(),
        [(&b"a"[..], &b"1"[..]), (b"", b""), (b"a", b"23")]
    );
}

#[test]
fn structure_of_the_module() {
    let raw = |rest: &[u8]| message(&[&module(&[]), rest].concat());
    assert_eq!(
        message(b"\0asm\x01\0\0"),
        "parse at byte 0: expected a module of at least 8 bytes"
    );
    assert_eq!(
        message(b"\0asn\x01\0\0\0"),
        "parse at byte 0: module doesn't start with '\\0asm'"
    );
    assert_eq!(
        message(b"\0asm\x02\0\0\0"),
        "parse at byte 0: unexpected version number 2 expected 1"
    );
    let cases: &[(&[u8], &str)] = &[
        (&[0x80], "8: can't get section byte"),
        (&[14], "8: invalid section"),
        (&[1], "9: can't get Type section's length"),
        (
            &[0, 0x80, 0x80, 0x80, 0x80, 0x80],
            "9: can't get Custom section's length",
        ),
        (
            &[5, 2, 0],
            "10: Memory section of size 2 would overflow Module's size",
        ),
        (
            &[5, 2, 0, 0],
            "10: parsing ended before the end of Memory section",
        ),
        (
            &[5, 1, 0, 5, 1, 0],
            "11: invalid section order, Memory followed by Memory",
        ),
        (
            &[6, 1, 0, 13, 1, 0],
            "11: invalid section order, Global followed by Exception",
        ),
        (
            &[10, 1, 0, 12, 1, 0],
            "11: invalid section order, Code followed by DataCount",
        ),
        (&[10, 1], "10: can't get Code section's count"),
        (
            &[10, 2, 0, 0],
            "10: parsing ended before the end of Code section",
        ),
        (
            &[10, 1, 1],
            "10: Code section count 1 exceeds the declared number of functions 0",
        ),
        (
            &[12, 1, 1],
            "11: Data section's count 0 is different from Data Count section's count 1",
        ),
        (
            &[12, 1, 1, 11, 1, 0],
            "14: Data section's count 0 is different from Data Count section's count 1",
        ),
        (&[0, 0], "10: can't get 1th custom section's name length"),
        (
            &[0, 2, 1, 0xff],
            "11: nameLen get 1th custom section's name of length 1",
        ),
    ];
    for (rest, expected) in cases {
        assert_eq!(raw(rest), format!("parse at byte {expected}"));
    }

    let declared =
        |rest: &[u8]| message(&[&module(&[(TYPE, VOID), (FUNCTION, &[1, 0])]), rest].concat());
    let cases: &[(&[u8], &str)] = &[
        (
            &[],
            "18: Number of functions parsed (0) does not match the number of declared functions (1)",
        ),
        (&[10, 1, 1], "21: can't get 0th Code function's size"),
        (
            &[10, 4, 1, 3, 0, 0x0b],
            "22: Code function's size 3 exceeds the module's remaining size",
        ),
        (
            &[10, 3, 1, 2, 0, 0x0b],
            "22: parsing ended before the end of Code section",
        ),
        (
            &[10, 5, 1, 0xb2, 0x97, 0xd3, 0x03],
            "21: Code function's size 7654322 is too big",
        ),
    ];
    for (rest, expected) in cases {
        assert_eq!(declared(rest), format!("parse at byte {expected}"));
    }
}

/// The offset is from the start of the last section, or of the expression.
#[test]
fn invalid_sections() {
    let types = list(&[&[FUNC, 0, 0], &[FUNC, 1, I32, 1, I32], &[STRUCT, 0]]);
    let imports = list(&[
        &[0, 0, 0, 1],
        &[0, 0, 1, EXTERNREF, 0, 0],
        &[0, 0, 2, 0, 0],
        &[0, 0, 3, I32, 1],
    ]);
    let cases: &[(u8, &[u8], usize, &str)] = &[
        (
            TYPE,
            &[1, 0x5d],
            2,
            "0th Type is non-Func, non-Struct, and non-Array -35",
        ),
        (TYPE, &[1, FUNC, 1, EMPTY], 4, "can't get 0th argument Type"),
        (
            TYPE,
            &[1, FUNC, 0, 1, REF, 1],
            6,
            "can't get 0th Type's return value",
        ),
        (
            TYPE,
            &[1, FUNC, 1, REF, 0xf0, 0x7f, 0],
            6,
            "can't get 0th argument Type",
        ),
        (TYPE, &[1, STRUCT, 1, 0x80], 3, "can't get 0th field Type"),
        (
            TYPE,
            &[1, STRUCT, 1, I8, 2],
            5,
            "invalid Field's mutability: 0x02",
        ),
        (TYPE, &[1, ARRAY, I8], 3, "0can't get array's mutability"),
        (
            TYPE,
            &[1, REC, 1, REC],
            4,
            "0th Type is non-Func, non-Struct, and non-Array -50",
        ),
        (
            TYPE,
            &[1, SUB, 1, 0, STRUCT, 0],
            4,
            "supertype index is a forward reference",
        ),
        (
            TYPE,
            &[1, SUB, 2],
            3,
            "number of supertypes for subtype at position 0 is too big 2 maximum 1",
        ),
        (
            TYPE,
            &[1, SUB, 0, SUB],
            4,
            "invalid structural type definition for subtype -48",
        ),
        (
            TYPE,
            &[2, STRUCT, 0, SUB, 1, 0, STRUCT, 0],
            8,
            "cannot declare subtype of final supertype",
        ),
        (
            IMPORT,
            &[1, 1, 0xff],
            2,
            "can't get 0th Import's module name of length 1",
        ),
        (
            IMPORT,
            &[1, 1, b'm', 2, b'f'],
            4,
            "can't get 0th Import's field name of length 1 in module 'm'",
        ),
        (
            IMPORT,
            &[1, 1, b'm', 1, b'f', 5],
            6,
            "can't get 0th Import's kind in module 'm' field 'f'",
        ),
        (
            IMPORT,
            &[1, 0, 0, 0, 3],
            5,
            "invalid function signature for 0th Import, 3 is out of range of 3 in module '' field ''",
        ),
        (
            IMPORT,
            &[1, 0, 0, 0, 2],
            5,
            "0th Function type 2 doesn't have a function signature",
        ),
        (IMPORT, &[1, 0, 0, 1, EMPTY], 5, "can't parse Table type"),
        (
            IMPORT,
            &[1, 0, 0, 4, 1],
            5,
            "0th Import exception has tag type 1 but the only supported tag type is 0",
        ),
        (
            IMPORT,
            &[1, 0, 0, 4, 0, 1],
            6,
            "0th Exception type cannot have a non-void return type 1",
        ),
        (
            FUNCTION,
            &[1, 3],
            2,
            "0th Function type number is invalid 3",
        ),
        (
            TABLE,
            &[1, I32],
            2,
            "Table type should be a ref type, got I32",
        ),
        (
            TABLE,
            &[1, REF, 0, 0, 0],
            3,
            "Table's type must be defaultable",
        ),
        (
            TABLE,
            &[1, EMPTY, 1],
            3,
            "can't parse explicitly initialized Table's reserved byte",
        ),
        (
            TABLE,
            &[1, FUNCREF, 3, 0, 0],
            3,
            "can't use shared limits for non memory",
        ),
        (
            TABLE,
            &[1, EMPTY, 0, REF, 0, 0, 0, 0xd0, 0, 0x0b],
            10,
            "Table init_expr opcode of type RefNull doesn't match table's type Ref",
        ),
        (MEMORY, &[1, 8], 2, "resizable limits flag are not valid 08"),
        (
            MEMORY,
            &[1, 2, 0],
            3,
            "shared memory must have a maximum size",
        ),
        (
            MEMORY,
            &[1, 1, 2, 1],
            4,
            "resizable limits has an initial page count of 2 which is greater than its maximum 1",
        ),
        (
            MEMORY,
            &[1, 0, 0x81, 0x80, 0x04],
            5,
            "Memory's initial page count of 65537 is invalid",
        ),
        (
            MEMORY,
            &[1, 1, 0, 0x81, 0x80, 0x04],
            6,
            "Memory's maximum page count of 65537 is invalid",
        ),
        (
            MEMORY,
            &[1, 0, 0x80, 0x80, 0x80, 0x80, 0x10],
            7,
            "can't parse resizable limits initial page count",
        ),
        (
            TAG,
            &[1, 0, 2],
            3,
            "0th Exception type 2 doesn't have a function signature",
        ),
        (GLOBAL, &[1, I32, 2], 3, "invalid Global's mutability: 0x02"),
        (GLOBAL, &[1, I32, 0, 0x0b], 4, "unknown init_expr opcode 11"),
        (
            GLOBAL,
            &[1, I32, 0, 0x41, 0],
            5,
            "can't get init_expr's end opcode",
        ),
        (
            GLOBAL,
            &[1, I32, 0, 0x42, 0, 0x0b],
            6,
            "Global init_expr opcode of type I64 doesn't match global's type I32",
        ),
        (
            GLOBAL,
            &[1, I32, 0, 0x23, 1, 0x0b],
            5,
            "get_global's index 1 exceeds the number of globals 1",
        ),
        (
            GLOBAL,
            &[1, I32, 0, 0x23, 0, 0x0b],
            5,
            "get_global import kind index 0 is mutable ",
        ),
        (
            GLOBAL,
            &[1, I32, 0, 0x41, 0, 0x23, 0, 0x6a, 0x0b],
            7,
            "get_global import kind index 0 is mutable ",
        ),
        (
            GLOBAL,
            &[1, I32, 0, 0x41, 0, 0x45, 0x0b],
            6,
            "Invalid instruction for constant expression",
        ),
        (
            GLOBAL,
            &[1, I32, 0, 0x41, 0, 0x41, 0, 0x71, 0x0b],
            8,
            "Invalid instruction for constant expression",
        ),
        (
            GLOBAL,
            &[1, I32, 0, 0x41, 0, 0x01, 0x0b],
            7,
            "Invalid instruction for constant expression",
        ),
        (
            GLOBAL,
            &[1, I64, 0, 0x41, 0, 0x0c, 0, 0x0b],
            7,
            "Invalid instruction for constant expression",
        ),
        (
            GLOBAL,
            &[1, V128, 0, 0xfd, 0x0d],
            5,
            "unknown init_expr simd opcode 253",
        ),
        (
            GLOBAL,
            &[1, FUNCREF, 0, 0xd2, 1, 0x0b],
            5,
            "ref.func index 1 exceeds the number of functions 1",
        ),
        (
            EXPORT,
            &[2, 1, b'a', 0, 0, 1, b'a'],
            7,
            "duplicate export: 'a'",
        ),
        (
            EXPORT,
            &[1, 0, 0, 1],
            4,
            "0th Export has invalid function number 1 it exceeds the function index space 1, named ''",
        ),
        (
            EXPORT,
            &[1, 0, 1, 1],
            4,
            "can't export Table 1 there are 1 Tables",
        ),
        (
            EXPORT,
            &[1, 0, 2, 1],
            4,
            "can't export Memory 1 there are 1 Memories",
        ),
        (
            EXPORT,
            &[1, 0, 3, 1],
            4,
            "0th Export has invalid global number 1 it exceeds the globals count 1, named ''",
        ),
        (
            EXPORT,
            &[1, 0, 4, 0],
            4,
            "0th Export has invalid exception number 0 it exceeds the exception index space 0, named ''",
        ),
        (
            START,
            &[1],
            1,
            "Start index 1 exceeds function index space 1",
        ),
        (START, &[0], 1, "Start function can't have arguments"),
        (ELEMENT, &[1, 8], 2, "can't get 0th Element reserved byte"),
        (
            ELEMENT,
            &[1, 0],
            2,
            "Table 0 must have type 'Funcref' to have an element section",
        ),
        (
            ELEMENT,
            &[1, 6, 1],
            3,
            "Element section for Table 1 exceeds available Table 1",
        ),
        (
            ELEMENT,
            &[1, 6, 0, 0x42, 0, 0x0b],
            6,
            "Element init_expr must produce an i32",
        ),
        (
            ELEMENT,
            &[1, 6, 0, 0x41, 0, 0x0b, REF, 1],
            8,
            "Table 0 must have type '(I32) -> [I32]' to have an element section",
        ),
        (ELEMENT, &[1, 1, 1], 3, "element kind must be zero"),
        (
            ELEMENT,
            &[1, 5, I32],
            3,
            "can't parse reftype in elem section",
        ),
        (
            ELEMENT,
            &[1, 1, 0, 1, 1],
            5,
            "Element section's 0th element's 0th index is 1 which exceeds the function index space size of 1",
        ),
        (
            ELEMENT,
            &[1, 5, ANYREF, 1, 0xd2, 0, 0x0b],
            7,
            "Element section's 0th element's init_expr opcode of type Ref doesn't match element's type RefNull",
        ),
        (DATA, &[1, 3], 2, "unknown 0th Data segment's flag"),
        (
            DATA,
            &[1, 2, 1],
            3,
            "0th Data segment has index 1 which exceeds the number of Memories 1",
        ),
        (
            DATA,
            &[1, 0, 0x42, 0, 0x0b],
            5,
            "Data init_expr must produce an i32",
        ),
        (
            DATA,
            &[1, 1, 1],
            3,
            "can't get data bytes from 0th Data segment",
        ),
    ];
    for &(id, payload, offset, reason) in cases {
        let before: &[(u8, &[u8])] = &[(TYPE, &types), (IMPORT, &imports)];
        let before = &before[..usize::from(id - 1).min(2)];
        let bytes = module(&[before, &[(id, payload)]].concat());
        let offset = bytes.len() - payload.len() + offset;
        assert_eq!(message(&bytes), format!("parse at byte {offset}: {reason}"));
    }

    let global = |expr: &[u8]| message(&module(&[(GLOBAL, &[&[1, I32, 0], expr].concat())]));
    let cases: &[(&[u8], &str)] = &[
        (
            &[0x41, 0, 0x6a, 0x0b],
            "parse at byte 3: can't pop empty stack in binary left",
        ),
        (&[0x41, 0, 0x41, 0], "parse at byte 4: can't decode opcode"),
        (
            &[0x41, 0, 0x8c, 0x0b],
            "validate: F32Neg value type mismatch",
        ),
        (
            &[0x41, 0, 0x20, 0, 0x0b],
            "validate: attempt to use unknown local 0, the number of locals is 0",
        ),
        (
            &[0x41, 0, 0x41, 0, 0x0b],
            "validate:  block with type: () -> [I32] returns: 1 but stack has: 2 values",
        ),
    ];
    for (expr, expected) in cases {
        assert_eq!(global(expr), *expected);
    }
}

#[test]
fn numbers_may_be_longer_than_needed() {
    valid(&module(&[(
        MEMORY,
        &[
            1, 0, 0x81, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0,
        ],
    )]));
    valid(&module(&[(
        GLOBAL,
        &[&[1, V128, 0, 0xfd, 0x8c, 0][..], &[0; 16], &[0x0b]].concat(),
    )]));
    valid(&module(&[(
        TYPE,
        &[1, ARRAY, REF, 0x80, 0x80, 0x80, 0x80, 0, 0],
    )]));
}

#[test]
fn counts_up_to_the_limits() {
    let too_big = |id, name: &str, limit: u32| {
        let bytes = module(&[(id, &unsigned(limit as usize + 1))]);
        let reason = format!(
            "{name} section's count is too big {} maximum {limit}",
            limit + 1
        );
        assert_eq!(parse(&bytes).err().unwrap().reason(), reason);
        let at_limit = module(&[(id, &unsigned(limit as usize))]);
        assert_ne!(parse(&at_limit).err().unwrap().reason(), reason);
    };
    too_big(TYPE, "Type", MAX_TYPES);
    too_big(IMPORT, "Import", MAX_IMPORTS);
    too_big(FUNCTION, "Function", MAX_FUNCTIONS);
    too_big(TAG, "Exception", MAX_TAGS);
    too_big(GLOBAL, "Global", MAX_GLOBALS);
    too_big(EXPORT, "Export", MAX_EXPORTS);
    too_big(ELEMENT, "Element", MAX_TABLE_ENTRIES);
    too_big(DATA_COUNT, "Data Count", MAX_DATA_SEGMENTS);
    too_big(DATA, "Data", MAX_DATA_SEGMENTS);

    let boundary = |limit: u32, make: &dyn Fn(usize) -> (u8, Vec<u8>), reason: &str| {
        let bytes = |count| {
            let (id, payload) = make(count as usize);
            module(&[(id, &payload)])
        };
        valid(&bytes(limit));
        assert_eq!(parse(&bytes(limit + 1)).err().unwrap().reason(), reason);
    };
    boundary(
        MAX_PARAMS,
        &|count| {
            (
                TYPE,
                [&[1, FUNC][..], &list_of(count, |_| vec![I32]), &[0]].concat(),
            )
        },
        "argument count of Type at index 0 is too big 1001 maximum 1000",
    );
    boundary(
        MAX_RESULTS,
        &|count| {
            (
                TYPE,
                [&[1, FUNC, 0][..], &list_of(count, |_| vec![I32])].concat(),
            )
        },
        "return count of Type at index 0 is too big 1001 maximum 1000",
    );
    boundary(
        MAX_STRUCT_FIELDS,
        &|count| {
            (
                TYPE,
                [&[1, STRUCT][..], &list_of(count, |_| vec![V128, 0])].concat(),
            )
        },
        "number of fields for struct type at position 0 is too big 10001 maximum 10000",
    );
    boundary(
        MAX_MEMORIES,
        &|count| (MEMORY, list_of(count, |_| vec![0, 0])),
        "there can be at most 100 memories",
    );
    boundary(
        MAX_TABLES,
        &|count| (TABLE, list_of(count, |_| vec![FUNCREF, 0, 0])),
        "Table count of 100000 is too big, maximum 100000",
    );

    let after_one_type =
        |count| module(&[(TYPE, &[&[2, STRUCT, 0, REC][..], &unsigned(count)].concat())]);
    let reason = |bytes: Vec<u8>| parse(&bytes).err().unwrap().reason().to_string();
    assert_eq!(
        reason(after_one_type(999_999)),
        "can't get recursion group's 0th Type's type"
    );
    assert_eq!(
        reason(after_one_type(1_000_000)),
        "Type section's number of types is too big 1000001 maximum 1000000"
    );
}

#[test]
fn features_can_be_off() {
    let without = |feature, bytes: Vec<u8>| {
        valid(&bytes);
        let error = Module::new(bytes, Features::all() - feature).err().unwrap();
        error.reason().to_string()
    };
    let function =
        |body: &[u8]| module(&[(TYPE, VOID), (FUNCTION, &[1, 0]), (CODE, &code(&[body]))]);
    let vector = [&[1, V128, 0, 0xfd, 0x0c][..], &[0; 16], &[0x0b]].concat();
    let cases = [
        (
            Features::MEMORY64,
            module(&[(MEMORY, &[1, 4, 0])]),
            "Memory64 is not enabled",
        ),
        (
            Features::MEMORY64,
            module(&[(TABLE, &[1, FUNCREF, 4, 0])]),
            "Memory64 is not enabled",
        ),
        (
            Features::SIMD,
            module(&[(TYPE, &[1, FUNC, 1, V128, 0])]),
            "can't get 0th argument Type",
        ),
        (
            Features::SIMD,
            module(&[(TYPE, &[1, ARRAY, V128, 0])]),
            "can't get array's element Type",
        ),
        (
            Features::SIMD,
            module(&[(GLOBAL, &vector)]),
            "can't get Global's value type",
        ),
        (
            Features::SIMD,
            function(&[1, 1, V128, 0x0b]),
            "can't get Function local's type in group 0",
        ),
        (
            Features::SIMD,
            function(&[0, 0x02, V128, 0x00, 0x0b, 0x1a, 0x0b]),
            "can't get block's signature",
        ),
        (
            Features::SIMD,
            function(&[0, 0x41, 0, 0xfd, 0x0f, 0x1a, 0x0b]),
            "wasm-simd is not enabled",
        ),
    ];
    for (feature, bytes, reason) in cases {
        assert_eq!(without(feature, bytes), reason);
    }
}

#[test]
fn errors_come_in_pieces() {
    let error = parse(&with_body(0, &[0, 0x1a, 0x0b])).err().unwrap();
    assert_eq!(error.kind(), ErrorKind::Parse { offset: 2 });
    assert_eq!(
        error.reason(),
        "can't pop empty stack in can't drop on empty stack"
    );
    assert_eq!(error.function(), Some(CodeIndex(0)));

    let name = "é".repeat(5000);
    let export = [&sized(name.as_bytes())[..], &[2, 0]].concat();
    let bytes = module(&[(MEMORY, &[1, 0, 0]), (EXPORT, &list(&[&export, &export]))]);
    let error = parse(&bytes).err().unwrap();
    assert_eq!(
        error.reason(),
        format!("duplicate export: '{}...'", &name[..4096])
    );
    assert_eq!(error.function(), None);
}

#[test]
fn imports_that_the_engine_provides() {
    let types = list(&[
        &[ARRAY, I16, 1],
        &[ARRAY, I16, 0],
        &[FUNC, 1, EXTERNREF, 1, I32],
        &[FUNC, 1, EXTERNREF, 1, REF, EXTERNREF],
        &[FUNC, 1, EXTERNREF, 1, EXTERNREF],
        &[FUNC, 3, NULLABLE, 0, I32, I32, 1, REF, EXTERNREF],
        &[FUNC, 3, NULLABLE, 1, I32, I32, 1, REF, EXTERNREF],
        &[FUNC, 3, REF, 0, I32, I32, 1, REF, EXTERNREF],
        &[FUNC, 1, EXTERNREF, 0],
    ]);
    let provided = |string_builtins, from: &str, field: &str, item: &[u8]| {
        let import = [&sized(from.as_bytes()), &sized(field.as_bytes()), item].concat();
        let module = valid(&module(&[
            (TYPE, &types),
            (IMPORT, &list(&[&[0, 0, 0, 2], &import])),
        ]));
        let options = CompileOptions {
            imported_string_constants: Some(b"'"),
            string_builtins,
        };
        let provided = module
            .provided_imports(options)
            .map_err(|error| error.to_string())?;
        assert_eq!((provided.len(), provided[0]), (2, None));
        Ok::<_, String>(provided[1])
    };

    let builtin = |field, ty| provided(true, "wasm:js-string", field, &[0, ty]);
    let found = |builtin| Ok(Some(Provided::StringBuiltin(builtin)));
    assert_eq!(builtin("length", 2), found(StringBuiltin::Length));
    assert_eq!(builtin("cast", 3), found(StringBuiltin::Cast));
    assert_eq!(
        builtin("fromCharCodeArray", 5),
        found(StringBuiltin::FromCharCodeArray)
    );
    assert_eq!(builtin("other", 2), Ok(None));
    assert_eq!(
        provided(false, "wasm:js-string", "length", &[0, 3]),
        Ok(None)
    );
    assert_eq!(provided(true, "js-string", "length", &[0, 3]), Ok(None));
    let mismatch = |field| {
        Err(format!(
            "builtin import wasm:js-string:{field} has an unexpected signature"
        ))
    };
    for (field, ty) in [
        ("cast", 4),
        ("test", 8),
        ("equals", 2),
        ("fromCharCodeArray", 6),
        ("fromCharCodeArray", 7),
    ] {
        assert_eq!(builtin(field, ty), mismatch(field));
    }
    assert_eq!(
        provided(true, "wasm:js-string", "test", &[3, I32, 0]),
        mismatch("test")
    );

    let constant = |item: &[u8]| provided(true, "'", "é", item);
    assert_eq!(
        constant(&[3, EXTERNREF, 0]),
        Ok(Some(Provided::StringConstant))
    );
    assert_eq!(
        constant(&[3, REF, EXTERNREF, 0]),
        Ok(Some(Provided::StringConstant))
    );
    assert_eq!(
        constant(&[0, 2]),
        Err("imported string constant ':é is not a global".into())
    );
    for item in [[3, EXTERNREF, 1], [3, ANYREF, 0], [3, I32, 0]] {
        let expected = "imported string constant ':é is not an immutable external reference";
        assert_eq!(constant(&item), Err(expected.into()));
    }
}
