//! The modules of the test suite of the specification. `WASM_SCRIPTS` names a directory that has, for each script,
//! one with its modules, `commands.txt` and `messages.txt`. Without it nothing is tested.

#![allow(clippy::disallowed_methods)]

mod support;

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use bun_engine_wasm_format::*;
use support::Ignore;

/// These predate multiple tables and memories.
const OUTDATED: &[(&str, &[&str])] = &[
    (
        "threads-imports",
        &["309", "313", "317", "404", "408", "412"],
    ),
    ("threads-memory", &["14", "15"]),
];

/// These have an error in unreachable code and another one after it, which the file names.
const OTHER_MESSAGE: &[(&str, &[&str])] = &[
    ("br_table", &["1266", "1349"]),
    ("unreached-invalid", &["489"]),
];

fn is_listed(list: &[(&str, &[&str])], script: &str, line: &str) -> bool {
    list.iter()
        .any(|(name, lines)| *name == script && lines.contains(&line))
}

fn byte_by_byte(bytes: &[u8]) -> Result<Module, Error> {
    let mut parser = Parser::new(Features::all());
    bytes.chunks(1).try_for_each(|byte| parser.feed(byte))?;
    let mut unvalidated = parser.finish()?;
    let bodies = std::iter::from_fn(|| unvalidated.take_bodies());
    let outcomes = bodies
        .map(|bodies| bodies.validate(&mut Scratch::default()))
        .collect();
    unvalidated.complete(outcomes)
}

fn check_script(directory: &Path, failures: &mut Vec<String>) -> usize {
    let script = directory.file_name().unwrap().to_str().unwrap();
    let messages = fs::read_to_string(directory.join("messages.txt")).unwrap_or_default();
    let messages: BTreeMap<_, _> = messages
        .split('\n')
        .filter_map(|line| line.split_once(' '))
        .collect();
    let mut count = 0;
    for command in fs::read_to_string(directory.join("commands.txt"))
        .unwrap()
        .lines()
    {
        let words: Vec<_> = command.split(' ').collect();
        let Some(file) = words.iter().find(|word| word.ends_with(".wasm")) else {
            continue;
        };
        count += 1;
        let line = words[0];
        let is_valid = !matches!(words[1], "assert_invalid" | "assert_malformed")
            || is_listed(OUTDATED, script, line);
        let bytes = fs::read(directory.join(file)).unwrap();
        let streamed = byte_by_byte(&bytes).err();
        match Module::new(bytes, Features::all()) {
            Ok(module) => {
                for code in (0..module.code_count()).map(CodeIndex) {
                    let mut driver = module.body(code).driver();
                    let Ok(()) = driver.run(&mut Ignore);
                    assert_eq!(driver.offset(), module.body_span(code).len);
                }
                if !is_valid || streamed.is_some() {
                    failures.push(format!("{script}:{line} was accepted"));
                }
            }
            Err(error) => {
                let text = error
                    .to_string()
                    .replace('\\', "\\5c")
                    .replace('\n', "\\0a");
                let expected = messages
                    .get(file)
                    .filter(|_| !is_listed(OTHER_MESSAGE, script, line));
                if is_valid
                    || expected.is_some_and(|&expected| expected != text)
                    || streamed != Some(error)
                {
                    failures.push(format!("{script}:{line} {text}"));
                }
            }
        }
    }
    count
}

#[test]
fn modules_of_the_suite() {
    let Ok(root) = std::env::var("WASM_SCRIPTS") else {
        return;
    };
    let mut failures = Vec::new();
    let directories = fs::read_dir(root)
        .unwrap()
        .map(|entry| entry.unwrap().path());
    let count: usize = directories
        .filter(|path| path.is_dir())
        .map(|path| check_script(&path, &mut failures))
        .sum();
    assert!(count > 0);
    assert_eq!(failures, Vec::<String>::new());
}
