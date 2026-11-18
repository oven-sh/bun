//! What is long, deep or wide takes time and memory in proportion to its size, and little stack.

mod support;

use std::thread;

use bun_engine_wasm_format::opcode::*;
use bun_engine_wasm_format::*;
use support::*;

fn on_small_stack(work: impl FnOnce() + Send + 'static) {
    let small_stack = thread::Builder::new().stack_size(256 << 10);
    small_stack.spawn(work).unwrap().join().unwrap();
}

fn function(ty: &[u8], code_bytes: &[&[u8]]) -> Vec<u8> {
    let body = [&[0][..], &code_bytes.concat(), &[END]].concat();
    module(&[
        (TYPE, &list(&[ty])),
        (FUNCTION, &[1, 0]),
        (CODE, &code(&[&body])),
    ])
}

fn returning(count: usize) -> Vec<u8> {
    [vec![FUNC, 0], list_of(count, |_| vec![I32])].concat()
}

#[test]
fn deep_blocks() {
    on_small_stack(|| {
        let depth = 100_000;
        let loops = [LOOP, EMPTY].repeat(depth);
        let dead = [BLOCK, EMPTY, UNREACHABLE].repeat(depth);
        let module = valid(&function(
            &returning(0),
            &[&loops, &dead, &[END].repeat(2 * depth)],
        ));
        let mut effects = LoopEffects::default();
        effects.scan(&module.body(CodeIndex(0)));
        assert_eq!(effects.flags(depth as u32 - 2), LoopFlags::HAS_INNER_LOOP);
        assert_eq!(effects.flags(depth as u32 - 1), LoopFlags::empty());
    });
}

#[test]
fn long_tables_of_wide_labels() {
    let labels = list_of(300_000, |i| vec![(i % 50) as u8]);
    let table = [&[CALL, 0, I32_CONST, 0, BR_TABLE][..], &labels, &[0]].concat();
    valid(&function(
        &returning(1000),
        &[&[BLOCK, 0].repeat(50), &table, &[END].repeat(50)],
    ));
}

#[test]
fn the_operand_stack_has_a_limit() {
    let calls = |count| function(&returning(1000), &[&[CALL, 0].repeat(count), &[RETURN]]);
    assert_eq!(
        valid(&calls(7654)).facts(CodeIndex(0)).max_stack_height,
        7_654_000
    );
    assert_eq!(
        parse(&calls(7655)).err().unwrap().reason(),
        "can't allocate enough memory for 7655000 values on the expression stack"
    );
}

#[test]
fn many_functions_with_many_locals() {
    let body = [&[1][..], &unsigned(50_000), &[REF, FUNCREF, END]].concat();
    valid(&module(&[
        (TYPE, &[1, FUNC, 0, 0]),
        (FUNCTION, &list_of(500, |_| vec![0])),
        (CODE, &list_of(500, |_| sized(&body))),
    ]));
}

#[test]
fn counts_without_items() {
    let most = unsigned(0xffff_fffe);
    let cases = [
        function(&returning(0), &[&[I32_CONST, 0, BR_TABLE], &most]),
        function(&returning(0), &[&[TRY_TABLE, EMPTY], &most]),
        module(&[(TABLE, &most)]),
        module(&[(ELEMENT, &[&[1, 1, 0][..], &unsigned(10_000_000)].concat())]),
        [module(&[]), vec![DATA], most].concat(),
    ];
    for bytes in cases {
        assert!(matches!(
            parse(&bytes).err().unwrap().kind(),
            ErrorKind::Parse { .. }
        ));
    }
}

#[test]
fn large_recursion_groups() {
    on_small_stack(|| {
        let count = 2_000;
        let ring = list_of(count, |i| {
            [&[ARRAY, NULLABLE][..], &signed((i + 1) % count), &[0]].concat()
        });
        valid(&module(&[(TYPE, &[vec![1, REC], ring].concat())]));

        let supertype = |i: usize| {
            i.checked_sub(1)
                .map_or_else(|| vec![0], |i| [vec![1], unsigned(i)].concat())
        };
        let field = [&[STRUCT, 1, NULLABLE][..], &signed(count - 1), &[0]].concat();
        let chain = list_of(count, |i| [&[SUB][..], &supertype(i), &field].concat());
        assert_eq!(
            parse(&module(&[(TYPE, &[vec![1, REC], chain].concat())]))
                .err()
                .unwrap()
                .reason(),
            "subtype depth for recursion group's 64th signature exceeded the limits of 63"
        );
    });
}

#[test]
fn many_name_sections() {
    let mut bytes = module(&[
        (TYPE, &[1, FUNC, 0, 0]),
        (IMPORT, &list_of(2_000, |_| vec![0; 4])),
    ]);
    bytes.extend(
        [&[0][..], &sized(&custom("name", &[1, 2, 1, 0xff]))]
            .concat()
            .repeat(2_000),
    );
    assert!(valid(&bytes).names().is_none());
}
