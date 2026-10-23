use super::*;

const NO_RECORDS: ListCounts = [0; ProgramList::COUNT];
const HEADER_SIZE: u64 = HEADER_SIZE_IN_BYTES as u64;
const LARGEST_PROGRAM_SIZE: u64 = u32::MAX as u64 / 8 * 8;

fn counts_of(counts: &[(ProgramList, u64)]) -> ListCounts {
    let mut all_counts = NO_RECORDS;
    for &(list, count) in counts {
        all_counts[list as usize] = count;
    }
    all_counts
}

fn create_plan(counts: &[(ProgramList, u64)]) -> SectionPlan {
    plan_sections(&counts_of(counts)).expect("the program fits in 4 GiB")
}

fn plan_error(counts: &[(ProgramList, u64)]) -> Option<EmitError> {
    plan_sections(&counts_of(counts)).err()
}

fn too_large(bytes: u64) -> Option<EmitError> {
    Some(EmitError::ProgramTooLarge { bytes })
}

fn create_task<'p, 'o>(source: Source<'p>, counts: &[(ProgramList, u64)]) -> Task<'p, 'o> {
    Task {
        source,
        counts: counts_of(counts),
        first_indices: NO_RECORDS,
        outputs: Vec::new(),
    }
}

fn create_empty_outputs<'o>() -> Vec<OutputSlice<'o>> {
    Vec::from(ProgramList::ALL.map(|_| OutputSlice::new(&mut [])))
}

#[test]
fn round_up_returns_next_multiple() {
    assert_eq!(round_up(0, 4), 0);
    assert_eq!(round_up(1, 4), 4);
    assert_eq!(round_up(3, 4), 4);
    assert_eq!(round_up(4, 4), 4);
    assert_eq!(round_up(5, 4), 8);
    assert_eq!(round_up(4, 8), 8);
    assert_eq!(round_up(8, 8), 8);
    assert_eq!(round_up(9, 8), 16);
    assert_eq!(round_up(u64::from(u32::MAX), 8), 1 << 32);
}

#[test]
fn round_up_saturates() {
    for alignment in [4, 8] {
        let rounded = round_up(u64::MAX, alignment);
        assert_eq!(rounded % alignment, 0);
        assert!(rounded > u64::MAX - alignment);
    }
}

#[test]
fn plan_of_empty_program() {
    let plan = create_plan(&[]);
    let empty_section = Section {
        offset_in_bytes: HEADER_SIZE_IN_BYTES as u32,
        count: 0,
    };
    assert_eq!(plan.sections, [empty_section; ProgramList::COUNT]);
    assert_eq!(u64::from(plan.size_in_bytes), round_up(HEADER_SIZE, 8));
}

#[test]
fn sections_are_aligned_and_in_order() {
    let counts: Vec<(ProgramList, u64)> = ProgramList::ALL.into_iter().zip(1..).collect();
    let plan = create_plan(&counts);
    let mut end = HEADER_SIZE;
    for (list, count) in counts {
        let section = plan.sections[list as usize];
        let offset = u64::from(section.offset_in_bytes);
        assert_eq!(u64::from(section.count), count, "{}", list.name());
        assert_eq!(offset % 4, 0, "{}", list.name());
        assert!(end <= offset && offset - end < 4, "{}", list.name());
        end = offset + count * list.element_size() as u64;
    }
    let size = u64::from(plan.size_in_bytes);
    assert_eq!(size % 8, 0);
    assert!(end <= size && size - end < 8);
}

#[test]
fn section_after_bytes_is_padded_to_4_bytes() {
    let plan = create_plan(&[(ProgramList::Bytes, 5), (ProgramList::Words, 1)]);
    let offset_of = |list: ProgramList| u64::from(plan.sections[list as usize].offset_in_bytes);
    assert_eq!(offset_of(ProgramList::Bytes), HEADER_SIZE);
    assert_eq!(offset_of(ProgramList::Words), HEADER_SIZE + 8);
    assert_eq!(offset_of(ProgramList::Strings), HEADER_SIZE + 12);
    assert_eq!(offset_of(ProgramList::WebAssemblyModules), HEADER_SIZE + 12);
    assert_eq!(u64::from(plan.size_in_bytes), round_up(HEADER_SIZE + 12, 8));
}

#[test]
fn plan_rejects_more_than_4_gib() {
    let largest_byte_count = LARGEST_PROGRAM_SIZE - HEADER_SIZE;
    let largest = create_plan(&[(ProgramList::Bytes, largest_byte_count)]);
    assert_eq!(u64::from(largest.size_in_bytes), LARGEST_PROGRAM_SIZE);
    let last_section = largest.sections[ProgramList::COUNT - 1];
    assert_eq!(
        u64::from(last_section.offset_in_bytes),
        LARGEST_PROGRAM_SIZE
    );

    let error = plan_error(&[(ProgramList::Bytes, largest_byte_count + 1)]);
    assert_eq!(error, too_large(1 << 32));
}

#[test]
fn plan_measures_bytes_not_records() {
    let list = ProgramList::Modules;
    let element_size = list.element_size() as u64;
    assert!(element_size > 1);
    let fitting_count = (LARGEST_PROGRAM_SIZE - HEADER_SIZE) / element_size;
    let fitting = create_plan(&[(list, fitting_count)]);
    assert_eq!(
        u64::from(fitting.sections[list as usize].count),
        fitting_count
    );

    let count = (1 << 32) / element_size + 1;
    assert!(count <= u64::from(u32::MAX));
    let size = round_up(HEADER_SIZE + count * element_size, 8);
    assert_eq!(plan_error(&[(list, count)]), too_large(size));
}

#[test]
fn plan_adds_up_every_list() {
    let bytes = (ProgramList::Bytes, 1 << 31);
    let code = (
        ProgramList::Code,
        (1 << 31) / ProgramList::Code.element_size() as u64,
    );
    assert_eq!(plan_error(&[bytes]), None);
    assert_eq!(plan_error(&[code]), None);
    let size = round_up(HEADER_SIZE + (1 << 32), 8);
    assert_eq!(plan_error(&[bytes, code]), too_large(size));
}

#[test]
fn plan_of_counts_past_64_bits_saturates() {
    let counts = [
        (ProgramList::Modules, u64::MAX),
        (ProgramList::Functions, u64::MAX),
    ];
    let Some(EmitError::ProgramTooLarge { bytes }) = plan_error(&counts) else {
        panic!("the program does not fit in 4 GiB");
    };
    assert!(bytes > u64::MAX - 8);
}

#[test]
fn first_indices_are_prefix_sums_in_task_order() {
    let (words, code) = (ProgramList::Words, ProgramList::Code);
    let no_functions = || Source::Functions(Vec::new());
    let mut tasks = [
        create_task(no_functions(), &[(words, 3), (code, 10)]),
        create_task(no_functions(), &[(code, 5)]),
        create_task(no_functions(), &[(words, 2)]),
    ];
    let totals = set_first_indices(&mut tasks);
    assert_eq!(totals, counts_of(&[(words, 5), (code, 15)]));
    let expected = [
        NO_RECORDS,
        counts_of(&[(words, 3), (code, 10)]),
        counts_of(&[(words, 3), (code, 15)]),
    ];
    assert_eq!(tasks.map(|task| task.first_indices), expected);
}

#[test]
fn string_task_measures_strings_and_bytes() {
    let mut strings = StringTable::default();
    for text in [&b"ab"[..], b"", b"cde"] {
        strings.intern(text);
    }
    let mut task = create_task(Source::Strings(&strings), &[]);
    task.measure();
    let expected = [(ProgramList::Strings, 3), (ProgramList::Bytes, 5)];
    assert_eq!(task.counts, counts_of(&expected));
}

#[test]
fn task_is_written_once_outputs_are_full() {
    let mut bytes = [MaybeUninit::new(0u8); 2];
    let mut records = [MaybeUninit::new(0u8); ProgramList::Strings.element_size()];
    let mut strings = StringTable::default();
    strings.intern(b"ab");
    let mut task = create_task(Source::Strings(&strings), &[]);
    task.measure();
    task.outputs = create_empty_outputs();
    task.outputs[ProgramList::Bytes as usize] = OutputSlice::new(&mut bytes);
    task.outputs[ProgramList::Strings as usize] = OutputSlice::new(&mut records);
    assert!(!task.is_written());
    task.write();
    assert!(task.is_written());
    drop(task);
    // SAFETY: every byte was initialized when the array was created.
    let written = bytes.map(|byte| unsafe { byte.assume_init() });
    assert_eq!(written, *b"ab");
}

#[test]
fn function_task_frees_functions_when_written() {
    let functions = vec![Function::default()];
    let mut counts = NO_RECORDS;
    functions::measure(functions.iter(), &mut counts);
    assert_eq!(counts[ProgramList::Functions as usize], 1);
    let sizes = ProgramList::ALL.map(|list| byte_count(list, counts[list as usize]));
    let mut space = vec![MaybeUninit::<u8>::uninit(); sizes.iter().sum()];
    let mut output = OutputSlice::new(&mut space);
    let mut task = create_task(Source::Functions(functions), &[]);
    task.measure();
    assert_eq!(task.counts, counts);
    task.outputs = sizes.into_iter().map(|size| output.take(size)).collect();
    task.write();
    assert!(task.is_written());
    let Source::Functions(functions) = &task.source else {
        panic!("the task holds functions");
    };
    assert_eq!(functions.capacity(), 0);
}

#[test]
#[should_panic(expected = "the task writes as many records of Bytes as it measured")]
fn writing_more_than_measured_panics() {
    let mut strings = StringTable::default();
    strings.intern(b"ab");
    let mut task = create_task(Source::Strings(&strings), &[]);
    task.outputs = create_empty_outputs();
    task.write();
}

#[test]
#[should_panic(expected = "the task fills exactly the space reserved for it in Bytes")]
fn reserving_more_space_than_measured_panics() {
    let mut space = [MaybeUninit::<u8>::uninit(); 3];
    let mut strings = StringTable::default();
    strings.intern(b"ab");
    let mut task = create_task(Source::Strings(&strings), &[]);
    task.measure();
    task.outputs = create_empty_outputs();
    task.outputs[ProgramList::Bytes as usize] = OutputSlice::new(&mut space);
    task.write();
}

#[test]
fn uninitialized_bytes_cover_requested_size() {
    let mut storage = Vec::with_capacity(2);
    assert_eq!(uninitialized_bytes(&mut storage, 16).len(), 16);
    assert_eq!(uninitialized_bytes(&mut storage, 9).len(), 9);
    assert!(storage.is_empty());
}

#[test]
#[should_panic]
fn uninitialized_bytes_stay_inside_capacity() {
    uninitialized_bytes(&mut Vec::new(), 1);
}
