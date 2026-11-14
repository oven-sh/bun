use super::*;

const A: Atom = Atom(1);
const B: Atom = Atom(2);
const C: Atom = Atom(3);
const D: Atom = Atom(4);

struct TestFile {
    targets: Vec<(u32, Asked)>,
    barrel: Option<(Vec<Option<u32>>, Vec<(Atom, u32)>)>,
}

fn names(names: &[Atom]) -> Asked {
    Asked::Names(names.to_vec())
}

fn module(targets: &[(u32, Asked)]) -> TestFile {
    TestFile {
        targets: targets.to_vec(),
        barrel: None,
    }
}

fn barrel(exports: &[(Atom, u32, Asked)]) -> TestFile {
    let targets = exports
        .iter()
        .map(|(_, file, asked)| (*file, asked.clone()));
    TestFile {
        targets: targets.collect(),
        barrel: Some((
            (0..exports.len() as u32).map(Some).collect(),
            (0..)
                .zip(exports)
                .map(|(target, export)| (export.0, target))
                .collect(),
        )),
    }
}

impl TestFile {
    fn requests(&self) -> ImportRequests {
        ImportRequests {
            asked: self
                .targets
                .iter()
                .map(|(_, asked)| asked.clone())
                .collect(),
            barrel: self.barrel.as_ref().map(|(can_wait, exports)| BarrelShape {
                can_wait: (0..)
                    .zip(can_wait)
                    .map(|(site, &target)| WaitingSite { site, target })
                    .collect(),
                exports: exports.clone(),
            }),
        }
    }
}

#[derive(PartialEq, Eq, Debug)]
struct Outcome {
    loaded: Vec<u32>,
    waiting: Vec<(u32, Vec<u32>)>,
}

fn load(files: &[TestFile], order: &mut Vec<(usize, usize)>) -> Outcome {
    let mut requests = BarrelRequests::default();
    let mut is_loaded = vec![false; files.len()];
    let mut to_parse = vec![0u32];
    is_loaded[0] = true;
    let mut step = 0;
    while !to_parse.is_empty() {
        if step == order.len() {
            order.push((0, to_parse.len()));
        }
        assert_eq!(order[step].1, to_parse.len());
        let file = to_parse.remove(order[step].0);
        step += 1;
        requests.add_parsed_file(
            file,
            files[file as usize].requests(),
            &mut |file, target| {
                let loaded = files[file as usize].targets[target as usize].0;
                if !std::mem::replace(&mut is_loaded[loaded as usize], true) {
                    to_parse.push(loaded);
                }
                loaded
            },
        );
    }
    let waiting = requests.into_waiting();
    let sites = |waiting: Vec<WaitingSite>| waiting.iter().map(|it| it.site).collect();
    Outcome {
        loaded: (0..)
            .zip(is_loaded)
            .filter(|it| it.1)
            .map(|it| it.0)
            .collect(),
        waiting: waiting
            .map(|(file, waiting)| (file, sites(waiting)))
            .collect(),
    }
}

fn load_in_every_order(files: &[TestFile]) -> Outcome {
    let mut order = Vec::new();
    let first = load(files, &mut order);
    loop {
        while let Some((taken, choices)) = order.pop() {
            if taken + 1 < choices {
                order.push((taken + 1, choices));
                break;
            }
        }
        if order.is_empty() {
            return first;
        }
        let taken: Vec<usize> = order.iter().map(|step| step.0).collect();
        assert_eq!(load(files, &mut order), first, "{taken:?}");
    }
}

#[test]
fn module_behind_requested_name_is_loaded() {
    let outcome = load_in_every_order(&[
        module(&[(1, names(&[A]))]),
        barrel(&[(A, 2, names(&[A])), (B, 3, names(&[B]))]),
        module(&[]),
        module(&[]),
    ]);
    assert_eq!(outcome.loaded, [0, 1, 2]);
    assert_eq!(outcome.waiting, [(1, vec![1])]);
}

#[test]
fn import_without_names_wakes_nothing() {
    let outcome = load_in_every_order(&[
        module(&[(1, names(&[]))]),
        barrel(&[(A, 2, names(&[A]))]),
        module(&[]),
    ]);
    assert_eq!(outcome.loaded, [0, 1]);
    assert_eq!(outcome.waiting, [(1, vec![0])]);
}

#[test]
fn name_that_is_not_exported_wakes_nothing() {
    let outcome = load_in_every_order(&[
        module(&[(1, names(&[D]))]),
        barrel(&[(A, 2, names(&[A]))]),
        module(&[]),
    ]);
    assert_eq!(outcome.loaded, [0, 1]);
}

#[test]
fn request_passes_through_chain_of_barrels() {
    let outcome = load_in_every_order(&[
        module(&[(1, names(&[A]))]),
        barrel(&[(A, 2, names(&[A])), (B, 5, names(&[B]))]),
        barrel(&[(A, 3, names(&[A])), (C, 4, names(&[C]))]),
        module(&[]),
        module(&[]),
        module(&[]),
    ]);
    assert_eq!(outcome.loaded, [0, 1, 2, 3]);
    assert_eq!(outcome.waiting, [(1, vec![1]), (2, vec![1])]);
}

#[test]
fn export_under_another_name_asks_for_the_name_in_its_module() {
    let outcome = load_in_every_order(&[
        module(&[(1, names(&[C]))]),
        barrel(&[(C, 2, names(&[D]))]),
        barrel(&[(D, 3, names(&[D])), (C, 4, names(&[C]))]),
        module(&[]),
        module(&[]),
    ]);
    assert_eq!(outcome.loaded, [0, 1, 2, 3]);
}

#[test]
fn request_for_everything_reaches_inner_barrels() {
    let outcome = load_in_every_order(&[
        module(&[(1, Asked::All)]),
        barrel(&[(A, 2, Asked::All), (B, 3, names(&[B]))]),
        barrel(&[(C, 4, names(&[C])), (D, 5, names(&[D]))]),
        barrel(&[(B, 6, names(&[B])), (D, 7, names(&[D]))]),
        module(&[]),
        module(&[]),
        module(&[]),
        module(&[]),
    ]);
    assert_eq!(outcome.loaded, [0, 1, 2, 3, 4, 5, 6]);
    assert_eq!(outcome.waiting, [(3, vec![1])]);
}

#[test]
fn barrel_that_another_file_exports_whole_waits_for_nothing() {
    let outcome = load_in_every_order(&[
        module(&[(1, names(&[A])), (4, names(&[]))]),
        barrel(&[(A, 2, names(&[A])), (B, 3, names(&[B]))]),
        module(&[]),
        module(&[]),
        module(&[(1, Asked::All)]),
    ]);
    assert_eq!(outcome.loaded, [0, 1, 2, 3, 4]);
    assert!(outcome.waiting.is_empty());
}

#[test]
fn requests_of_all_importers_add_up() {
    let outcome = load_in_every_order(&[
        module(&[(5, names(&[])), (6, names(&[]))]),
        barrel(&[
            (A, 2, names(&[A])),
            (B, 3, names(&[B])),
            (C, 4, names(&[C])),
        ]),
        module(&[]),
        module(&[]),
        module(&[]),
        module(&[(1, names(&[A]))]),
        module(&[(1, names(&[B]))]),
    ]);
    assert_eq!(outcome.loaded, [0, 1, 2, 3, 5, 6]);
    assert_eq!(outcome.waiting, [(1, vec![2])]);
}

#[test]
fn woken_site_asks_for_every_name_it_imports() {
    let two_names = TestFile {
        targets: vec![(2, names(&[A, B]))],
        barrel: Some((vec![Some(0)], vec![(A, 0), (B, 0)])),
    };
    let outcome = load_in_every_order(&[
        module(&[(1, names(&[A]))]),
        two_names,
        barrel(&[
            (A, 3, names(&[A])),
            (B, 4, names(&[B])),
            (C, 5, names(&[C])),
        ]),
        module(&[]),
        module(&[]),
        module(&[]),
    ]);
    assert_eq!(outcome.loaded, [0, 1, 2, 3, 4]);
}

#[test]
fn target_that_cannot_wait_is_loaded_with_the_barrel() {
    let with_side_effect_import = TestFile {
        targets: vec![(2, names(&[A])), (3, names(&[]))],
        barrel: Some((vec![Some(0)], vec![(A, 0)])),
    };
    let outcome = load_in_every_order(&[
        module(&[(1, names(&[]))]),
        with_side_effect_import,
        module(&[]),
        module(&[]),
    ]);
    assert_eq!(outcome.loaded, [0, 1, 3]);
}

#[test]
fn barrels_that_export_from_each_other_end() {
    let outcome = load_in_every_order(&[
        module(&[(1, names(&[A]))]),
        barrel(&[(A, 2, names(&[A])), (B, 3, names(&[B]))]),
        barrel(&[(A, 1, names(&[A])), (B, 1, names(&[B]))]),
        module(&[]),
    ]);
    assert_eq!(outcome.loaded, [0, 1, 2]);
    assert_eq!(outcome.waiting, [(1, vec![1]), (2, vec![1])]);
}

#[test]
fn module_behind_a_name_can_ask_its_barrel_for_more() {
    let outcome = load_in_every_order(&[
        module(&[(1, names(&[A]))]),
        barrel(&[
            (A, 2, names(&[A])),
            (B, 3, names(&[B])),
            (C, 4, names(&[C])),
        ]),
        module(&[(1, names(&[B]))]),
        module(&[]),
        module(&[]),
    ]);
    assert_eq!(outcome.loaded, [0, 1, 2, 3]);
}

#[test]
fn site_that_names_no_file_waits_like_any_other() {
    let with_missing_file = |asked: Atom| {
        let barrel = TestFile {
            targets: vec![(2, names(&[A]))],
            barrel: Some((vec![Some(0), None], vec![(A, 0), (B, 1)])),
        };
        load_in_every_order(&[module(&[(1, names(&[asked]))]), barrel, module(&[])])
    };
    assert_eq!(with_missing_file(A).waiting, [(1, vec![1])]);
    assert_eq!(with_missing_file(B).waiting, [(1, vec![0])]);
}
