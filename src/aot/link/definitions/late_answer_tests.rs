use core::fmt::Write;

use crate::ir::print_program;
use crate::link::testing::{forward, link_units, with_lowered_units_without_bun_modules};
use crate::lower::late_answers;

// Every file of types is entered at each of five places by some file of code.
const TYPE_FILE_COUNT: usize = 3;
const CODE_FILE_COUNT: usize = 15;

fn write_types(index: usize) -> String {
    let mut text = String::new();
    if index > 0 {
        let earlier = index - 1;
        writeln!(text, "import type {{ Shared{earlier}, Kind{earlier}, Twin{earlier} }} from './types{earlier}';").unwrap();
    }
    let link = match index {
        0 => String::new(),
        _ => format!(
            "earlier?: Shared{0}; kinds: Kind{0}[]; twin: Twin{0};",
            index - 1
        ),
    };
    // Where the literal of `narrow` stands it has the layout of what it is written under, elsewhere the layout of its own names.
    writeln!(
        text,
        "export interface Shared{index} {{ id: number; name: string; next?: Shared{index}; deep: Deep{index}A; {link} }}
export interface Twin{index} {{ id: string; name: number; next?: Twin{index}; deep: Deep{index}B; {link} }}
export interface Deep{index}A {{ inner: Deep{index}B }}
export interface Deep{index}B {{ inner: Deep{index}C }}
export interface Deep{index}C {{ inner: Deep{index}D }}
export interface Deep{index}D {{ inner: Deep{index}E; own{index}: number }}
export interface Deep{index}E {{ inner?: Deep{index}A; last{index}: string }}
export interface First{index} {{ kind: 'first'; value: number; owner?: Shared{index} }}
export interface Second{index} {{ kind: 'second'; text: string; call(x: number): Box{index}<string> }}
export type Kind{index} = First{index} | Second{index};
export interface Box{index}<T> {{ value: T; items: T[]; owner?: Twin{index} }}
export type Loose{index} = {{ [K in keyof Shared{index}]?: Shared{index}[K] }};
export const sample{index} = {{ id: {index}, nested: {{ depth: {index}, label: 'sample' }} }};
export interface Wide{index} {{ width: number; height?: number; inside?: Deep{index}C }}
export const narrow{index} = {{ width: {index} }} satisfies Wide{index};"
    )
    .unwrap();
    text
}

fn write_code(index: usize) -> String {
    let mut text = String::new();
    let types = [index % TYPE_FILE_COUNT, (index + 1) % TYPE_FILE_COUNT];
    for ty in types {
        writeln!(text, "import type {{ Shared{ty}, Twin{ty}, Kind{ty}, Box{ty}, Loose{ty}, Deep{ty}B, Deep{ty}D }} from './types{ty}';").unwrap();
        writeln!(
            text,
            "import {{ narrow{ty}, sample{ty} }} from './types{ty}';"
        )
        .unwrap();
    }
    let next: Vec<usize> = [2 * index + 1, 2 * index + 2]
        .into_iter()
        .filter(|&it| it < CODE_FILE_COUNT)
        .collect();
    for other in &next {
        writeln!(text, "import {{ run{other} }} from './code{other}';").unwrap();
    }
    for ty in types {
        // Each file enters the types at another place.
        let parameter = match index % 5 {
            0 => format!("shared: Shared{ty}"),
            1 => format!("shared: Twin{ty}"),
            2 => format!("shared: Loose{ty}"),
            3 => format!("shared: Deep{ty}B"),
            _ => format!("shared: Deep{ty}D"),
        };
        writeln!(
            text,
            "function read{ty}({parameter}, kind: Kind{ty}, box: Box{ty}<number>): number {{"
        )
        .unwrap();
        writeln!(text, "  const copy = {{ ...sample{ty}, extra: {index} }};").unwrap();
        writeln!(text, "  const held = [shared, box.owner, narrow{ty}];").unwrap();
        writeln!(text, "  return held.length + copy.nested.depth + (kind.kind === 'first' ? kind.value : kind.call(1).items.length);").unwrap();
        writeln!(text, "}}").unwrap();
    }
    let calls: String = next
        .iter()
        .map(|other| format!(" + run{other}(seed)"))
        .collect();
    let readers: Vec<String> = types.iter().map(|ty| format!("read{ty}")).collect();
    let readers = readers.join(", ");
    writeln!(text, "export function run{index}(seed: number): number {{ return [{readers}].length + seed{calls}; }}").unwrap();
    text
}

fn write_program() -> Vec<(String, String)> {
    let mut files = vec![(
        "main.ts".to_owned(),
        "import { run0 } from './code0';\nexport const result = run0(1);\n".to_owned(),
    )];
    files.extend((0..CODE_FILE_COUNT).map(|index| (format!("code{index}.ts"), write_code(index))));
    files
        .extend((0..TYPE_FILE_COUNT).map(|index| (format!("types{index}.ts"), write_types(index))));
    files
}

// The text of the linked program, and how many definitions of layouts the files have written.
fn link_with_late_answers(files: &[(&str, &str)], choice: u64) -> (String, usize) {
    late_answers::with_choice(choice, || {
        with_lowered_units_without_bun_modules(files, |units, projects| {
            let written = units.iter().map(|unit| unit.layout_definitions.len()).sum();
            let linked = link_units(units, projects, &forward).expect("the program links");
            (print_program(&linked.program), written)
        })
    })
}

#[track_caller]
fn assert_same_program(program: &str, expected: &str, choice: u64) {
    if program == expected {
        return;
    }
    let lines = program.lines().zip(expected.lines());
    let different: Vec<String> = lines
        .filter(|(line, expected)| line != expected)
        .take(6)
        .map(|(line, expected)| format!("  {line}\n  {expected} (expected)\n"))
        .collect();
    let (count, expected_count) = (program.lines().count(), expected.lines().count());
    panic!(
        "choice {choice}: {count} lines, expected {expected_count}\n{}",
        different.concat()
    );
}

#[test]
fn program_is_the_same_whichever_answers_come_too_late() {
    let files = write_program();
    let files: Vec<(&str, &str)> = files
        .iter()
        .map(|(name, text)| (&name[..], &text[..]))
        .collect();
    let (expected, written_by_all) = link_with_late_answers(&files, late_answers::ALL);
    let (program, written_once) = link_with_late_answers(&files, late_answers::NONE);
    assert_same_program(&program, &expected, late_answers::NONE);
    assert!(
        written_once < written_by_all,
        "{written_once} of {written_by_all}"
    );
    for choice in 1..40 {
        let (program, written) = link_with_late_answers(&files, choice);
        assert_same_program(&program, &expected, choice);
        assert!(
            written_once < written && written < written_by_all,
            "choice {choice}: {written}"
        );
    }
}
