use super::*;

fn key(identity: u64) -> ObjectTypeKey {
    ObjectTypeKey {
        origin: ObjectOrigin::Computed,
        identity: TypeIdentity([identity, 0]),
        is_checked: true,
    }
}

fn layout(names: u64) -> LayoutKey {
    LayoutKey::ObjectType {
        origin: ObjectOrigin::Computed,
        instantiation: TypeIdentity([names, 0]),
    }
}

fn ty(identity: u64) -> DefinedObjectType {
    DefinedObjectType::new(layout(0), key(identity)).unwrap()
}

#[test]
fn only_an_earlier_file_counts() {
    let defined = DefinedObjectTypes::default();
    assert!(!defined.is_defined_by_earlier_file(&ty(0), FileId(9)));
    defined.add_definition(ty(0), 0, FileId(5));
    assert!(defined.is_defined_by_earlier_file(&ty(0), FileId(9)));
    assert!(!defined.is_defined_by_earlier_file(&ty(0), FileId(5)));
    assert!(!defined.is_defined_by_earlier_file(&ty(0), FileId(3)));
    assert!(!defined.is_defined_by_earlier_file(&ty(1), FileId(9)));
}

#[test]
fn any_type_of_an_earlier_file_defines_the_layout() {
    let defined = DefinedObjectTypes::default();
    assert!(!defined.is_layout_defined_by_earlier_file(layout(0), FileId(9), false));
    defined.add_definition(ty(1), 0, FileId(5));
    defined.add_definition(ty(2), 1, FileId(7));
    assert!(defined.is_layout_defined_by_earlier_file(layout(0), FileId(6), false));
    assert!(!defined.is_layout_defined_by_earlier_file(layout(0), FileId(5), false));
    assert!(!defined.is_layout_defined_by_earlier_file(layout(1), FileId(9), false));
}

#[test]
fn only_a_type_with_a_place_gives_the_layout_a_place() {
    let defined = DefinedObjectTypes::default();
    defined.add_definition(ty(1), 0, FileId(3));
    assert!(defined.is_layout_defined_by_earlier_file(layout(0), FileId(9), false));
    assert!(!defined.is_layout_defined_by_earlier_file(layout(0), FileId(9), true));
    defined.add_definition(ty(2), 1 | HAS_PLACE, FileId(5));
    assert!(defined.is_layout_defined_by_earlier_file(layout(0), FileId(6), true));
    assert!(!defined.is_layout_defined_by_earlier_file(layout(0), FileId(5), true));
    assert!(defined.is_defined_by_earlier_file(&ty(2), FileId(6)));
}

#[test]
fn a_checked_file_does_not_speak_for_one_that_is_not() {
    let unchecked = ObjectTypeKey {
        is_checked: false,
        ..key(0)
    };
    let unchecked = DefinedObjectType::new(layout(0), unchecked).unwrap();
    let defined = DefinedObjectTypes::default();
    defined.add_definition(ty(0), 0, FileId(1));
    assert!(defined.is_defined_by_earlier_file(&ty(0), FileId(2)));
    assert!(!defined.is_defined_by_earlier_file(&unchecked, FileId(2)));
}

#[test]
fn the_first_definer_in_file_order_is_kept() {
    let defined = DefinedObjectTypes::default();
    defined.add_definition(ty(0), 0, FileId(5));
    defined.add_definition(ty(0), 0, FileId(2));
    defined.add_definition(ty(0), 0, FileId(7));
    assert!(defined.is_defined_by_earlier_file(&ty(0), FileId(3)));
    assert!(!defined.is_defined_by_earlier_file(&ty(0), FileId(2)));
}

#[test]
fn a_definition_at_any_level_counts() {
    for level_of_definition in 0..=LAST_DEFINITION_LEVEL {
        let defined = DefinedObjectTypes::default();
        defined.add_definition(ty(0), level_of_definition, FileId(1));
        assert!(defined.is_defined_by_earlier_file(&ty(0), FileId(2)));
    }
}

#[test]
fn only_a_definer_below_the_last_level_has_gone_on() {
    let defined = DefinedObjectTypes::default();
    defined.add_definition(
        ty(0),
        LAST_DEFINITION_LEVEL | NAMES_THE_SAME_IN_EVERY_FILE,
        FileId(1),
    );
    defined.add_definition(ty(0), 0, FileId(2));
    assert!(defined.is_defined_by_earlier_file(&ty(0), FileId(9)));
    assert!(!defined.has_earlier_file_gone_on_for_all(&ty(0), FileId(9)));
    defined.add_definition(ty(0), NAMES_THE_SAME_IN_EVERY_FILE, FileId(5));
    assert!(defined.has_earlier_file_gone_on_for_all(&ty(0), FileId(9)));
    assert!(!defined.has_earlier_file_gone_on_for_all(&ty(0), FileId(5)));
    assert!(!defined.has_earlier_file_gone_on_for_all(&ty(1), FileId(9)));
}

#[test]
fn a_type_under_one_layout_does_not_speak_for_it_under_another() {
    let under = |layout: LayoutKey| DefinedObjectType::new(layout, key(0)).unwrap();
    let defined = DefinedObjectTypes::default();
    defined.add_definition(under(layout(1)), 0, FileId(1));
    let is_left = |layout| defined.is_defined_by_earlier_file(&under(layout), FileId(2));
    assert!(is_left(layout(1)));
    assert!(!is_left(layout(2)));
}

#[test]
fn a_layout_with_a_home_is_left_to_nobody() {
    let home = LayoutKey::UntypedLiteral {
        file: FileId(0),
        members: TypeIdentity([0, 0]),
    };
    assert_eq!(DefinedObjectType::new(home, key(0)), None);
}

struct Model {
    mentioned: Vec<Vec<u64>>,
    named_by_fields: Vec<Vec<u64>>,
    // A file, a type, and what the fields of that type name for that file alone.
    seen_otherwise: Option<(usize, u64, Vec<u64>)>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Rule {
    DefinesEverything,
    LeavesToEarlierFiles,
    // A file does not go on to what the fields of such a type name, whatever its level.
    LeavesWithoutLevels,
}

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
struct ModelFile {
    // In the order met: the types of level 0, then those of level 1, and so on.
    met: Vec<u64>,
    settled_count: usize,
    end_of_level: usize,
    level: u8,
    definitions: Vec<(u64, u8)>,
    is_lowered: bool,
    is_committed: bool,
}

#[derive(PartialEq, Eq, Debug)]
struct Linked {
    kept: Vec<Vec<u64>>,
    declared: Vec<u64>,
}

fn link(files: &[ModelFile]) -> Linked {
    let mut defined = Vec::new();
    let mut declared = Vec::new();
    let mut kept = Vec::new();
    for file in files {
        let types = file.definitions.iter().map(|definition| definition.0);
        let first: Vec<u64> = types.filter(|ty| !defined.contains(ty)).collect();
        defined.extend_from_slice(&first);
        kept.push(first);
        declared.extend_from_slice(&file.met);
    }
    declared.sort_unstable();
    declared.dedup();
    Linked { kept, declared }
}

impl Model {
    fn names_the_same_in_every_file(&self, ty: u64) -> bool {
        !matches!(&self.seen_otherwise, Some((_, other, _)) if *other == ty)
    }

    fn start(&self) -> Vec<ModelFile> {
        let files = self.mentioned.iter().map(|mentioned| ModelFile {
            met: mentioned.clone(),
            settled_count: 0,
            end_of_level: mentioned.len(),
            level: 0,
            definitions: Vec::new(),
            is_lowered: false,
            is_committed: false,
        });
        files.collect()
    }

    fn step(&self, files: &mut [ModelFile], index: usize, rule: Rule) {
        let defined = DefinedObjectTypes::default();
        for (id, file) in (0..).map(FileId).zip(&*files) {
            for &(definition, level) in file.definitions.iter().filter(|_| file.is_committed) {
                let names_the_same = match self.names_the_same_in_every_file(definition) {
                    true => NAMES_THE_SAME_IN_EVERY_FILE,
                    false => 0,
                };
                defined.add_definition(ty(definition), level | names_the_same, id);
            }
        }
        let file = &mut files[index];
        if file.is_lowered {
            file.is_committed = true;
        } else if file.settled_count < file.end_of_level {
            let next = file.met[file.settled_count];
            file.settled_count += 1;
            let is_defined = rule != Rule::DefinesEverything
                && defined.is_defined_by_earlier_file(&ty(next), FileId(index as u32));
            let is_last_level = file.level == LAST_DEFINITION_LEVEL;
            let is_gone_on_from = rule == Rule::LeavesToEarlierFiles
                && defined.has_earlier_file_gone_on_for_all(&ty(next), FileId(index as u32));
            if is_defined && (is_last_level || is_gone_on_from || rule == Rule::LeavesWithoutLevels)
            {
                return;
            }
            if !is_defined {
                file.definitions.push((next, file.level));
            }
            let named_by_fields = match &self.seen_otherwise {
                Some((viewer, ty, named)) if (*viewer, *ty) == (index, next) => named,
                Some(_) | None => &self.named_by_fields[next as usize],
            };
            for &named in named_by_fields {
                if !file.met.contains(&named) {
                    file.met.push(named);
                }
            }
        } else if file.level == LAST_DEFINITION_LEVEL || file.end_of_level == file.met.len() {
            file.is_lowered = true;
        } else {
            file.level += 1;
            file.end_of_level = file.met.len();
        }
    }

    // The programs that come out, over every way in which the steps of the files can follow one another.
    fn link_in_every_order(&self, rule: Rule) -> Vec<Linked> {
        let mut seen = rustc_hash::FxHashSet::default();
        let mut pending = vec![self.start()];
        let mut programs: Vec<Linked> = Vec::new();
        while let Some(files) = pending.pop() {
            let mut is_over = true;
            for index in (0..files.len()).filter(|&index| !files[index].is_committed) {
                is_over = false;
                let mut next = files.clone();
                self.step(&mut next, index, rule);
                if seen.insert(next.clone()) {
                    pending.push(next);
                }
            }
            let program = link(&files);
            if is_over && !programs.contains(&program) {
                programs.push(program);
            }
        }
        programs
    }

    #[track_caller]
    fn assert_one_program(&self) {
        let without_skips = self.link_in_every_order(Rule::DefinesEverything);
        assert_eq!(without_skips.len(), 1);
        assert_eq!(
            self.link_in_every_order(Rule::LeavesToEarlierFiles),
            without_skips
        );
    }
}

// Type `i` has a field of type `i + 1`.
fn chain(length: u64) -> Vec<Vec<u64>> {
    let mut named_by_fields: Vec<Vec<u64>> = (1..length).map(|next| vec![next]).collect();
    named_by_fields.push(Vec::new());
    named_by_fields
}

#[test]
fn files_that_enter_a_chain_at_different_places_give_one_program() {
    let length = u64::from(LAST_DEFINITION_LEVEL) + 4;
    for mentioned in [
        vec![vec![0], vec![1], vec![2]],
        vec![vec![2], vec![1], vec![0]],
        vec![vec![1], vec![0, 2], vec![1]],
        vec![vec![0], vec![0], vec![1, 0]],
    ] {
        let model = Model {
            mentioned,
            named_by_fields: chain(length),
            seen_otherwise: None,
        };
        model.assert_one_program();
    }
}

#[test]
fn a_rule_without_levels_gives_more_than_one_program() {
    let model = Model {
        mentioned: vec![vec![0], vec![1]],
        named_by_fields: chain(u64::from(LAST_DEFINITION_LEVEL) + 3),
        seen_otherwise: None,
    };
    model.assert_one_program();
    assert!(model.link_in_every_order(Rule::LeavesWithoutLevels).len() > 1);
}

#[test]
fn types_that_name_each_other_give_one_program() {
    let model = Model {
        mentioned: vec![vec![0], vec![1], vec![2, 0]],
        named_by_fields: vec![vec![1, 2], vec![0], vec![1, 3], vec![0]],
        seen_otherwise: None,
    };
    model.assert_one_program();
}

#[test]
fn a_type_with_several_parents_gives_one_program() {
    let model = Model {
        mentioned: vec![vec![0, 1], vec![1, 2], vec![2, 0], vec![3]],
        named_by_fields: vec![
            vec![3],
            vec![3, 4],
            vec![4, 3],
            vec![5],
            vec![5],
            vec![6],
            vec![],
        ],
        seen_otherwise: None,
    };
    model.assert_one_program();
}

#[test]
fn a_file_that_mentions_what_earlier_files_only_name_gives_one_program() {
    let model = Model {
        mentioned: vec![vec![0], vec![4], vec![1, 5], vec![2]],
        named_by_fields: vec![vec![1], vec![2], vec![3], vec![], vec![5, 1], vec![2, 3]],
        seen_otherwise: None,
    };
    model.assert_one_program();
}

// The first file is where the literals stand: under type 0 it sees type 1, and every other file sees type 2.
#[test]
fn a_type_whose_fields_name_other_types_in_its_own_file_gives_one_program() {
    let model = Model {
        mentioned: vec![vec![0], vec![0], vec![0]],
        named_by_fields: vec![vec![2], vec![], vec![]],
        seen_otherwise: Some((0, 0, vec![1])),
    };
    model.assert_one_program();
}
