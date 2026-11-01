use core::fmt;
use core::num::NonZeroU32;
use core::sync::atomic::AtomicBool;
use std::sync::Arc;

use bun_core::CodeGenerationFromStrings;

use crate::trim::TrimRequest;

#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum HeapSize {
    #[default]
    Standard,
    Huge,
}

bitflags::bitflags! {
    #[derive(Copy, Clone, PartialEq, Eq, Default, Debug)]
    pub struct ExplainSet: u16 {
        const TEXT = 1 << 0;
        const JSON = 1 << 1;
        const CHECKS = 1 << 2;
        const CHECKS_JSON = 1 << 3;
        const RUNTIME_USE = 1 << 4;
        const DECLINES = 1 << 5;
        const ALLOCATIONS = 1 << 6;
        const ONLY_UNKNOWN_CODE = 1 << 7;
        const ONLY_UNPROVEN_TYPE = 1 << 8;
        const ONLY_MUTATION = 1 << 9;
        const STATISTICS = 1 << 10;
        const ONLY_LIMIT = 1 << 11;
    }
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug, Default)]
pub enum ReportDetail {
    #[default]
    Summary,
    Functions,
    Sites,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct BuildReportRequest {
    pub path: Box<[u8]>,
    pub detail: ReportDetail,
}

/// Called with a file's path, in the checker's format, right before the build reads the file, on the thread that reads it.
#[derive(Clone)]
pub struct ReadListener(pub Arc<dyn Fn(&[u8]) + Send + Sync>);

impl fmt::Debug for ReadListener {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ReadListener")
    }
}

/// For a process that builds many programs: it loads once what a build loads whatever its entry points hold.
#[derive(Clone)]
pub struct Preload {
    /// An empty file beside the entry point.
    pub placeholder_entry_point: Box<[u8]>,
    /// Called on the thread that builds. The build reads its entry points after this returns.
    pub on_loaded: Arc<dyn Fn() + Send + Sync>,
    /// Set before `on_loaded` is called. The builds that begin later load everything themselves.
    pub is_loaded: Arc<AtomicBool>,
}

impl fmt::Debug for Preload {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("Preload")
    }
}

/// The programs that were built before this one for the same realms, the first of them first.
#[derive(Clone, Default)]
pub struct ImagesBelow {
    pub images: Vec<&'static [u8]>,
    /// Whether one of them holds the module at an absolute path.
    pub holds_module: Option<fn(&[u8]) -> bool>,
    /// The last of them is still being built when this build begins, and is not among `images`. Until it is there `holds_module`
    /// answers for it by a guess. This waits for it and answers all of them. It does not return where the guess was wrong.
    pub wait_for_all: Option<fn() -> Vec<&'static [u8]>>,
}

impl ImagesBelow {
    pub fn is_empty(&self) -> bool {
        self.images.is_empty()
    }

    pub fn all(&self) -> Vec<&'static [u8]> {
        self.wait_for_all
            .map_or_else(|| self.images.clone(), |wait_for_all| wait_for_all())
    }

    pub fn wait(&self) {
        if let Some(wait_for_all) = self.wait_for_all {
            wait_for_all();
        }
    }

    pub fn holds_module(&self, path: &[u8]) -> bool {
        self.holds_module.is_some_and(|holds| holds(path))
    }
}

impl fmt::Debug for ImagesBelow {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "ImagesBelow({})", self.images.len())
    }
}

#[derive(Clone, Debug)]
pub struct AotOptions {
    pub heap: HeapSize,
    pub embeds_function_source: bool,
    pub explain: ExplainSet,
    pub trim: TrimRequest,
    pub reports_type_mismatches: bool,
    pub erases_types: bool,
    pub emits_symbols: bool,
    pub omits_builtin_modules: bool,
    /// `--aot-separate-programs`: every entry point begins a program of its own, compiled as it is when it is built alone.
    pub separates_programs: bool,
    pub obfuscates: bool,
    pub code_generation_from_strings: CodeGenerationFromStrings,
    pub omits_foreign_calls: bool,
    pub admits_inspector: bool,
    /// `--aot-allow-code-from-disk`: a path that is known only at run time may name a file with code that the build has not seen. Bun interprets it.
    pub loads_code_from_disk: bool,
    /// The host runs files with code that the build has not seen, though no load of the program names one: the test files of a run that compiles only what they import.
    /// The last entry point stands in for them.
    pub host_runs_files_from_disk: bool,
    /// `bun test --aot`: the test files, where they are no entry points of the build. The runner makes each the main module in its turn, and the build holds those that a file of the program imports.
    pub main_modules_beside_entry_points: Vec<Vec<u8>>,
    /// A layer of a test run: the entry points that the files above it, which the build does not see, name behind `import` and nowhere behind `require`.
    pub entry_points_only_imported_from_above: Vec<Vec<u8>>,
    /// The program holds every module of Bun's own code that the run can load, so none of them runs from its text.
    pub library_runs_compiled_alone: bool,
    /// The program is Bun's own code and nothing else, built before any of the test runs that it serves is known. It rests on nothing that a run can change.
    pub holds_library_alone: bool,
    pub reference_library_image: Option<&'static [u8]>,
    pub ir_output_path: Option<Box<[u8]>>,
    /// `--aot-testing=NoExecutable`: the build runs as always and writes no executable. For tests that only read `ir_output_path`.
    pub writes_no_executable: bool,
    pub build_report: Option<BuildReportRequest>,
    pub runs_in_place: bool,
    pub checks_only: bool,
    /// `bun test --aot`: `@jest/globals` and `vitest` are `bun:test`, as in `bun test`.
    pub runs_tests: bool,
    /// `bun test --globals=vitest`.
    pub has_globals_of_vitest: bool,
    /// `bun test --aot --coverage`: the files that the report is about count how often their parts run.
    pub counts_executions: bool,
    /// `--watch` starts to watch each file here.
    pub before_read: Option<ReadListener>,
    /// The word `TestRunPartFiles:<n>` of `BUN_DEBUG_TEST_AOT_WORDS`: `bun test --aot` builds a program for every `n` test files. Without it, one for all of them.
    pub test_run_part_files: Option<u32>,
    /// The word `TestRunLayers:0` of `BUN_DEBUG_TEST_AOT_WORDS`, for measuring: the test files and what they import are one program, as where a run has few test files.
    pub test_run_is_one_program: bool,
    /// `bun test --aot`: how many bytes of source a program may hold for its build to fit into the memory that the run can get.
    /// `None`: nobody has measured the memory, and the build takes the form that is soonest done.
    pub source_that_fits_in_memory: Option<u64>,
    /// `bun test --aot`: the entry points are test files. Their types stop at them.
    pub is_part_of_test_files: bool,
    /// `bun test --aot --rerun-each`: the runner loads each test file several times in one realm, and what the file imports stays as it is.
    pub entry_points_run_again: bool,
    /// `bun test --aot --isolate` or `--parallel`: a TypeScript module that exports a name of another module is linked without the export where that module lacks the name, as under plain `bun test` with those flags.
    pub typescript_drops_absent_exports: bool,
    /// `bun test --aot`: the build compiles its entry points and nothing else. What they import is in another image, which the process that runs them holds too.
    pub imports_are_in_other_images: bool,
    /// `bun test --aot`: a realm that runs the program runs other programs too, each built alone.
    pub shares_realms: bool,
    /// `bun test --aot --isolate` or `--parallel`: the runner gives each test file a fresh realm of one VM, and each realm runs an instance of the program of its own.
    /// `Bun.s3` and the environments of native addons are carried from one realm to the next, so a later file may call a function of an earlier one.
    pub runs_in_several_realms: bool,
    pub images_below: ImagesBelow,
    pub replaced_by_tests: ReplacedByTests,
    /// Only a build of Bun with Fuzzilli looks at it.
    pub preload: Option<Preload>,
    pub thread_count: Option<NonZeroU32>,
    /// Whose built-ins and code of the run time the program gets. `None`: those of the platform that the compiler runs on. No flag sets it.
    pub platform: Option<TargetPlatform>,
    /// What `--define` or bunfig.toml names, without what the build defines by itself. `bun run` replaces these too.
    pub user_defined_names: Vec<Box<[u8]>>,
    pub option_words: Vec<Box<[u8]>>,
}

/// How whoever hands a value over gets at the place for it.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum PlaceIsReachedBy {
    /// `module` exports the function or the class under the name `export`. What `module.exports = ..` sets goes by `default`.
    Export,
    /// A property of the name `export` holds the function, whichever object has it: `pool.start(entry)`. There is no `module`.
    Member,
    /// `new Worker(this.options.filename)`: the value is read out of a property of the name `export`, whichever object has it.
    /// Whoever stores there hands it over. There is no `module` and no `index`.
    Property,
}

/// `export function spawn(entry) { return new Worker(entry); }`: whoever calls `spawn` starts a Worker from what it passes.
/// `export class Pool { constructor(entry) { this.worker = new Worker(entry); } }`: so does whoever says `new Pool(..)`.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct ParameterThatStartsWorkers {
    /// The path of a file that exports the function: the one that declares it, or one that exports it again.
    pub module: Vec<u8>,
    /// The name that `module` exports it under.
    pub export: Vec<u8>,
    pub reached_by: PlaceIsReachedBy,
    /// The place of the parameter among the parameters.
    pub index: u32,
    /// The Worker may also get an options object.
    pub has_options: bool,
    /// `new Worker(text, { eval: true })`: the parameter is the code itself.
    pub is_evaluated: bool,
}

/// `bun test --aot`: what files of the run replace which this build does not see. What the build sees it finds itself.
/// A module is the path of its file, or the specifier of a module of Bun.
#[derive(Clone, Default, PartialEq, Eq, Debug)]
pub struct ReplacedByTests {
    /// Nothing of this is replaced. It goes the other way, from a program to those that are built above it, which do not read its files:
    /// what it does with a value that they hand it. Ascending.
    pub parameters_that_start_workers: Vec<ParameterThatStartsWorkers>,
    /// Members of built-in objects, by their numbers in the table of this Bun: `spyOn(String.prototype, "indexOf")`.
    pub builtins: Vec<u32>,
    /// A built-in object that takes no new names, by its number, and a name that it gets: `Object.prototype.polluted = 1`.
    pub names_added_to_builtins: Vec<(u32, Vec<u8>)>,
    /// `spyOn(namespace, "name")`: the module and the name.
    pub exports: Vec<(Vec<u8>, Vec<u8>)>,
    /// Any export of them: `mock.module("./a", factory)`, and a module whose object goes where nobody follows it.
    pub modules: Vec<Vec<u8>>,
    /// Such a module that no file spells. It goes the other way too, as `stores_loader_functions` does: an installed package of test helpers may hold the call.
    pub any_module: bool,
    /// Their objects go where nobody follows them: `use(namespace)`, `export * as namespace`. A spy that takes an object from somewhere may get one.
    pub handed_on_modules: Vec<Vec<u8>>,
    /// Such a module that no file spells.
    pub hands_on_any_module: bool,
    /// `spyOn(object, "name")`, where the file does not say what `object` is: it may be the object of a module that some file hands on. The names.
    pub names_spied_on_unknown_objects: Vec<Vec<u8>>,
    /// Such a spy under a name that no file spells.
    pub spies_on_unknown_objects: bool,
    /// Such a spy beside a file that loads a module under a name that it does not spell and hands its object on: the spy may meet whatever that name finds.
    pub spy_may_meet_module_that_no_file_spells: bool,
    /// `delete require.cache[require.resolve("./a")]`: the files that load again.
    pub evicted_modules: Vec<Vec<u8>>,
    /// Such a file that no file spells. It goes the other way too, as `stores_loader_functions` does: import-fresh, decache and proxyquire are packages, and the path that
    /// they are handed may name a file of a program above theirs.
    pub evicts_any_module: bool,
    /// `try { require("./a") } catch {}`: a CommonJS file whose body throws is out of the table too, and the next `require()` runs it again.
    /// Which kind of file a path names shows in the build that holds the file.
    pub files_required_where_throws_are_caught: Vec<Vec<u8>>,
    /// Beside `require.cache["fs"] = { exports: fake }`, else empty: the files that a statement of theirs imports, those that an `import()` loads, and those that they require.
    /// `bun run` reads `require("fs")` as `require("node:fs")` in a CommonJS file that an import loads.
    pub files_imported_by_statements: Vec<Vec<u8>>,
    pub files_imported_by_calls: Vec<Vec<u8>>,
    pub files_required: Vec<Vec<u8>>,
    /// `import("./a?again")` loads the file once more, from disk. Nobody has read a file that is reached in no other way.
    pub names_file_with_query: bool,
    /// `Module._resolveFilename = f`, `Module.prototype.require = f`. It goes the other way too: the look through the test files reads no package, so the program that holds
    /// module-alias or require-in-the-middle says it to those that are built above it. From the store on every `require()` of theirs asks the function.
    pub stores_loader_functions: bool,
}

impl ReplacedByTests {
    /// For the builds of one run that are processes of their own. Numbers are little-endian, a text follows its length.
    pub fn to_bytes(&self) -> Vec<u8> {
        fn push_number(bytes: &mut Vec<u8>, number: usize) {
            bytes.extend_from_slice(&(number as u32).to_le_bytes());
        }
        fn push_text(bytes: &mut Vec<u8>, text: &[u8]) {
            push_number(bytes, text.len());
            bytes.extend_from_slice(text);
        }
        let mut bytes = vec![
            u8::from(self.any_module)
                | u8::from(self.spies_on_unknown_objects) << 1
                | u8::from(self.evicts_any_module) << 2
                | u8::from(self.spy_may_meet_module_that_no_file_spells) << 3
                | u8::from(self.hands_on_any_module) << 4
                | u8::from(self.names_file_with_query) << 5
                | u8::from(self.stores_loader_functions) << 6,
        ];
        push_number(&mut bytes, self.builtins.len());
        for &member in &self.builtins {
            push_number(&mut bytes, member as usize);
        }
        push_number(&mut bytes, self.names_added_to_builtins.len());
        for (holder, name) in &self.names_added_to_builtins {
            push_number(&mut bytes, *holder as usize);
            push_text(&mut bytes, name);
        }
        push_number(&mut bytes, self.exports.len());
        for (module, name) in &self.exports {
            push_text(&mut bytes, module);
            push_text(&mut bytes, name);
        }
        push_number(&mut bytes, self.modules.len());
        for module in &self.modules {
            push_text(&mut bytes, module);
        }
        for texts in [
            &self.evicted_modules,
            &self.handed_on_modules,
            &self.names_spied_on_unknown_objects,
            &self.files_imported_by_statements,
            &self.files_imported_by_calls,
            &self.files_required,
            &self.files_required_where_throws_are_caught,
        ] {
            push_number(&mut bytes, texts.len());
            for text in texts {
                push_text(&mut bytes, text);
            }
        }
        push_number(&mut bytes, self.parameters_that_start_workers.len());
        for parameter in &self.parameters_that_start_workers {
            push_text(&mut bytes, &parameter.module);
            push_text(&mut bytes, &parameter.export);
            push_number(&mut bytes, parameter.index as usize);
            bytes.push(
                u8::from(parameter.has_options)
                    | u8::from(parameter.is_evaluated) << 1
                    | (parameter.reached_by as u8) << 2,
            );
        }
        bytes
    }

    /// `None` for bytes that `to_bytes` did not write.
    pub fn from_bytes(mut bytes: &[u8]) -> Option<ReplacedByTests> {
        fn take_number(bytes: &mut &[u8]) -> Option<u32> {
            let (number, rest) = bytes.split_first_chunk::<4>()?;
            *bytes = rest;
            Some(u32::from_le_bytes(*number))
        }
        fn take_text(bytes: &mut &[u8]) -> Option<Vec<u8>> {
            let length = take_number(bytes)? as usize;
            let (text, rest) = bytes.split_at_checked(length)?;
            *bytes = rest;
            Some(text.to_vec())
        }
        fn take_list<T>(
            bytes: &mut &[u8],
            take: impl Fn(&mut &[u8]) -> Option<T>,
        ) -> Option<Vec<T>> {
            let count = take_number(bytes)?;
            (0..count).map(|_| take(bytes)).collect()
        }
        let (&answers, rest) = bytes.split_first()?;
        bytes = rest;
        let replaced = ReplacedByTests {
            any_module: answers & 1 != 0,
            spies_on_unknown_objects: answers & 2 != 0,
            evicts_any_module: answers & 4 != 0,
            spy_may_meet_module_that_no_file_spells: answers & 8 != 0,
            hands_on_any_module: answers & 16 != 0,
            names_file_with_query: answers & 32 != 0,
            stores_loader_functions: answers & 64 != 0,
            builtins: take_list(&mut bytes, take_number)?,
            names_added_to_builtins: take_list(&mut bytes, |bytes| {
                Some((take_number(bytes)?, take_text(bytes)?))
            })?,
            exports: take_list(&mut bytes, |bytes| {
                Some((take_text(bytes)?, take_text(bytes)?))
            })?,
            modules: take_list(&mut bytes, take_text)?,
            evicted_modules: take_list(&mut bytes, take_text)?,
            handed_on_modules: take_list(&mut bytes, take_text)?,
            names_spied_on_unknown_objects: take_list(&mut bytes, take_text)?,
            files_imported_by_statements: take_list(&mut bytes, take_text)?,
            files_imported_by_calls: take_list(&mut bytes, take_text)?,
            files_required: take_list(&mut bytes, take_text)?,
            files_required_where_throws_are_caught: take_list(&mut bytes, take_text)?,
            parameters_that_start_workers: take_list(&mut bytes, |bytes| {
                let (module, export) = (take_text(bytes)?, take_text(bytes)?);
                let index = take_number(bytes)?;
                let (&answers, rest) = bytes.split_first()?;
                *bytes = rest;
                Some(ParameterThatStartsWorkers {
                    module,
                    export,
                    reached_by: match answers >> 2 {
                        0 => PlaceIsReachedBy::Export,
                        1 => PlaceIsReachedBy::Member,
                        2 => PlaceIsReachedBy::Property,
                        _ => return None,
                    },
                    index,
                    has_options: answers & 1 != 0,
                    is_evaluated: answers & 2 != 0,
                })
            })?,
        };
        bytes.is_empty().then_some(replaced)
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum TargetPlatform {
    Darwin,
    Linux,
    Windows,
}

impl Default for AotOptions {
    fn default() -> AotOptions {
        AotOptions {
            heap: HeapSize::Standard,
            embeds_function_source: true,
            explain: ExplainSet::empty(),
            trim: TrimRequest::default(),
            reports_type_mismatches: false,
            erases_types: false,
            emits_symbols: false,
            omits_builtin_modules: false,
            separates_programs: false,
            obfuscates: false,
            code_generation_from_strings: CodeGenerationFromStrings::Allowed,
            omits_foreign_calls: false,
            admits_inspector: false,
            loads_code_from_disk: false,
            host_runs_files_from_disk: false,
            main_modules_beside_entry_points: Vec::new(),
            entry_points_only_imported_from_above: Vec::new(),
            library_runs_compiled_alone: false,
            holds_library_alone: false,
            reference_library_image: None,
            ir_output_path: None,
            writes_no_executable: false,
            build_report: None,
            runs_in_place: false,
            checks_only: false,
            runs_tests: false,
            has_globals_of_vitest: false,
            counts_executions: false,
            before_read: None,
            test_run_part_files: None,
            test_run_is_one_program: false,
            source_that_fits_in_memory: None,
            is_part_of_test_files: false,
            entry_points_run_again: false,
            typescript_drops_absent_exports: false,
            imports_are_in_other_images: false,
            shares_realms: false,
            runs_in_several_realms: false,
            images_below: ImagesBelow::default(),
            replaced_by_tests: ReplacedByTests::default(),
            preload: None,
            thread_count: None,
            platform: None,
            user_defined_names: Vec::new(),
            option_words: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_tests_replace_survives_its_bytes() {
        let replaced = ReplacedByTests {
            parameters_that_start_workers: vec![
                ParameterThatStartsWorkers {
                    module: b"/project/e.ts".to_vec(),
                    export: b"spawn".to_vec(),
                    reached_by: PlaceIsReachedBy::Export,
                    index: 2,
                    has_options: true,
                    is_evaluated: false,
                },
                ParameterThatStartsWorkers {
                    module: b"/project/f.ts".to_vec(),
                    export: b"default".to_vec(),
                    reached_by: PlaceIsReachedBy::Export,
                    index: 0,
                    has_options: false,
                    is_evaluated: true,
                },
                ParameterThatStartsWorkers {
                    module: Vec::new(),
                    export: b"start".to_vec(),
                    reached_by: PlaceIsReachedBy::Member,
                    index: 1,
                    has_options: false,
                    is_evaluated: false,
                },
                ParameterThatStartsWorkers {
                    module: Vec::new(),
                    export: b"filename".to_vec(),
                    reached_by: PlaceIsReachedBy::Property,
                    index: 0,
                    has_options: true,
                    is_evaluated: false,
                },
            ],
            builtins: vec![7, 70_000],
            names_added_to_builtins: vec![(3, b"polluted".to_vec()), (3, Vec::new())],
            exports: vec![(b"/project/a.ts".to_vec(), b"read".to_vec())],
            modules: vec![b"node:fs".to_vec(), b"/project/b.ts".to_vec()],
            any_module: true,
            spies_on_unknown_objects: true,
            evicted_modules: vec![b"/project/c.ts".to_vec()],
            files_imported_by_statements: vec![b"/project/e.cjs".to_vec()],
            files_imported_by_calls: vec![b"/project/f.cjs".to_vec(), b"/project/g.cjs".to_vec()],
            files_required: vec![b"/project/g.cjs".to_vec()],
            files_required_where_throws_are_caught: vec![b"/project/h.cjs".to_vec()],
            handed_on_modules: vec![b"/project/d.ts".to_vec()],
            hands_on_any_module: true,
            names_spied_on_unknown_objects: vec![b"read".to_vec(), b"write".to_vec()],
            evicts_any_module: true,
            names_file_with_query: true,
            stores_loader_functions: true,
            spy_may_meet_module_that_no_file_spells: true,
        };
        let bytes = replaced.to_bytes();
        assert_eq!(ReplacedByTests::from_bytes(&bytes), Some(replaced));
        assert_eq!(
            ReplacedByTests::from_bytes(&ReplacedByTests::default().to_bytes()),
            Some(ReplacedByTests::default())
        );
        assert_eq!(ReplacedByTests::from_bytes(&bytes[..bytes.len() - 1]), None);
        assert_eq!(
            ReplacedByTests::from_bytes(&[bytes, vec![0]].concat()),
            None
        );
        assert_eq!(ReplacedByTests::from_bytes(&[]), None);
    }

    const MEMBERS: [(ExplainSet, &str); 12] = [
        (ExplainSet::TEXT, "ExplainSet(TEXT)"),
        (ExplainSet::JSON, "ExplainSet(JSON)"),
        (ExplainSet::CHECKS, "ExplainSet(CHECKS)"),
        (ExplainSet::CHECKS_JSON, "ExplainSet(CHECKS_JSON)"),
        (ExplainSet::RUNTIME_USE, "ExplainSet(RUNTIME_USE)"),
        (ExplainSet::DECLINES, "ExplainSet(DECLINES)"),
        (ExplainSet::ALLOCATIONS, "ExplainSet(ALLOCATIONS)"),
        (
            ExplainSet::ONLY_UNKNOWN_CODE,
            "ExplainSet(ONLY_UNKNOWN_CODE)",
        ),
        (
            ExplainSet::ONLY_UNPROVEN_TYPE,
            "ExplainSet(ONLY_UNPROVEN_TYPE)",
        ),
        (ExplainSet::ONLY_MUTATION, "ExplainSet(ONLY_MUTATION)"),
        (ExplainSet::STATISTICS, "ExplainSet(STATISTICS)"),
        (ExplainSet::ONLY_LIMIT, "ExplainSet(ONLY_LIMIT)"),
    ];

    #[test]
    fn default_is_plain_compile() {
        let AotOptions {
            heap,
            embeds_function_source,
            explain,
            trim,
            reports_type_mismatches,
            erases_types,
            emits_symbols,
            omits_builtin_modules,
            separates_programs,
            obfuscates,
            code_generation_from_strings,
            omits_foreign_calls,
            admits_inspector,
            loads_code_from_disk,
            host_runs_files_from_disk,
            main_modules_beside_entry_points,
            entry_points_only_imported_from_above,
            library_runs_compiled_alone,
            holds_library_alone,
            reference_library_image,
            ir_output_path,
            writes_no_executable,
            build_report,
            runs_in_place,
            checks_only,
            runs_tests,
            has_globals_of_vitest,
            counts_executions,
            before_read,
            test_run_part_files,
            test_run_is_one_program,
            source_that_fits_in_memory,
            is_part_of_test_files,
            entry_points_run_again,
            typescript_drops_absent_exports,
            imports_are_in_other_images,
            shares_realms,
            runs_in_several_realms,
            images_below,
            replaced_by_tests,
            preload,
            thread_count,
            platform,
            user_defined_names,
            option_words,
        } = AotOptions::default();
        assert_eq!(platform, None);
        assert_eq!(heap, HeapSize::Standard);
        assert_eq!(heap, HeapSize::default());
        assert!(embeds_function_source);
        assert!(explain.is_empty());
        assert!(!trim.is_enabled());
        assert!(trim.allow.is_empty());
        assert!(!trim.logs);
        assert!(!reports_type_mismatches);
        assert!(!erases_types);
        assert!(!emits_symbols);
        assert!(!omits_builtin_modules);
        assert!(!separates_programs);
        assert!(!obfuscates);
        assert_eq!(
            code_generation_from_strings,
            CodeGenerationFromStrings::Allowed
        );
        assert!(!omits_foreign_calls);
        assert!(!admits_inspector);
        assert!(!loads_code_from_disk);
        assert!(!host_runs_files_from_disk);
        assert!(main_modules_beside_entry_points.is_empty());
        assert!(entry_points_only_imported_from_above.is_empty());
        assert!(!library_runs_compiled_alone);
        assert!(!holds_library_alone);
        assert!(reference_library_image.is_none());
        assert!(ir_output_path.is_none());
        assert!(!writes_no_executable);
        assert!(build_report.is_none());
        assert!(!runs_in_place);
        assert!(!checks_only);
        assert!(!runs_tests);
        assert!(!has_globals_of_vitest);
        assert!(!counts_executions);
        assert!(before_read.is_none());
        assert!(test_run_part_files.is_none());
        assert!(!test_run_is_one_program);
        assert!(source_that_fits_in_memory.is_none());
        assert!(!is_part_of_test_files);
        assert!(!entry_points_run_again);
        assert!(!typescript_drops_absent_exports);
        assert!(!imports_are_in_other_images);
        assert!(!shares_realms);
        assert!(!runs_in_several_realms);
        assert!(images_below.is_empty());
        assert_eq!(replaced_by_tests, ReplacedByTests::default());
        assert!(preload.is_none());
        assert!(thread_count.is_none());
        assert!(user_defined_names.is_empty());
        assert!(option_words.is_empty());
    }

    #[test]
    fn members_are_single_bits() {
        let mut seen = ExplainSet::empty();
        for (member, _) in MEMBERS {
            assert_eq!(member.bits().count_ones(), 1);
            assert!(!seen.intersects(member));
            seen.insert(member);
        }
        assert_eq!(seen.bits(), 0b1111_1111_1111);
    }

    #[test]
    fn report_details_ascend() {
        assert_eq!(ReportDetail::default(), ReportDetail::Summary);
        assert!(ReportDetail::Summary < ReportDetail::Functions);
        assert!(ReportDetail::Functions < ReportDetail::Sites);
    }
}
