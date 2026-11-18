mod support;

use std::thread;

use bun_engine_wasm_format::opcode::*;
use bun_engine_wasm_format::*;
use support::*;

/// Validates the bodies last to first.
fn in_pieces<'a>(pieces: impl Iterator<Item = &'a [u8]>) -> Result<Module, Error> {
    let mut parser = Parser::new(Features::all());
    let mut bodies = Vec::new();
    for (i, piece) in pieces.enumerate() {
        if i % 2 == 0 {
            parser.feed(piece)?;
        } else {
            parser.feed_owned(piece.to_vec())?;
            bodies.extend(parser.take_bodies());
        }
    }
    let mut unvalidated = parser.finish()?;
    bodies.extend(std::iter::from_fn(|| unvalidated.take_bodies()));
    let mut scratch = Scratch::default();
    let outcomes = bodies
        .into_iter()
        .rev()
        .map(|bodies| bodies.validate(&mut scratch));
    unvalidated.complete(outcomes.collect())
}

fn contents(module: &Module) -> Vec<Vec<u8>> {
    let bodies = (0..module.code_count()).map(|code| module.body(CodeIndex(code)).bytes());
    let data = module
        .data_segments()
        .iter()
        .map(|data| module.bytes(data.bytes));
    let custom = module
        .custom_sections()
        .iter()
        .map(|section| module.bytes(section.payload));
    let exports = module
        .exports()
        .iter()
        .map(|export| module.bytes(export.name));
    let parts = bodies
        .chain(data)
        .chain(custom)
        .chain(exports)
        .map(<[u8]>::to_vec);
    parts
        .chain([module.source().collect::<Vec<_>>().concat()])
        .collect()
}

fn body(size: usize, is_valid: bool) -> Vec<u8> {
    [
        &[0][..],
        &vec![NOP; size],
        &[if is_valid { NOP } else { DROP }, END],
    ]
    .concat()
}

/// 300 functions in 150 KB.
fn large(invalid: &[usize], data: &[u8]) -> Vec<u8> {
    let size = |i| if i == 100 { 70_000 } else { i * 37 % 550 };
    module(&[
        (TYPE, &[1, FUNC, 0, 0]),
        (FUNCTION, &list_of(300, |_| vec![0])),
        (EXPORT, &[1, 1, b'f', 0, 0]),
        (0, &custom("before", &[1; 300])),
        (
            CODE,
            &list_of(300, |i| sized(&body(size(i), !invalid.contains(&i)))),
        ),
        (0, &custom("after", &[2; 40_000])),
        (DATA, data),
    ])
}

#[test]
fn any_place_can_be_the_end_of_a_piece() {
    let bytes = with_body(0, &body(200, true));
    let expected = contents(&valid(&bytes));
    for split in 0..=bytes.len() {
        let (first, second) = bytes.split_at(split);
        assert_eq!(
            contents(&in_pieces([first, second].into_iter()).unwrap()),
            expected
        );
        let cut_short = in_pieces(first.chunks(3)).err();
        assert_eq!(cut_short, parse(first).err());
    }
    assert_eq!(contents(&in_pieces(bytes.chunks(1)).unwrap()), expected);
}

#[test]
fn pieces_of_any_size() {
    let bytes = large(&[], &[1, 1, 3, 7, 8, 9]);
    let expected = contents(&valid(&bytes));
    let mut random = Random(7);
    for largest in [40, 1000, 9000, 40_000, 100_000, 400_000] {
        let mut rest = &bytes[..];
        let pieces = std::iter::from_fn(|| {
            let size = random.below(largest).min(rest.len());
            (!rest.is_empty()).then(|| rest.split_off(..size).unwrap())
        });
        assert_eq!(contents(&in_pieces(pieces).unwrap()), expected);
    }
}

#[test]
fn bodies_are_handed_out_before_the_end() {
    let bytes = large(&[], &[0]);
    let mut parser = Parser::new(Features::all());
    parser.feed(&bytes[..1000]).unwrap();
    assert!(parser.take_bodies().is_none());
    parser.feed(&bytes[1000..20_000]).unwrap();
    let first = parser.take_bodies().unwrap();
    assert_eq!(first.first(), CodeIndex(0));
    assert!(first.size_in_bytes() > 15_000);
    let first = first.validate(&mut Scratch::default());
    let sizes: Vec<_> = first.bodies().map(|body| body.bytes().len()).collect();
    assert_eq!(sizes[..3], [3, 40, 77]);
    assert_eq!(
        first.bodies().last().unwrap().code_index().usize(),
        sizes.len() - 1
    );

    parser.feed(&bytes[20_000..]).unwrap();
    let rest: Vec<_> = std::iter::from_fn(|| parser.take_bodies()).collect();
    assert!(rest.len() >= 3);
    let mut outcomes: Vec<_> = rest.iter().map(|_| None).collect();
    thread::scope(|scope| {
        for (bodies, outcome) in rest.into_iter().zip(&mut outcomes) {
            scope.spawn(|| *outcome = Some(bodies.validate(&mut Scratch::default())));
        }
    });
    let mut outcomes: Vec<_> = outcomes.into_iter().flatten().collect();
    outcomes.push(first);
    assert_eq!(
        parser
            .finish()
            .unwrap()
            .complete(outcomes)
            .unwrap()
            .code_count(),
        300
    );
}

#[test]
fn sections_that_are_done_are_set_aside() {
    let section = [vec![0], sized(&custom("", &[3; 1000]))].concat();
    let bytes = [module(&[]), section.repeat(200)].concat();
    let module = in_pieces(bytes.chunks(3000)).unwrap();
    assert!(module.source().all(|piece| piece.len() < 40_000));
    assert_eq!(contents(&module), contents(&valid(&bytes)));
}

#[test]
fn the_order_of_errors_is_fixed() {
    let error = |bytes: &[u8]| {
        let errors = [64, 5000, bytes.len()].map(|size| in_pieces(bytes.chunks(size)).err());
        assert_eq!(errors, [(); 3].map(|()| parse(bytes).err()));
        errors[0].clone().unwrap()
    };
    assert_eq!(
        error(&large(&[299, 150, 200], &[0])).function(),
        Some(CodeIndex(150))
    );
    assert_eq!(
        error(&large(&[0], &[1, 3])).reason(),
        "unknown 0th Data segment's flag"
    );
}

#[test]
fn an_error_stays() {
    let mut parser = Parser::new(Features::all());
    let error = parser.feed(&module(&[(14, &[])])).unwrap_err();
    assert_eq!(parser.feed(&[]), Err(error.clone()));
    assert_eq!(parser.feed_owned(vec![0]), Err(error.clone()));
    assert_eq!(parser.finish().err(), Some(error));
}

#[test]
fn what_is_shared_between_threads() {
    fn shared<T: Send + Sync>() {}
    shared::<Module>();
    shared::<ModuleHeader>();
    shared::<CanonicalValType>();
    shared::<Bodies>();
    shared::<ValidatedBodies>();
    shared::<Parser>();
    shared::<Error>();
}
