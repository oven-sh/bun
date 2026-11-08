use super::*;

type Captures = Vec<Option<(usize, usize)>>;

enum Piece {
    Byte(u8),
    AnyByte,
    Digit,
    WordByte,
    OneOf {
        bytes: Vec<u8>,
        is_negated: bool,
    },
    Start,
    End,
    Group {
        alternatives: Vec<Vec<Piece>>,
        capture: Option<usize>,
    },
    Repeated {
        piece: Box<Piece>,
        at_least: usize,
        at_most: usize,
    },
}

impl Piece {
    fn takes(&self, byte: u8) -> bool {
        match self {
            Piece::Byte(expected) => byte == *expected,
            Piece::AnyByte => true,
            Piece::Digit => byte.is_ascii_digit(),
            Piece::WordByte => byte.is_ascii_alphanumeric() || byte == b'_',
            Piece::OneOf { bytes, is_negated } => bytes.contains(&byte) != *is_negated,
            Piece::Start | Piece::End | Piece::Group { .. } | Piece::Repeated { .. } => false,
        }
    }
}

struct Parser<'a> {
    pattern: &'a [u8],
    at: usize,
    groups: usize,
}

impl Parser<'_> {
    fn next(&mut self) -> u8 {
        let byte = self.pattern[self.at];
        self.at += 1;
        byte
    }

    fn alternatives(&mut self) -> Vec<Vec<Piece>> {
        let mut alternatives = vec![Vec::new()];
        while self.at < self.pattern.len() && self.pattern[self.at] != b')' {
            let piece = match self.next() {
                b'|' => {
                    alternatives.push(Vec::new());
                    continue;
                }
                b'.' => Piece::AnyByte,
                b'^' => Piece::Start,
                b'$' => Piece::End,
                b'\\' => self.escaped(),
                b'[' => self.set(),
                b'(' => self.group(),
                byte => Piece::Byte(byte),
            };
            let piece = self.repeated(piece);
            alternatives
                .last_mut()
                .expect("there is a first")
                .push(piece);
        }
        alternatives
    }

    fn escaped(&mut self) -> Piece {
        match self.next() {
            b'd' => Piece::Digit,
            b'w' => Piece::WordByte,
            byte => Piece::Byte(byte),
        }
    }

    fn set(&mut self) -> Piece {
        let is_negated = self.pattern[self.at] == b'^';
        self.at += usize::from(is_negated);
        let mut bytes = Vec::new();
        loop {
            match self.next() {
                b']' => return Piece::OneOf { bytes, is_negated },
                b'\\' => {
                    let escaped = self.next();
                    bytes.push(escaped);
                }
                byte => bytes.push(byte),
            }
        }
    }

    fn group(&mut self) -> Piece {
        let capture = match self.pattern[self.at..].starts_with(b"?:") {
            true => {
                self.at += 2;
                None
            }
            false => {
                self.groups += 1;
                Some(self.groups)
            }
        };
        let alternatives = self.alternatives();
        assert_eq!(self.next(), b')');
        Piece::Group {
            alternatives,
            capture,
        }
    }

    fn repeated(&mut self, piece: Piece) -> Piece {
        let (at_least, at_most) = match self.pattern.get(self.at) {
            Some(b'+') => (1, usize::MAX),
            Some(b'*') => (0, usize::MAX),
            Some(b'?') => (0, 1),
            _ => return piece,
        };
        self.at += 1;
        Piece::Repeated {
            piece: Box::new(piece),
            at_least,
            at_most,
        }
    }
}

struct Run<'p> {
    piece: &'p Piece,
    at_least: usize,
    at_most: usize,
    rest: &'p [Piece],
}

struct Matcher<'a> {
    text: &'a [u8],
}

impl Matcher<'_> {
    fn matches(
        &self,
        pieces: &[Piece],
        at: usize,
        captures: &mut Captures,
        then: &mut dyn FnMut(usize, &mut Captures) -> bool,
    ) -> bool {
        let Some((first, rest)) = pieces.split_first() else {
            return then(at, captures);
        };
        match first {
            Piece::Start => at == 0 && self.matches(rest, at, captures, then),
            Piece::End => at == self.text.len() && self.matches(rest, at, captures, then),
            Piece::Group {
                alternatives,
                capture,
            } => alternatives.iter().any(|alternative| {
                let mut go_on = |end: usize, captures: &mut Captures| {
                    let before = capture.map(|index| captures[index].replace((at, end)));
                    if self.matches(rest, end, captures, &mut *then) {
                        return true;
                    }
                    if let (Some(index), Some(before)) = (*capture, before) {
                        captures[index] = before;
                    }
                    false
                };
                self.matches(alternative, at, captures, &mut go_on)
            }),
            Piece::Repeated {
                piece,
                at_least,
                at_most,
            } => {
                let run = Run {
                    piece,
                    at_least: *at_least,
                    at_most: *at_most,
                    rest,
                };
                self.repeats(&run, 0, at, captures, then)
            }
            one_byte => {
                self.text.get(at).is_some_and(|&byte| one_byte.takes(byte))
                    && self.matches(rest, at + 1, captures, then)
            }
        }
    }

    fn repeats(
        &self,
        run: &Run<'_>,
        count: usize,
        at: usize,
        captures: &mut Captures,
        then: &mut dyn FnMut(usize, &mut Captures) -> bool,
    ) -> bool {
        if count < run.at_most {
            let mut once_more = |end: usize, captures: &mut Captures| {
                end > at && self.repeats(run, count + 1, end, captures, &mut *then)
            };
            let piece = core::slice::from_ref(run.piece);
            if self.matches(piece, at, captures, &mut once_more) {
                return true;
            }
        }
        count >= run.at_least && self.matches(run.rest, at, captures, then)
    }
}

fn find(pattern: &str, line: &str) -> Option<Vec<String>> {
    let mut parser = Parser {
        pattern: pattern.as_bytes(),
        at: 0,
        groups: 0,
    };
    let alternatives = parser.alternatives();
    assert_eq!(parser.at, pattern.len(), "{pattern}");
    let whole = [Piece::Group {
        alternatives,
        capture: Some(0),
    }];
    let matcher = Matcher {
        text: line.as_bytes(),
    };
    (0..=line.len()).find_map(|start| {
        let mut captures: Captures = vec![None; parser.groups + 1];
        let mut anywhere = |_: usize, _: &mut Captures| true;
        if !matcher.matches(&whole, start, &mut captures, &mut anywhere) {
            return None;
        }
        let taken = captures.iter();
        let taken = taken.map(|range| range.map_or("", |(from, to)| &line[from..to]));
        Some(taken.map(str::to_owned).collect())
    })
}

fn groups(pattern: &str, line: &str) -> Vec<String> {
    let mut found =
        find(pattern, line).unwrap_or_else(|| panic!("{pattern} finds nothing in {line}"));
    found.remove(0);
    found
}

#[test]
fn the_matcher_tells_lines_apart() {
    assert_eq!(
        groups(r"^a (\d+) \| (true|false)$", "a 12 | false"),
        ["12", "false"]
    );
    assert_eq!(find(r"^a (\d+)$", "a 12 |"), None);
    assert_eq!(find(r"^a (\d+)", "ba 12"), None);
    assert_eq!(find(r"a \| b", "a b"), None);
    assert_eq!(find(r"\w+\.js", "index_js"), None);
    assert_eq!(groups(r"(?:.*[\\/])?(.*)$", r"a/b\c d"), ["c d"]);
    assert_eq!(groups(r"(?:.*[\\/])?(.*)$", "c d"), ["c d"]);
    assert_eq!(groups(r"x[\\/]([^\\/]+)[\\/]", "x/name/y"), ["name"]);
    assert_eq!(find(r"x[\\/]([^\\/]+)[\\/]", "x//y"), None);
}

fn counts_of_closed_run() -> CountsOfScan {
    CountsOfScan {
        files_at_start: 5,
        files_beside: 2,
        milliseconds: 3,
        builtins: 1,
        names_added: 4,
        exports: 6,
        modules: 7,
        handed_on: 8,
        files_read: 9,
        ..CountsOfScan::default()
    }
}

#[test]
fn scan() {
    let counts = counts_of_closed_run();
    let (texts, scan) = (line_of_texts(&counts), line_of_scan(&counts));
    assert_eq!(
        texts,
        "AOT test run | files that hold code as text which nothing near them can run 0 | of 9 files read 0 can run code that no build has seen, 0 of them beside every test file"
    );
    assert_eq!(
        scan,
        "AOT test run | scan of 5 files and 2 beside them | 3 ms | sites: built-ins 1 | names added 4 | exports 6 | modules 7 | handed on 8 | mocks any module false | hands on any module false | spies on objects from somewhere false"
    );
    let pattern = r"\d+ can run code that no build has seen|mocks any module \w+ .*$";
    let found = [&texts, &scan].map(|line| find(pattern, line).expect("each has one")[0].clone());
    assert_eq!(
        found,
        [
            "0 can run code that no build has seen",
            "mocks any module false | hands on any module false | spies on objects from somewhere false",
        ]
    );
    assert_eq!(
        groups(r"^AOT test run \| scan of (\d+) files", &scan),
        ["5"]
    );
    assert!(scan.starts_with("AOT test run | scan of "));
    assert_eq!(groups(r" \| exports (\d+) \| ", &scan), ["6"]);
    assert_eq!(groups(r" \| modules (\d+) \| ", &scan), ["7"]);
    assert!(scan.contains("| mocks any module false |"));
    assert!(scan.ends_with("spies on objects from somewhere false"));
}

#[test]
fn scan_of_a_run_that_is_open() {
    let counts = CountsOfScan {
        mocks_any_module: true,
        hands_on_any_module: true,
        spies_on_objects_from_somewhere: true,
        texts_left_out: 1,
        runners: 3,
        runners_beside_all: 2,
        ..counts_of_closed_run()
    };
    assert!(line_of_texts(&counts).ends_with(
        "can run 1 | of 9 files read 3 can run code that no build has seen, 2 of them beside every test file"
    ));
    assert!(line_of_scan(&counts).ends_with(
        " | mocks any module true | hands on any module true | spies on objects from somewhere true"
    ));
}

#[test]
fn what_tests_replace() {
    let line = line_of_what_tests_replace(3, 12, 1, true, 2, false);
    assert_eq!(
        line,
        "AOT test run | variables that tests may replace 3 in 12 files | modules that may be mocked 1 | a spy under any name true | names that spies on objects from somewhere spell 2 | such a spy may reach any module false"
    );
    assert_eq!(
        groups(r"variables that tests may replace (\d+) in", &line),
        ["3"]
    );
    assert!(line.contains("a spy under any name true"));
    let pattern = r"variables that tests may replace (\d+) in (\d+) files";
    assert_eq!(groups(pattern, &line), ["3", "12"]);
    assert_eq!(
        groups(r"\| a spy under any name (true|false) \|", &line),
        ["true"]
    );
}

#[test]
fn es_packages_that_mocks_name() {
    let line = line_of_es_packages_that_mocks_name(2);
    let expected = "AOT modules | ES packages that mocks name, which may run again 2";
    assert_eq!(line, expected);
}

#[test]
fn files_that_may_run_again() {
    let line = line_of_files_that_may_run_again(0);
    assert_eq!(line, "AOT modules | CommonJS files that may run again 0");
    assert_eq!(
        groups(r"CommonJS files that may run again (\d+)", &line),
        ["0"]
    );
}

#[test]
fn load_goes_on() {
    assert_eq!(
        groups(r"^AOT load goes on \| (.*)$", &line_of_load_that_goes_on(3)),
        ["with 3 more files that Workers start from"]
    );
    assert_eq!(
        groups(r"^AOT load goes on \| (.*)$", &line_of_load_that_goes_on(1)),
        ["with 1 more files that Workers start from"]
    );
}

#[test]
fn entries_may_answer() {
    let pattern = r"^AOT test run \| an entry in require\.cache may answer require\(\) of (\d+) modules of the library";
    assert_eq!(groups(pattern, &line_of_entries_that_may_answer(1)), ["1"]);
}

#[test]
fn why_every_file() {
    let pattern = r"^AOT test run \| every file may load again: (?:.*[\\/])?(.*)$";
    let line = line_of_why_every_file(b"/project/helper.js", "loads a file under a query");
    assert_eq!(
        groups(pattern, &line),
        ["helper.js loads a file under a query"]
    );
    let line = line_of_why_every_file(br"C:\project\helper.js", "loads a file under a query");
    assert_eq!(
        groups(pattern, &line),
        ["helper.js loads a file under a query"]
    );
}

#[test]
fn what_file_replaces() {
    let main = table::find_name(b"main").and_then(|main| table::own_member(BuiltinId::Bun, main));
    let members = [BuiltinId::Bun, main.expect("Bun.main is in the table")];
    let line = line_of_what_file_replaces(b"/project/node_modules/or/index.js", &members);
    assert_eq!(
        line,
        format!(
            "AOT test run | /project/node_modules/or/index.js replaces: {} {}",
            table::text_of(members[0]),
            table::text_of(members[1])
        )
    );
    assert!(line.starts_with("AOT test run | ") && line.contains(" replaces: "));
    assert_eq!(groups(r"node_modules[\\/]([^\\/]+)[\\/]", &line), ["or"]);
}

#[test]
fn file_changed_on_disk() {
    let head = "the run writes, moves or removes a file of its own, which is compared with the disk before it loads: ";
    let line = line_of_file_changed_on_disk(b"/project/c0/lib/one.js");
    assert_eq!(
        line.split(head).collect::<Vec<_>>(),
        ["AOT test run | ", "/project/c0/lib/one.js"]
    );
}

#[test]
fn file_leaves_open() {
    let line_of = |what: FileLeavesOpen| {
        line_of_file_that_leaves_open(b"/p/node_modules/asks/index.js", what)
    };
    assert_eq!(
        line_of(FileLeavesOpen::MocksUnspelledModule),
        "AOT test run | /p/node_modules/asks/index.js mocks a module that it does not spell"
    );
    assert_eq!(
        line_of(FileLeavesOpen::HandsOnUnspelledModule),
        "AOT test run | /p/node_modules/asks/index.js hands on a module that it does not spell"
    );
    assert!(
        line_of(FileLeavesOpen::LetsSpyOnGo)
            .contains("asks/index.js lets spyOn go where nobody sees what it is called with")
    );
    assert!(
        line_of(FileLeavesOpen::MayStoreLoaderFunction)
            .ends_with("asks/index.js stores a function that the loader calls, or hands on an object that takes one")
    );
    let marks = "spies on an object from somewhere under a name that it does not spell";
    let with_texts = line_of(FileLeavesOpen::SpiesUnderNamesFromOutside { texts_passed: 2 });
    assert!(with_texts.contains(marks) && with_texts.ends_with(": 2 texts are passed to it"));
    let holds_text = line_of(FileLeavesOpen::HoldsTextThatSpies {
        loads_by_unknown_path: true,
    });
    assert!(
        holds_text.contains("holds code in a string that spies under a name that nobody reads")
    );
    assert!(holds_text.ends_with(" | it loads by a path that nobody reads itself true"));
}

#[test]
fn package_takes_from_test_runner() {
    let path = b"/p/node_modules/asks/index.js";
    let line = line_of_package_that_takes_from_test_runner(path, true, false);
    assert_eq!(
        line,
        "AOT test run | a package takes from the test runner: /p/node_modules/asks/index.js | mocks a module that it does not spell true | spies under a name that it does not spell false"
    );
    let pattern = r"asks\/index\.js \| mocks a module that it does not spell true";
    assert!(find(pattern, &line).is_some());
    let spies_alone = line_of_package_that_takes_from_test_runner(path, false, true);
    assert_eq!(find(pattern, &spies_alone), None);
}

#[test]
fn the_line_on_code_outside_the_run_says_each_count() {
    let counts = CodeOutsideRun {
        files: 6052,
        parsed_at_first: 4502,
        parsed_later: 3,
        import_what_is_sought: 1,
        take_from_test_runner: 1500,
    };
    assert_eq!(
        line_of_code_outside_run(26, &counts),
        "AOT test run | files on disk that the run does not reach 6052, asked about 26 files of the run | parsed because they write the last word of one 4502, later 3 | of those parsed 1500 take from the test runner | 1 take nothing from it and import what is sought"
    );
}

#[test]
fn code_that_build_does_not_see() {
    let line = line_of_code_that_build_does_not_see([0, 1, 2, 3, 4, 5]);
    assert_eq!(
        line,
        "AOT flow | code that the build does not see | loads code by name 0 | loads compiled files by name 1 | evaluates text 2 | imports uncompiled code 3 | runs unseen code 4 | an option admits code 5"
    );
    let pattern = r"loads code by name (\d+) \| loads compiled files by name (\d+)";
    assert_eq!(groups(pattern, &line), ["0", "1"]);
}
