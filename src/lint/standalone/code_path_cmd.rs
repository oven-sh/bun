//! `bun-lint code-path ..`
//!
//! - `dot <file>`: the graph of each code path of the file, as `makeDotArrows` of ESLint's
//!   `debug-helpers.js` prints it, in the order in which the code paths end.
//! - `fixtures <directory>`: compares that with the `/*expected */` comments of each file of
//!   ESLint's `tests/fixtures/code-path-analysis`.

use bun_lint::context::Severity;
use bun_lint::prelude::*;
use bun_lint::runner::Enabled;
use std::cell::RefCell;
use std::fmt::Write as _;

thread_local! {
    /// What the rules below have to say about the file that was linted last.
    static OUTPUT: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

fn run_rule<R: Rule>(path: &str, code: &[u8]) -> Vec<String> {
    OUTPUT.take();
    crate::with_file(path, code, &LanguageOptions::default(), |file| {
        let rule = R::new(&Options::new(&[]));
        let rules = [Enabled {
            rule: &rule,
            severity: Severity::Error,
        }];
        bun_lint::runner::run(file, &rules, false);
    });
    OUTPUT.take()
}

/// `makeDotArrows`
fn make_dot_arrows(path: CodePath) -> String {
    let initial = path.initial_segment();
    let mut stack = std::collections::VecDeque::from([(initial, 0)]);
    let mut done = std::collections::HashSet::new();
    let mut last = Some(initial);
    let mut text = format!("initial->{initial}");
    while let Some((segment, index)) = stack.pop_back() {
        if done.contains(&segment) && index == 0 {
            continue;
        }
        done.insert(segment);
        let Some(&next) = segment.all_next_segments().get(index) else {
            continue;
        };
        let _ = match last == Some(segment) {
            true => write!(text, "->{next}"),
            false => write!(text, ";\n{segment}->{next}"),
        };
        last = Some(next);
        stack.push_front((segment, index + 1));
        stack.push_back((next, 0));
    }
    for (segments, name) in [(path.returned_segments(), "final"), (path.thrown_segments(), "thrown")] {
        for segment in segments {
            let _ = match last == Some(segment) {
                true => write!(text, "->{name}"),
                false => write!(text, ";\n{segment}->{name}"),
            };
            last = None;
        }
    }
    text.push(';');
    text
}

struct Dot;

impl Rule for Dot {
    const META: Meta = Meta::eslint("code-path-dot", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        Dot
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.code_path_end(|_, path, _, _| OUTPUT.with_borrow_mut(|it| it.push(make_dot_arrows(path))));
    }
}

fn expected_dot_arrows(source: &str) -> Vec<String> {
    let mut expected = Vec::new();
    let mut rest = source;
    while let Some((_, after)) = rest.split_once("/*expected") {
        let Some((arrows, after)) = after.split_once("*/") else {
            break;
        };
        expected.push(arrows.trim().replace("\r\n", "\n"));
        rest = after;
    }
    expected
}

fn fixtures(directory: &str) {
    let mut paths: Vec<_> = (std::fs::read_dir(directory).expect("the directory").flatten())
        .map(|it| it.path())
        .collect();
    paths.sort();
    let (mut passed, mut failed) = (0, 0);
    for path in paths {
        let source = std::fs::read_to_string(&path).expect("the file");
        let name = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
        let (expected, actual) = (expected_dot_arrows(&source), run_rule::<Dot>(&name, source.as_bytes()));
        if expected == actual {
            passed += 1;
            continue;
        }
        failed += 1;
        println!("──── {name}\n{source}");
        for i in 0..expected.len().max(actual.len()) {
            let (expected, actual) = (expected.get(i), actual.get(i));
            if expected != actual {
                println!(
                    "expected:\n{}\nactual:\n{}",
                    expected.map_or("nothing", |it| it),
                    actual.map_or("nothing", |it| it)
                );
            }
        }
    }
    println!("{passed} passed, {failed} failed");
}

pub(crate) fn run(args: &[String]) {
    match args {
        [command, path] if command == "dot" => {
            let code = std::fs::read(path).expect("the file");
            println!("{}", run_rule::<Dot>(path, &code).join("\n\n"));
        }
        [command, directory] if command == "fixtures" => fixtures(directory),
        _ => println!("usage: bun-lint code-path dot <file> | fixtures <directory>"),
    }
}
