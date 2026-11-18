//! Random changes to a module. `WASM_MUTATIONS` and `WASM_MUTATION_SEED` make the run longer or another one.

#![allow(clippy::disallowed_methods)]

mod support;

use bun_engine_wasm_format::opcode::*;
use bun_engine_wasm_format::*;
use support::{
    ANYREF, EMPTY, EXNREF, I32, I64, Ignore, NULLABLE, REF, Random, V128, parse, with_body,
};

const GET: u8 = LOCAL_GET;
const GC: u8 = GC_PREFIX;

const LOCALS: &[u8] = &[
    6, 1, I32, 1, I64, 1, V128, 1, REF, 4, 1, NULLABLE, 5, 1, NULLABLE, 6,
];
const PIECES: &[&[u8]] = &[
    &[GET, 0, GET, 1, CALL, 1, I32_TRUNC_F32_S, LOCAL_SET, 0],
    &[BLOCK, 8, CALL, 2, GET, 0, BR_IF, 0, END, DROP, DROP],
    &[GET, 0, LOOP, 1, GET, 0, BR_IF, 0, DROP, END],
    &[GET, 0, GET, 0, IF, 1, DROP, ELSE, BR, 1, END],
    &[
        BLOCK, EMPTY, BLOCK, EMPTY, GET, 0, BR_TABLE, 2, 0, 1, 2, END, END,
    ],
    &[
        GET, 1, GET, 1, I64_LOAD, 0x43, 1, 0x80, 1, I64_STORE8, 0x40, 1, 0,
    ],
    &[
        GET,
        1,
        GET,
        0,
        GET,
        0,
        MISC_PREFIX,
        10,
        1,
        0,
        MISC_PREFIX,
        9,
        0,
    ],
    &[
        GET,
        0,
        GET,
        1,
        REF_FUNC,
        1,
        CALL_REF,
        3,
        DROP,
        GET,
        0,
        CALL_INDIRECT,
        9,
        0,
    ],
    &[
        GET,
        4,
        REF_AS_NON_NULL,
        LOCAL_TEE,
        3,
        GC,
        3,
        4,
        1,
        GET,
        3,
        GC,
        2,
        4,
        2,
        DROP,
        DROP,
    ],
    &[
        BLOCK, REF, 5, GC, 1, 4, GC, 24, 0, 0, 4, 5, DROP, RETURN, END, DROP,
    ],
    &[
        BLOCK,
        ANYREF,
        GET,
        4,
        BR_ON_NON_NULL,
        0,
        RETURN_CALL,
        0,
        END,
        GC,
        20,
        5,
        DROP,
    ],
    &[GET, 5, GET, 0, GET, 5, GET, 0, GET, 0, GC, 17, 6, 6],
    &[
        TRY, I32, GET, 0, CATCH, 1, CATCH_ALL, RETHROW, 0, END, TRY, 1, DROP, DELEGATE, 0,
    ],
    &[
        RETURN, BLOCK, EXNREF, TRY_TABLE, EMPTY, 2, 1, 0, 0, 3, 0, END, RETURN, END, THROW_REF,
    ],
    &[
        GET,
        0,
        GET,
        2,
        GET,
        2,
        VECTOR_PREFIX,
        0xae,
        1,
        VECTOR_PREFIX,
        0x5b,
        3,
        0,
        1,
    ],
    &[GET, 0, GET, 1, GET, 1, ATOMIC_PREFIX, 0x4e, 2, 0, DROP],
];

fn mutate(bytes: &mut Vec<u8>, random: &mut Random) {
    let at = random.below(bytes.len());
    let other = bytes[random.below(bytes.len())];
    match random.below(6) {
        0 => bytes[at] = random.below(256) as u8,
        1 => bytes[at] = other,
        2 => bytes[at] ^= 1 << random.below(8),
        3 => bytes.insert(at, other),
        4 => bytes.insert(at, UNREACHABLE),
        _ => bytes[at] = NOP,
    }
}

fn setting(name: &str, default: u64) -> u64 {
    std::env::var(name).map_or(default, |value| value.parse().unwrap())
}

#[test]
fn changed_modules() {
    let mut random = Random(setting("WASM_MUTATION_SEED", 1));
    let mut effects = LoopEffects::default();
    let mut verdicts = [0, 0];
    for _ in 0..setting("WASM_MUTATIONS", 30_000) {
        let pieces = [(); 3].map(|()| PIECES[random.below(PIECES.len())]);
        let mut body = [LOCALS, &pieces.concat(), &[END]].concat();
        let in_body = random.below(3);
        (0..in_body).for_each(|_| mutate(&mut body, &mut random));
        let mut bytes = with_body(0, &body);
        if in_body == 0 {
            mutate(&mut bytes, &mut random);
        }

        let mut parser = Parser::new(Features::all());
        let fed = bytes
            .chunks(1 + random.below(40))
            .try_for_each(|piece| parser.feed(piece));
        let early = fed.and_then(|()| parser.finish().map(drop)).err();
        let result = parse(&bytes);
        verdicts[usize::from(result.is_ok())] += 1;
        match result {
            Ok(module) => {
                assert_eq!(early, None);
                for body in (0..module.code_count()).map(|code| module.body(CodeIndex(code))) {
                    let mut driver = body.driver();
                    let Ok(()) = driver.run(&mut Ignore);
                    assert_eq!(driver.offset() as usize, body.bytes().len());
                    effects.scan(&body);
                }
            }
            Err(error) if error.function().is_none() && error.kind() != ErrorKind::Module => {
                assert_eq!(early, Some(error));
            }
            Err(_) => assert_eq!(early, None),
        }
    }
    assert!(verdicts.iter().all(|&count| count > 0), "{verdicts:?}");
}
