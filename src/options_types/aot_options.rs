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
        const ALLOCATIONS = 1 << 5;
        const FORMS = 1 << 6;
        const STATISTICS = 1 << 7;
        const ONLY_UNKNOWN_CODE = 1 << 8;
        const ONLY_UNPROVEN_TYPE = 1 << 9;
    }
}

/// Called with a file's path, in the checker's format, right before the build reads the file, on the thread that reads it.
#[derive(Clone)]
pub struct ReadListener(pub Arc<dyn Fn(&[u8]) + Send + Sync>);

impl fmt::Debug for ReadListener {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ReadListener")
    }
}

/// For a process that builds many programs: it is called back right before a build looks at its entry points.
#[derive(Clone)]
pub struct Preload {
    /// An empty file beside the entry point.
    pub placeholder_entry_point: Box<[u8]>,
    /// Called on the thread that builds. The build reads its entry points after this returns.
    pub on_loaded: Arc<dyn Fn() + Send + Sync>,
    /// Set before `on_loaded` is called, so only the first build calls it.
    pub is_loaded: Arc<AtomicBool>,
}

impl fmt::Debug for Preload {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("Preload")
    }
}

#[derive(Clone, Debug)]
pub struct AotOptions {
    pub heap: HeapSize,
    pub embeds_function_source: bool,
    pub explain: ExplainSet,
    pub trim: TrimRequest,
    pub erases_types: bool,
    pub emits_symbols: bool,
    pub omits_builtin_modules: bool,
    pub obfuscates: bool,
    pub code_generation_from_strings: CodeGenerationFromStrings,
    pub omits_foreign_calls: bool,
    pub admits_inspector: bool,
    /// `--aot-allow-code-from-disk`: a path that is known only at run time may name a file with code that the build has not seen. Bun interprets it.
    pub loads_code_from_disk: bool,
    /// `--aot-testing=IsolatedCodeFromDisk`, with `loads_code_from_disk`: such a file finds no file of the program. What it names lies on disk.
    pub isolates_code_from_disk: bool,
    /// `bun test --aot` without `--aot-allow-code-from-disk`: `loads_code_from_disk` holds for the files of the tests. A file that an executable would hold too finds what it finds there.
    pub only_tests_load_code_from_disk: bool,
    pub ir_output_path: Option<Box<[u8]>>,
    /// `--aot-testing=NoExecutable`: the build runs as always and writes no executable.
    pub writes_no_executable: bool,
    /// `--aot-testing=DiscardsFirstVisits`: the first visit of every file is thrown away, as one is that ends with an invalid commit, and the file is visited again. The program is the same.
    pub discards_first_visits: bool,
    pub runs_in_place: bool,
    pub missing_tsconfig_override: Option<Box<[u8]>>,
    pub checks_only: bool,
    /// `bun check --aot`: the program's own TypeScript is checked file by file, as `bun check` checks it.
    pub looks_for_type_errors: bool,
    /// `bun test --aot`: `@jest/globals` and `vitest` are `bun:test`, as in `bun test`.
    pub runs_tests: bool,
    /// `bun test --globals=vitest`.
    pub has_globals_of_vitest: bool,
    /// `bun test --aot --coverage`: the files that the report is about count how often their parts run.
    pub counts_executions: bool,
    /// `--watch` starts to watch each file here.
    pub before_read: Option<ReadListener>,
    /// `bun test --aot --rerun-each`: the runner loads each test file several times in one realm, and what the file imports stays as it is.
    pub entry_points_run_again: bool,
    /// `bun test --aot --isolate` or `--parallel`: a TypeScript module that exports a name of another module is linked without the export where that module lacks the name, as under plain `bun test` with those flags.
    pub typescript_drops_absent_exports: bool,
    /// `bun test --aot --isolate` or `--parallel`: the runner gives each test file a fresh realm of one VM, and each realm runs an instance of the program of its own.
    /// `Bun.s3` and the environments of native addons are carried from one realm to the next, so a later file may call a function of an earlier one.
    pub runs_in_several_realms: bool,
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

/// `bun test --aot`: what the runner tells the build, because no file of the run spells it. The build itself finds what the files replace.
#[derive(Clone, Default, PartialEq, Eq, Debug)]
pub struct ReplacedByTests {
    /// Members of built-in objects, by their numbers in the table of this Bun: the globals of a window, which the runner defines for a test file that asks for a DOM, and under `--isolate=modules` `process.argv` and `Bun.argv`, which it sets again between test files.
    pub builtins: Vec<u32>,
    /// The test files, as the runner has found them.
    pub test_files: Vec<Vec<u8>>,
    /// The file of each `--preload`. One that nothing resolves: as it is written.
    pub preloads: Vec<Vec<u8>>,
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
            erases_types: false,
            emits_symbols: false,
            omits_builtin_modules: false,
            obfuscates: false,
            code_generation_from_strings: CodeGenerationFromStrings::Allowed,
            omits_foreign_calls: false,
            admits_inspector: false,
            loads_code_from_disk: false,
            isolates_code_from_disk: false,
            only_tests_load_code_from_disk: false,
            ir_output_path: None,
            writes_no_executable: false,
            discards_first_visits: false,
            runs_in_place: false,
            missing_tsconfig_override: None,
            checks_only: false,
            looks_for_type_errors: false,
            runs_tests: false,
            has_globals_of_vitest: false,
            counts_executions: false,
            before_read: None,
            entry_points_run_again: false,
            typescript_drops_absent_exports: false,
            runs_in_several_realms: false,
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

    const MEMBERS: [ExplainSet; 10] = [
        ExplainSet::TEXT,
        ExplainSet::JSON,
        ExplainSet::CHECKS,
        ExplainSet::CHECKS_JSON,
        ExplainSet::RUNTIME_USE,
        ExplainSet::ALLOCATIONS,
        ExplainSet::FORMS,
        ExplainSet::STATISTICS,
        ExplainSet::ONLY_UNKNOWN_CODE,
        ExplainSet::ONLY_UNPROVEN_TYPE,
    ];

    #[test]
    fn default_is_plain_compile() {
        let AotOptions {
            heap,
            embeds_function_source,
            explain,
            trim,
            erases_types,
            emits_symbols,
            omits_builtin_modules,
            obfuscates,
            code_generation_from_strings,
            omits_foreign_calls,
            admits_inspector,
            loads_code_from_disk,
            isolates_code_from_disk,
            only_tests_load_code_from_disk,
            ir_output_path,
            writes_no_executable,
            discards_first_visits,
            runs_in_place,
            missing_tsconfig_override,
            checks_only,
            looks_for_type_errors,
            runs_tests,
            has_globals_of_vitest,
            counts_executions,
            before_read,
            entry_points_run_again,
            typescript_drops_absent_exports,
            runs_in_several_realms,
            replaced_by_tests,
            preload,
            thread_count,
            platform,
            user_defined_names,
            option_words,
        } = AotOptions::default();
        let ReplacedByTests {
            builtins,
            test_files,
            preloads,
        } = replaced_by_tests;
        assert_eq!(platform, None);
        assert_eq!(heap, HeapSize::Standard);
        assert_eq!(heap, HeapSize::default());
        assert!(embeds_function_source);
        assert!(explain.is_empty());
        assert!(!trim.is_enabled());
        assert!(trim.allow.is_empty());
        assert!(!trim.logs);
        assert!(!erases_types);
        assert!(!emits_symbols);
        assert!(!omits_builtin_modules);
        assert!(!obfuscates);
        assert_eq!(
            code_generation_from_strings,
            CodeGenerationFromStrings::Allowed
        );
        assert!(!omits_foreign_calls);
        assert!(!admits_inspector);
        assert!(!loads_code_from_disk);
        assert!(!isolates_code_from_disk);
        assert!(!only_tests_load_code_from_disk);
        assert!(ir_output_path.is_none());
        assert!(!writes_no_executable);
        assert!(!discards_first_visits);
        assert!(!runs_in_place);
        assert!(missing_tsconfig_override.is_none());
        assert!(!checks_only);
        assert!(!looks_for_type_errors);
        assert!(!runs_tests);
        assert!(!has_globals_of_vitest);
        assert!(!counts_executions);
        assert!(before_read.is_none());
        assert!(!entry_points_run_again);
        assert!(!typescript_drops_absent_exports);
        assert!(!runs_in_several_realms);
        assert!(builtins.is_empty());
        assert!(test_files.is_empty());
        assert!(preloads.is_empty());
        assert!(preload.is_none());
        assert!(thread_count.is_none());
        assert!(user_defined_names.is_empty());
        assert!(option_words.is_empty());
    }

    #[test]
    fn members_are_single_bits() {
        let mut seen = ExplainSet::empty();
        for member in MEMBERS {
            assert_eq!(member.bits().count_ones(), 1);
            assert!(!seen.intersects(member));
            seen.insert(member);
        }
        assert_eq!(seen, ExplainSet::all());
        assert_eq!(seen.bits(), 0b11_1111_1111);
    }
}
