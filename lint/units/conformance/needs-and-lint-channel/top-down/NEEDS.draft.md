# NEEDS of the unit "conformance" (draft from research, top-down pass, second edition)

Nothing below is granted yet, and nothing was implemented on the side of another unit.
The ids (CH, RP, LB, LC, VN, CK, CI, MQ) replace the ids N1 to N6 of the earlier findings, which named
different things in different findings. The bottom-up draft (`../bottom-up/needs-draft.txt`) uses the same ids.

State when this was written (2026-09-30, 01:00 UTC): the four unit worktrees are at e3566be889 and clean. No
unit has an `API.md`, a `NEEDS.md` or a `LOG.md`. No binary on the machine has `--lint`: the installed bun
1.4.3 and the debug build of the cli worktree (1.4.3-debug+e3566be88) both RUN the operand of
`bun --lint x.ts`. The cli unit has research prototypes of C1 and C2 in its notes
(`units/cli/c1-seam-arbitration-topdown/typecheck/lint_command_typecheck.rs`,
`units/cli/c2-seam-arbitration/lint-prototype.patch`); nothing of them is in its worktree.

Every number was measured on Linux x64 on the pinned clones (typescript-go 89d5d5b, TypeScript 5848bc5) with
`needs-and-lint-channel/top-down/probes/run.sh` and the commands of `HOWTO.txt` beside it. Nothing was
measured on Windows or on macOS: both Windows machines answered "not available in this session" again, and
there is no macOS machine.

How to read an entry. To: the owner of the file. Ask: the exact thing. Unlocks: how many of the 12,797 run
instances depend on it (E: the oracle has errors, 7,027. C: the oracle has none, 5,770). The sets of different
entries overlap. Until then: what the runner does without it.

What changed since the first edition of this draft: the channel. The first edition chose the batch form
(proposal c). This edition chooses the two variables (proposal d), as the bottom-up draft does. The facts that
decided it were found in this pass and are listed under "Why" below.

## 1. The channel between `bun --lint` and the runner

### The decision: two internal variables beside the operand form (proposal d)

    BUN_INTERNAL_LINT_OPTIONS   in:  the options of the run, as JSON                         (CH-3)
    BUN_INTERNAL_LINT_REPORT    out: the path of a file that gets the diagnostics of the run
                                     with what the plain format drops, as JSON               (CH-2)

The operands stay the unit files. stderr stays the plain format. The exit code stays 0, 2 or 1. stdout stays
empty. One process checks one program. This is the default check that `conformance.md` T2.4 specifies, with
two additions.

It is NOT on the path of K5. `typecheck.md` K5 plugs the checker into the runner "through the test importer":
that check is a function that the typecheck unit hands to the runner (CH-4). Options, span length, related
information and the stand-in log are fields of its input and output. The channel is what the DEFAULT check
needs, and its list stays empty until Bun's own parser, the lowering and the checker are wired together in
the binary. No milestone of a unit does that wiring (CH-5).

Why this one and not the three others:

| | operands are source files (`cli.md` C1.3) | diagnostics on stderr, exit code 0, 2, 1 (`cli.md` C2.2, C1.3; `conformance.md` T2.4) | programs per process | variables | code in the binary that only a test uses |
|---|---|---|---|---|---|
| (a) `BUN_INTERNAL_LINT_COMPILER_OPTIONS`, `_DIAGNOSTICS`, `_ROOT`, and `error TS-1` lines | yes | yes | 1 | 3 | a reader, a writer, a root |
| (b) one request file, `BUN_INTERNAL_LINT_REQUEST` | yes | yes | 1 | 1 | a reader, a writer |
| (c) `BUN_INTERNAL_LINT_CONFORMANCE=1`, manifest operand, JSON lines on stdout | no | no | up to 256 | 1 | a second driver: manifest, loop over programs, state given back between programs, a report protocol |
| (d) `BUN_INTERNAL_LINT_OPTIONS`, `BUN_INTERNAL_LINT_REPORT` | yes | yes | 1 | 2 | a reader, a writer |

1. The repository's review rules decide for the smallest hook. `REVIEW.md:15`: "Never add production code
   solely to make a test writable — use `bun:internal-for-testing` or externally observable behavior." All
   four proposals add such code. (c) adds a second driver. (d) adds a reader and a writer and leaves what a
   user can observe as it is. The tree has variables of exactly this kind, with a gate: a variable that names
   a file which the binary writes for a test (`BUN_BYTECODE_DIGEST_OUT`, `BUN_BYTECODE_ORDER_NAMES_OUT`,
   `BUN_BYTECODE_ORDER_OUT`: `src/bun_core/env_var.rs:45-50`, read at `src/jsc/BytecodeOrderRecorder.rs:67`,
   used by `test/bundler/bun-build-compile.test.ts:257`), and the gate "where `bun:internal-for-testing` is":
   a debug build, or `BUN_GARBAGE_COLLECTOR_LEVEL` and `BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING` set
   (`src/bundler/bytecode_order.rs:63-71`; `test/harness.ts:78` and `:85` set both). No notes file of any
   unit cited this rule before. It is also a question for the maintainers: MQ-1.
2. It is the check of `conformance.md` T2.4 ("spawns `bunExe()` with `--lint` ... and the unit files as
   operands, and parses the plain format ... from stderr"). With (c) every pass would go through a form that
   the goal file does not describe, and the operand form would only serve the probe.
3. cli can grant the report half alone and soon. The diagnostic that its C2 prototype plans
   (`units/cli/c2-seam-arbitration/lint-prototype.patch`, `src/lint/diagnostic.rs`: `file`, `start`,
   `length`, `category`, `code`, `text`, `chain`, `related`) has every field of the report. The options half
   needs `CompilerOptions` of typecheck. With (d) each half is granted and detected by itself.
4. The conformance run then goes through the path that a user's run takes (operands, current directory,
   stderr, exit code), and the report is checked against stderr in every run.
5. (a): `error TS-1` is the code of an ad hoc message of the reference
   (`internal/diagnostics/diagnostics.go:152-159`, used by its harness at
   `internal/testutil/harnessutil/harnessutil.go:698-699` and rejected at
   `internal/testutil/tsbaseline/error_baseline.go:44-48`), so a stand-in could not be told from a diagnostic
   of the reference. `_ROOT` is not needed for names: the runner maps real names to virtual names itself.
6. (b) carries the same two payloads in one file. It was not chosen because the two halves have different
   owners and dates, and because it adds one file to write for each instance. If the maintainers want one
   variable, the payloads of CH-2 and CH-3 move into the request file unchanged.
7. What no proposal avoids: where the product collects diagnostics as the command line of the reference
   does (it stops after a syntax error), the binary has to collect as the harness does when it is asked
   (CH-3 point 3), and it must not look for a configuration file then (CH-1 point 8). That is code for the
   test in all four.

What (d) costs, measured. This is its weak side and the reason why the first edition chose (c).

- One process for each instance. A process start: median 18 ms, 42 ms to 67 ms of wall time for each instance
  with the release build on this loaded machine (load average 200 to 650), 211 ms median with the debug build.
  The bottom-up pass measured 24 ms each with 16 at a time (release) and 57 ms each with 8 at a time (debug).
- The libraries are read again by each process. Measured with a real checker, the command line of
  typescript-go built from source (`/tmp/e2e/k4real min.ts --noEmit --skipDefaultLibCheck
  --noErrorTruncation --target es2015`, 20 files): 125 ms of processor time for each process; with
  `--lib es5` (4 files): 31 ms. So three quarters of a process is the default libraries. Today's parser of
  Bun, which drops the types, reads the 15 library files that hold text (2,669,841 bytes) in 6 ms (release)
  and in 290 ms to 300 ms (debug).
- The reference does not pay this. Its harness runs all 12,797 instances in ONE process in 60 s on this
  machine (`/tmp/k4drv/k5/setup3.log`, the run of the typecheck research), because it keeps every parsed file
  in a cache for the whole process (`harnessutil.go:493-530`, `sourceFileCache`).
- A full sweep through (d): 12,797 processes. With a release build about 27 minutes of processor time
  (125 ms each), a few minutes of wall time with 8 to 16 at a time. With a debug build at least two hours of
  processor time before any check (start and parse of the libraries alone). A sweep belongs to a release
  build.
- `conformance.test.ts` (10 s in a release build): about 600 to 1,300 listed instances on 8 to 16 cores at
  125 ms each. In the debug and ASAN lanes (10 to 100 times slower) a list of more than a few dozen names
  needs a fixed sample. That list is empty until the binary checks.
- (c) removes the starts. It removes the library loads only if the checker crate shares parsed and bound
  library files between the programs of one process, which no goal file asks for. The payloads of CH-2 and
  CH-3 do not depend on the transport: a batch form can carry them later without a change to D or to
  `compilerOptions`. What would justify it then: a list of the default check with thousands of names that
  has to run in full in the debug lanes, together with shared libraries in the checker crate.

The entries CH-1 to CH-3 are the binary side. CH-4 is the K5 side. CH-5 and CH-6 are what no unit of this
work owns.

### CH-1. The operand form: what `cli.md` C2 leaves open

To: cli (`src/runtime/cli/lint_command.rs`, `src/lint/`).

Ask. For `bun --lint <files>` when stdout and stderr are no terminal. The points marked (kept) are what the
C2 prototype in cli's notes already does: the ask is to keep them.

1. stdout stays empty.
2. stderr holds diagnostics and nothing else. Each line ends with LF. No empty line (the C1 plan prints one
   between two files), no summary, no code frame, no colour, and a text holds no line break (kept: the
   prototype writes a space for one).

       <path>(<line>,<column>): <category> <code>: <text>      a diagnostic in a file
       <category> <code>: <text>                                a diagnostic without a file
       <two spaces per level><text>                             a line of the message chain, level 1 and up

   Line and column are 1-based and the column counts UTF-16 code units. The category is one of `error`,
   `warning`, `suggestion`, `message`. The path is relative to the current directory with forward slashes on
   every platform (kept), or absolute. Reference: `internal/diagnosticwriter/diagnosticwriter.go:555-566`
   (the head), `:342-360` (the chain, in pre-order), `internal/diagnostics/diagnostics.go:29-41` (the names).
3. The plain form is chosen by "stderr is no terminal" alone: `bun_core::output::is_stderr_tty()`
   (`src/bun_core/output.rs:841`), not `enable_ansi_colors_stderr()` (`:2257`), which `FORCE_COLOR` turns
   on for a pipe and against `NO_COLOR` (`:398-438`). (The runner removes `FORCE_COLOR` and sets
   `NO_COLOR=1`, as `bunEnv` does.)
4. The code is `TS` and a number only for a diagnostic that typescript-go has under that number, with its
   text. Every other code is a name that matches `[A-Za-z@][A-Za-z0-9@/_-]*` and is not `TS` and digits
   (kept: the prototype has `syntax`, `internal-error`, `cannot-read-file`, `unsupported-extension` and the
   names of the rules; no line without a code is left). cli's `API.md` lists the names that are NOT rules:
   the runner leaves a diagnostic of a rule out of the comparison and counts it (15 case files have a
   `debugger` statement, and a rough search finds an empty destructuring pattern in more than a hundred),
   and any other name fails the instance.
5. Exit code 0 when no diagnostic of category `error` was printed, 2 when one or more were, 1 for a refusal
   with a text on stderr. Any other exit code and any signal is read as a crash (a panic ends with SIGABRT on
   POSIX and with exit code 3 on Windows: `src/crash_handler/lib.rs:2927-2992`).
6. The operands of one run are the roots of ONE program, in the order given, as for `tsc a.ts b.ts`.
   1,562 run instances have more than one root.
7. Order and duplicates as the reference has them (kept: the prototype ports both): sorted with
   `ast.CompareDiagnostics` (`internal/ast/diagnostic.go:458-503`: path, start, END of the span, code,
   category, source, message, chain, related information), then `compactAndMergeRelatedInfos`
   (`internal/compiler/program.go:1605-1634`). `cli.md` C2.2 says "file, then position, then code": the end
   comes before the code. Of the 7,027 baselines of the oracle 474 hold two diagnostics at one start, in 105
   their ends differ, and in 37 the order by code is the reverse of the order by end (first:
   `compiler/TransportStream.ts`, `compiler/arithmeticOnInvalidTypes.ts`).
8. Configuration files. The reference refuses operands beside a configuration file: with file names on the
   command line it looks for a `tsconfig.json` in the current directory AND in every directory above it, and
   when it finds one it prints TS5112 and checks nothing (`internal/execute/tsc.go:180-188`, `:269-281`);
   `ignoreConfig` switches that off (`internal/tsoptions/declscompiler.go:319`). If `bun --lint` follows
   that, a conformance run needs the same way out: a run with `BUN_INTERNAL_LINT_OPTIONS` set searches and
   loads no configuration file (CH-3 point 1). Without that variable the runner can only keep its scratch
   directory where no directory above has a `tsconfig.json`, `jsconfig.json`, `package.json` or
   `bunfig.toml` (the temporary directory of the system), and 73 run instances bring a `tsconfig.json` of
   their own and 504 a `package.json`; 19 of the 493 such units of the cases are no strict JSON. Whatever
   the run reads, stderr holds only lines of point 2.
9. A run whose check reached a stand-in, or recorded an internal diagnostic, says so on stderr with one or
   more lines that have a name as their code (`internal-error` exists in the prototype; one more name for
   stand-ins), and exits with 2. A check that was not complete never looks like a clean run. (typecheck
   gives the data: CH-3 point 4.)

Unlocks. The probe of the default check: with it the runner can tell a linter from a binary that runs its
operand. By itself it lets no instance be listed: all 12,797 run instances get options from the harness, and
12,790 have options of their own (12,786 set a declared compiler option by a directive, 4 more have a
configuration file). The other 7 are all C.

Until then. The probe refuses the binary, no instance is handed to it, and both lists of the default check
stay empty. The probe has three steps, one process each: (1) a file that would write a marker if it ran: the
marker must not exist; (2) the same with `BUN_INTERNAL_LINT_REPORT` and a syntax error: the report exists and
holds what stderr shows; (3) `BUN_INTERNAL_LINT_OPTIONS` with an option name that does not exist: exit code
1 and the name on stderr. Step 1 decides "a linter", step 2 the level "baseline" or "plain", step 3 "options
are read" or "unsupported: options not applied".

### CH-2. The report file

To: cli (`lint_command.rs`, `src/lint/`).

Ask.

1. `BUN_INTERNAL_LINT_REPORT`, read in `lint_command.rs` when a lint run starts, after the refusals of C1.4,
   behind the gate of `src/bundler/bytecode_order.rs:63-71` (the runner sets both variables of that gate in
   every spawn). Two ways to read it. With no edit outside cli's files:
   `bun_core::getenv_z(bun_core::zstr!("BUN_INTERNAL_LINT_REPORT"))`, as
   `src/runtime/cli/test/ChangedFilesFilter.rs:339` and the planned gate of C1.2 do (`clippy.toml:16-17`
   bans `std::env::var` only). Or declared, which needs a line in a file that no unit owns (RP-5):

       new!(pub BUN_INTERNAL_LINT_REPORT: string, "BUN_INTERNAL_LINT_REPORT", {});

   after `src/bun_core/env_var.rs:181`, read with `.get_not_empty()`.
2. The value is an absolute path. When the run ends with exit code 0 or 2 the binary writes ONE JSON object
   there (UTF-8, the file created or truncated) and then exits. With exit code 1 no file is written. stdout,
   stderr and the exit code are the same as without the variable.
   `bun_core::fmt::js_printer::write_json_string` (`src/bun_core/fmt.rs:42`) quotes a string; no new
   dependency.
3. The object:

       { "checked": true,
         "options": { ... },
         "diagnostics": [ D, ... ],
         "rules": [ R, ... ],
         "standIns": [ "name", ... ],
         "internal": [ "text", ... ] }

       D = { "category": "error" | "warning" | "suggestion" | "message",
             "code": 2322,
             "messageText": "...",
             "next": [ { "messageText": "...", "next": [...] } ],
             "location": { "file": "/tmp/x/0/.src/a.ts", "start": 6, "length": 1, "line": 1, "character": 7 },
             "relatedInformation": [ { "code": 2728, "messageText": "...", "next": [...], "location": {...} } ] }
       R = { "rule": "no-debugger", "category": "...", "messageText": "...", "location": {...} }

   - `checked`: true when the binder and the checker ran over the whole program. false when the run only
     parsed, or stopped before the check. An instance is listed only with true.
   - `options`: the value of `BUN_INTERNAL_LINT_OPTIONS` as the binary read it; absent when that variable was
     not set. The runner compares it with what it sent.
   - `diagnostics`: every diagnostic with a `TS` code, in the order of CH-1 point 7. `rules`: the diagnostics
     of lint rules. `internal`: the internal diagnostics of the run (ported panics and asserts); any entry
     fails the instance. `standIns`: the names of the stand-in log, each once, in the order of the first
     reach; any entry makes the instance "provisional".
   - `next` is absent or empty without a chain. `location` is absent for a diagnostic without a file.
     `relatedInformation` is always there, empty when there is none.
   - `file` is the real absolute path of a file of the instance, or a default library file: then only its
     last component (`lib.<name>.d.ts`) is read.
   - `start` and `length` count UTF-8 bytes from the first byte of the file; the runner writes every unit as
     UTF-8 without a byte order mark. `line` and `character` are 1-based, the character in UTF-16 code
     units. Both pairs are given and have to agree, and each line of stderr has to be in the report.
   - A member that is not named here makes the report unreadable.

Unlocks. Every listing through the binary. Of the 7,027 E baselines 6,865 need the span length and 1,024 the
related information (6,870 need one of the two), and 14 are in the pretty form, which needs the spans too.
The plain format alone rebuilds 143.

Until then. A run without a report has the level "plain" and is never listed. On request the sweep compares
the first section of the baseline and reports that count apart.

### CH-3. The options, and what the checker crate gives

To: typecheck (`src/typecheck/`), then cli (`lint_command.rs` hands over).

Ask.

1. `BUN_INTERNAL_LINT_OPTIONS`, read as in CH-2 point 1. The value is a JSON object, read with
   `bun_parsers::json::parse_utf8` (`src/parsers/json.rs:308`; `bun_runtime` depends on that crate):

       { "compilerOptions": { "noErrorTruncation": true, "newLine": "crlf", "skipDefaultLibCheck": true,
                              "target": "es2015", "strict": false, "lib": ["es2015", "dom"] },
         "libDirectory": "/repo/test/cli/lint/conformance/corpus/tsgo/internal/bundled/libs" }

   - `compilerOptions` has the form of `"compilerOptions"` in a `tsconfig.json`: declared names; booleans,
     numbers, strings, lists of strings; a value of an enumeration is its name in lower case; a file name is
     absolute and real. The runner makes each value from the directive as the harness does
     (`getOptionValue`, `harnessutil.go:443-486`); the binary turns the name of an enumeration and of a
     library into its value as tsoptions does for a `tsconfig.json` (`convertJsonOption`,
     `internal/tsoptions/tsconfigparsing.go:457`; `EnumMap`, `commandlineoption.go:86`). It is the final
     set: the runner has merged what the harness sets (`harnessutil.go:98-104`: `newLine` CRLF,
     `skipDefaultLibCheck` true, `noErrorTruncation` true) with the directives of the variation. Four names
     are not declared options of tsoptions and come from the harness (`harnessutil.go:319-339`):
     `allowNonTsExtensions`, `noErrorTruncation`, `suppressOutputPathCheck`, `noCheck`. The longest
     directive text of one case is 424 bytes, far below the 32,767 characters that Windows allows for one
     variable.
   - `libDirectory` is optional and is read only until the libraries are part of the binary (LB-2).
   - With the variable set the run is a harness run: no configuration file is searched or loaded (CH-1
     point 8), and the diagnostics are collected as the harness collects them (point 3 below). stderr and
     the report show that one set.
   - An unknown member, an option that the binary does not know and a value that it does not implement are a
     refusal: exit code 1, a text on stderr that names it, no report. Nothing is dropped in silence.
   - Names that are reserved for the program layer and that the runner sends only when cli's `API.md` says
     that they are implemented (until then such an instance is "unsupported" and no process starts):
     `"configFile": "<path>"` with `"defaultOptions": {...}` (73 instances; precedence as
     `harnessutil.go:89-109`: the options of the configuration file, then `defaultOptions` where no value is
     set, then `compilerOptions`; the roots stay the operands, `harnessutil.go:239`);
     `"root": "<path>"` (175 instances: a text of the instance names a file by an absolute path such as
     `/.lib/react.d.ts`, to be found below that real directory);
     `"useCaseSensitiveFileNames": false` (5 instances);
     `"captureSuggestions": true` (1 instance, `harnessutil.go:670-672`).
2. typecheck: an entry that sets one option from its declared name and a JSON value and says when it does
   not know the name: the port of `parseCompilerOptions(key string, value any, allOptions
   *core.CompilerOptions) (foundKey bool)` (`internal/tsoptions/parsinghelpers.go:279`; the harness calls
   its wrapper at `harnessutil.go:301`) on `core.CompilerOptions` (`internal/core/compileroptions.go`).
   The run instances use 90 of the 125 declared names (68 booleans, 11 strings, 6 enumerations, 4 lists,
   1 number). Instances whose options are all within the k names used most: `target` alone 5,012; with
   `strict` 6,780; with `module`, `declaration`, `noEmit`, `allowJs`, `checkJs`, `lib`, `outDir`,
   `noEmitHelpers`, `jsx`, `experimentalDecorators` (12 names) 10,461; 30 names 12,113; 90 names 12,797.
3. typecheck: the diagnostics of one program as the harness collects them, not as the command line does:
   configuration file, program, syntactic, semantic and global diagnostics together, the declaration
   diagnostics when the options emit declarations, the suggestions on request (`harnessutil.go:662-673`,
   again after the emit at `:676-689`; the typecheck research measured that the two counts are equal in all
   12,797 instances), then `compiler.SortAndDeduplicateDiagnostics` (`internal/compiler/program.go:1597-1634`).
   The command line collects program and global diagnostics only without a syntactic one
   (`program.go:1970`) and semantic ones only without any of those (`:1979`). On the programs that the
   typecheck research recorded from the reference, 691 run instances have a syntactic diagnostic; 406 of
   them lose another diagnostic at the first gate and 61 more at the second (count of the bottom-up pass,
   `../bottom-up/probes/harness_gate.py`). The options are applied as given and none is added: a run that
   is told `noEmit` reports less.
4. typecheck: per run, the stand-in log (names, each once, order of the first reach) and the internal log.
   The scratch of the typecheck research has both: `StandInLog::snapshot() -> Vec<(&'static str, u32)>` and
   `InternalLog::snapshot()`, `count()` (`units/typecheck/conventions-scratch/rust/internal.rs:28-81`).
5. typecheck: the default libraries are read from a directory that the caller names (K4 does that), with
   the names of `internal/bundled/libs`: LB-2.
6. `noErrorTruncation` is honoured: the harness sets it for every instance.

The shape of points 2 to 4, with names that are typecheck's to choose:

    pub enum OptionValue<'a> { Bool(bool), Number(f64), String(&'a [u8]), List(&'a [&'a [u8]]) }
    pub enum OptionSet { Done, UnknownName, WrongValue, NotImplemented }
    pub fn set_compiler_option(options: &mut CompilerOptions, name: &[u8], value: OptionValue<'_>) -> OptionSet;
    pub fn diagnostics_of_harness(program: &Program, capture_suggestions: bool) -> Vec<Diagnostic>;
    pub fn stand_ins(program: &Program) -> Vec<&'static str>;
    pub fn internal_faults(program: &Program) -> u32;

A `Diagnostic` there holds category, code, text, the chain as a tree, the file, start and length in bytes,
and the related information with the same fields: what `src/lint/diagnostic.rs` of cli's prototype holds.

Unlocks. All 12,797 run instances get options from the harness; 12,790 have options of their own. With one
root, no configuration file and files that can be written on Linux: 10,570 run instances (E 5,830, C 4,740).

Until then. A report without `options` for a run that was given options has the status "unsupported:
options not applied". The instance is in no list.

### CH-4. K5: the check of the test importer

To: typecheck (`test/cli/lint/typecheck/`).

Ask.

1. K5 implements the `Check` interface of `conformance/API.md` in TypeScript and hands it to the runner. It
   does not go through `bun --lint`. Its input has the texts of the units, the options in the form of CH-3,
   the links and the path of the default libraries; its output has the diagnostics in the shape D of CH-2
   and `standIns`. The runner has one reader for D, whatever carried it. An instance with a stand-in is
   "provisional" and is not listed.
2. The list of passing names of K5 is a file of typecheck's own directory. The functions of the runner take
   the path of the list and the check as arguments, and typecheck's own test file runs its list.
   `test/cli/lint/conformance/expectations.json` is the list of the default check; typecheck does not write
   it.
3. The tree dump carries the parse diagnostics of TypeScript: 525 to 533 E baselines hold a code that only
   the parser or the scanner reports, and 837 one that they report at all.
4. K5 says which instances it does not take ("already resolved inputs" only): their status is
   "unsupported", not "fail". 2,073 run instances have more than one file or a configuration file.
5. The check has to run with what a test lane of CI has: the built binary, `test/node_modules`
   (`typescript` 6.0.2) and committed files. The way that `REVIEW.md:15` names is `bun:internal-for-testing`
   (`src/js/internal-for-testing.ts:3-8`: a binding there, allowed in a debug build and in the tests'
   environment). It needs a line in that file and a host function outside `src/typecheck`: files that no
   unit owns, so it is an entry of typecheck's own NEEDS. The other way, a test target of the crate that
   answers on stdout (`units/typecheck/end-to-end-k4-k5/rust/tests_program.rs`), is not run by CI: the only
   cargo tests of CI are the Miri job for the crates listed in `scripts/rust-miri.ts:40-58`
   (`.github/workflows/rust-lints.yml:76-96`; `bun_typecheck` and `bun_lint` are not in the list, Miri
   interprets and isolates the file system) and `vendor/lolhtml` (`:98-123`). A list that is made through
   such a target is not guarded by CI.
6. The libraries that K5 dumps are the files of LB-2, not the files of `node_modules/typescript/lib`: 7 of
   the 108 differ, 3 of them in declarations.

Unlocks: the growth of a list during this work. With one file and no configuration file: 10,723 run
instances (E 5,905, C 4,818). Until then: both lists are empty and the sweep reports zero passes.

### CH-5. What no unit owns

To: no owner. `cli.md` puts "the type checker, tsconfig, project discovery" out of scope, `typecheck.md`
"the CLI, tsconfig parsing and module resolution from disk, lib embedding, declaration emit".

| piece | what needs it |
|---|---|
| the call from `lint_command.rs` into the checker: a program from the operands | every pass of the default check; K4 takes the node table and a directory "for now" |
| default libraries | 12,788 run instances (all but the 9 with `noLib`): LB-2 gives a directory until they are embedded |
| module resolution among the files of an instance | 2,073 run instances (E 1,121, C 952) have more than one file or a configuration file |
| parsing of a `tsconfig.json` | 73 run instances (72 in the vectors of the materialisation research, and `compiler/tsconfigExtendsPackageJsonExportsWildcard.ts`, which those vectors lack) |
| a root for absolute paths in the text of a file | 175 run instances (170 of them name `/.lib/`) |
| diagnostics of the program and the options | 147 run instances have a program diagnostic (TS5055 35, TS5110 25, TS6504 24, TS5102 23), 29 one of the include processor, 6 one of the configuration file (count of the typecheck research, `drivers-k4-k5/bottom-up/data/manifest-facts.txt`) |
| declaration diagnostics (the declaration transform) | 48 run instances |
| links | 19 run instances |
| file names without case | 5 run instances |
| suggestions | 1 run instance |

6,798 of the 7,027 E instances have only diagnostics of the parser, the binder and the checker (the same
count of the typecheck research).

Until then: the runner gives such an instance the status "unsupported" with the reason, before any process
starts where it can tell from the instance, else from the refusal of the binary. The instance is in no list.

### CH-6. The parser

To: parser (`src/js_parser/`), for P3.5. For information: both points are out of scope there.

- A syntax error of a lint parse that has a TypeScript code needs the text of the reference for that code,
  its arguments, and the start and the length that the parser of the reference gives. The code alone does
  not make a baseline equal. 525 to 533 E baselines hold a code that only the parser or the scanner of the
  reference reports (145 codes; 21 more are shared with another package). `parser.md` P3.5 keeps "stops at
  its first error": at most 141 to 144 baselines have exactly one diagnostic and can be reached that way.
- 990 run instances have a JavaScript unit (E 600, C 390) and need JSDoc.

Until then: such an instance fails through the binary. Through K5 it can pass, because the tree and its
parse diagnostics come from TypeScript.

## 2. Files of the repository that no unit owns

The vendoring that the repository has (`test/bundler/transpiler/react-compiler-fixtures`, 3,614 files, 270 of
them `.ts` or `.tsx`) changed one such file: `.prettierignore:3`. It has no entry in `test/tsconfig.json`,
`oxlint.json` or `CODEOWNERS`. The review rules ask for more (`.claude/docs/landing-prs.md:48`: "Vendored
code ... is read-only ... exclude vendored dirs from mechanical rewrites").

### RP-1. `test/tsconfig.json:39-47` (`"exclude"`)

To: integrator. Ask: the entries `"cli/lint/conformance/corpus"` and `"cli/lint/typecheck/fixtures"` (the
entry `"fixtures"` of line 40 matches only `test/fixtures`; the bottom-up pass proved that with tsc 6.0.2).

Why. `"include"` has `**/*.ts`, `**/*.tsx`, `**/*.mts`, `**/*.cts` (lines 26-38). The project has 2,978 such
files today; the corpus adds 12,444 cases, 4 files of `tests/lib` and, with LB-2, a second set of 108
default library files. Measured with tsc 6.0.2 on every 62nd case as one project: 181 files give 1,005 errors
in 156 files (TS2300, TS2451: the cases are scripts that declare the same names). With the 14 files of the
sample that have a syntax error, tsc prints only their 63 syntax errors and nothing else, so the corpus
hides every real error of `cd test && bun run typecheck`. No workflow runs that command (`lint.yml` checks
`scripts` and `src` only); it is a script of `package.json:60` and the project that an editor loads for
every test file.

Until then: nothing in CI changes. The unit cannot work around it, because the names are upstream's.

### RP-2. `oxlint.json:40-74` (`"ignorePatterns"`)

To: integrator. Ask: `"test/cli/lint/conformance/corpus"` and `"test/cli/lint/typecheck/fixtures"`.

Why. `bun run lint:fix` (`package.json:65`) is `oxlint --config oxlint.json --fix` with no path. Measured
with oxlint 1.70.0, the configuration and the plugin of this repository, on a copy of `tests/cases/compiler`
at the path of the corpus: `--fix` rewrote 106 of 6,537 files and 6,966 errors were left. CI runs `bun lint`,
which names `src/js` only (`package.json:64`).

Until then: `sync.sh --verify` shows a rewritten file.

### RP-3. `.github/CODEOWNERS:8`

To: integrator, with the consent of @Jarred-Sumner (line 2). Ask: after line 9 the paths without an owner:

    /test/cli/lint/conformance/corpus/
    /test/cli/lint/typecheck/fixtures/

Why. `*.d.ts @alii` matches 44 files of the corpus (40 cases, 4 files of `tests/lib`) and 108 more with
LB-2. Each makes @alii a requested reviewer of the pull request.

Until then: the request for review happens. Nothing fails.

### RP-4. `test/no-validate-leaksan.txt`

To: cli (keep the lint path free of leaks at exit), integrator for the stopgap. No line is asked for now.

Why it is here. For a test file that is not in that list the runner of CI sets
`ASAN_OPTIONS=...:detect_leaks=1:abort_on_error=1` and `LSAN_OPTIONS` (`scripts/runner.node.ts:2201-2206`),
in the ASAN lane and on a local run of that script. `test/harness.ts:95` keeps a value that is set, so every
`bun --lint` child runs under LeakSanitizer, and a leak aborts it: the runner reads a crash. Other commands
are rooted for this on purpose (`src/options_types/schema.rs:57`), and the bottom-up pass showed that the
scan does run on a path that parses and exits (`bun-debug build --no-bundle` with every root switched off
in `LSAN_OPTIONS` reports leaks; with the settings of CI it reports none today). With empty lists no instance is expected
to pass and the test stays green. When the first instance is listed, a leak is a defect of the lint path,
to be fixed there; the line `test/cli/lint/conformance.test.ts` in this file is the stopgap. The same holds
for cli's own `lint.test.ts` and for typecheck's test file of K5.

### RP-5. `src/bun_core/env_var.rs` and `test/harness.ts`

To: integrator (both files have no owner) and cli.

- `cli.md` C1.2 asks for "the existing feature-flag helper": that is a line in `pub mod feature_flag` of
  `src/bun_core/env_var.rs` (beside `BUN_FEATURE_FLAG_EXPERIMENTAL_BAKE`, line 277). No line for the lint
  flag exists and no unit owns the file. cli's plan reads the variable with `getenv_z` instead. The runner
  depends only on the name `BUN_FEATURE_FLAG_EXPERIMENTAL_LINT`.
- The two variables of CH-2 and CH-3 need two more lines there, or none with `getenv_z`.
- Neither variable is ever added to `bunEnv` (`test/harness.ts:66-90`, which starts with `...process.env`).
  The runner sets them for its own spawn and removes a value that it inherited, as it sets
  `BUN_FEATURE_FLAG_EXPERIMENTAL_LINT=1`, `BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1` and
  `BUN_GARBAGE_COLLECTOR_LEVEL`, and removes `BUN_OPTIONS` and `FORCE_COLOR`.

### RP-6. What the corpus does to the repository

To: integrator. For information, no file to change.

- Size, measured now with the sync prototype (`corpus-layout-and-sync/top-down/prototype/validate.sh`):
  22,186 files, 32,485,872 bytes; `git bundle` of the commit 7,737,689 bytes; a fresh clone packs it to
  7.97 MiB. That is below the 40 MB of `conformance.md` T1.4, so this file needs no entry with smaller
  alternatives. The 108 library files of LB-2 add 3,785,075 bytes (559 KB as one gzip archive). The
  repository tracks 19,932 files today.
- `corpus/ts`: 21,507 files (12,445 files of the two case directories, 4 of `tests/lib`, 9,056 baselines of
  TypeScript, 2 licence files). `corpus/tsgo`: 678 (674 baselines that differ, the 2 lists, 2 licence
  files).
- The longest path becomes 200 characters (today 159); 16 paths are longer than 180:
  `test/cli/lint/conformance/corpus/ts/tests/cases/conformance/internalModules/DeclarationMerging/ClassAndModuleThatMergeWithModulesExportedGenericFunctionAndNonGenericClassStaticFunctionOfTheSameName.ts`.
- `.gitignore:139` (`*.generated.ts`, also line 36) ignores one case,
  `tests/cases/conformance/parser/ecmascript5/parserSyntaxWalker.generated.ts`. A file `.gitignore` with the
  line `!*` in the corpus directory lifts it (proved by the bottom-up pass), so that `git add <directory>`
  takes the file now and after the next sync. That file is the unit's own. Two cases are executable
  upstream (mode 100755) and stay so.
- No name of the corpus matches the test discovery of CI (`scripts/runner.node.ts:2492-2494`,
  `/\.test|spec\./` on the base name of a JavaScript or TypeScript file), the discovery of `bun test`, or
  the glob of prettier (`package.json:80`): 0 of 12,445 cases and 0 of the baselines. No source lint of
  `test/internal/source-lints` scans the `test/` tree.
- `test/cli/lint` is in no list of `test/parallel-allowlist.json` (a generated file): the new test files
  run in the serial part of a shard until that file is made again.
- The file list of the pull request: `scripts/buildkite.ts:436-465` reads at most 500 files (10 pages of
  50) and `.buildkite/ci.ts:1941-1943` stores them as build meta-data; `scripts/runner.node.ts:1316` and
  `:2818` run the changed tests first and `:3018` marks a new one with it. If GitHub lists the files in
  path order (not verified here), the 22,000 paths of the corpus come before `test/cli/lint/lint.test.ts`
  and every later file, which then are not in the list. Only the order of the tests and the mark "new" are
  affected. `comment-cop.yml` reads the list of the GitHub API, which ends at 3,000 files (not verified
  here); paths below `src/` sort before `test/`.

### RP-7. The formatter

To: nobody; a duty of the unit. `format.yml` runs `bun run prettier` over `docs` and
`test/**/*.{test,spec}.*` (`package.json:80`): `docs/project/license.mdx` (its tables are aligned) and
`test/cli/lint/conformance.test.ts` have to be formatted, or the workflow pushes a commit or fails. The
other files of the runner are not in its glob.

To: integrator, not urgent (found by the bottom-up pass, read again here): the lines
`test/cli/lint/conformance/corpus` and `test/cli/lint/typecheck/fixtures` in `.prettierignore`. The editor
settings of the repository format a file when it is saved (`.vscode/settings.json:5`), and the root
`.editorconfig:4-8` asks for LF, a final line break and no white space at the end of a line in every file:
a case that someone opens and saves is rewritten. Against the second the corpus directory gets its own
`.editorconfig` with the one line `root = true` (the unit's own file). Against the first only the root
`.prettierignore` helps, which no unit owns.

## 3. Libraries

### LB-1. `tests/lib`

To: integrator (a decision about the text of `conformance.md`). T1.1 names `tests/cases/conformance`,
`tests/cases/compiler` and the baselines. The harness also mounts `tests/lib` of TypeScript at `/.lib`
(`harnessutil.go:41`, `:144`, `:215`, `:267-290`). It is 4 files and 394,949 bytes (`react.d.ts`,
`react16.d.ts`, `react18/react18.d.ts`, `react18/global.d.ts`). 163 case files name `/.lib/`: 170 run
instances (E 86, C 84). The unit copies `tests/lib` with the corpus, counts it in the measurement of T1.4
and says so in its report.

### LB-2. The default libraries: one committed copy

To: typecheck (K4, K5), and integrator for the decision.

Ask. The oracle was made with the library files that typescript-go embeds: `internal/bundled/libs`, 108
files, 3,785,075 bytes, tracked at 89d5d5b. Each is the copyright notice, then the sources of `src/lib`
without CR, under the name `lib.<name>.d.ts` (`internal/bundled/generate.go:53-70`). `typecheck.md` K4 names
`_submodules/TypeScript/src/lib`: those are the sources (`es5.d.ts`, `dom.generated.d.ts`), with other
names. The names reach the baselines (`lib.es5.d.ts(--,--): error TS2300`), and neither directory is in this
repository, so a test that reads it cannot run in CI. The `typescript` 6.0.2 package of `node_modules` has
the same 108 names, and 7 files differ (count of the bottom-up pass): 4 in comments, 3 in declarations
(`lib.es2017.string.d.ts`, `lib.es2018.intl.d.ts`, `lib.es2020.intl.d.ts`).

Proposal: the conformance unit copies `internal/bundled/libs` once, verbatim, to
`test/cli/lint/conformance/corpus/tsgo/internal/bundled/libs/` (one more `copy` record of `UPSTREAM`), and
`API.md` names the path. K4, K5 and `libDirectory` of CH-3 read that directory. There is no second copy
until a later unit embeds the libraries in the binary.

Unlocks: 12,788 run instances load a default library; 10,750 of them the same 19 files (`target` es2015).
Until then: a sweep against the reference clones on this machine reads
`/workspace/ref/typescript-go/internal/bundled/libs`; in CI no instance that needs a library can run.

## 4. Licence

### LC-1. The credit for the ported checker and for the libraries

To: typecheck, cli, the later unit that embeds the libraries, and the maintainers.

The conformance unit owns `LICENSE.md` and `docs/project/license.mdx` for attribution. With T1 it adds the
credit for the test corpus (TypeScript and typescript-go, Apache-2.0, not part of the binary) under
"Additional credits" (`LICENSE.md:81-84`, `docs/project/license.mdx:86-90`), and keeps `LICENSE` and
`NOTICE.txt` of typescript-go and `LICENSE.txt` and `ThirdPartyNoticeText.txt` of TypeScript beside the
corpus. `.claude/docs/landing-prs.md:48`: "Include license attribution in the same PR for any copied
open-source code." This work is one pull request, so the credit for the ported code has to be in it too,
and only this unit may write the two files.

Ask.

1. typecheck: say in its `API.md` which upstream packages `src/typecheck` ports and which upstream files it
   copies (`diagnosticMessages.json` of TypeScript, `extraDiagnosticMessages.json` of typescript-go), so
   that the line for the port is written when it is true. The line does not name the flag: `--lint` is
   hidden (`cli.md` C1.1), and its docs land when it becomes public.
2. cli: the same for `src/lint` (its prototype has an `UPSTREAM_PORTED` that names typescript-go), and
   whether a rule or a test vector copies text of ESLint (MIT): then a line for it.
3. Maintainers: MQ-2.

Until then: the corpus line only.

## 5. Another unit that vendors cases

### VN-1. `test/cli/lint/typecheck/fixtures/`

To: typecheck (K2).

Ask. Before the first case is added, three files of its own there: `.gitattributes` with the line
`* -text`, `.gitignore` with the line `!*`, and `.editorconfig` with the line `root = true` (RP-7). The
entries RP-1, RP-2, RP-3, RP-7 and CK-1 name its path too.

Why. `git check-attr text eol` gives `text: set`, `eol: lf` for `.ts`, `.tsx`, `.js` and `.json` there (the
root `.gitattributes:1-20`), and nothing for `.symbols` and `.errors.txt`. Of the 12,445 case files 8,879
are CR LF, 362 mix CR LF and LF, 8 have a lone CR, 9 a NUL byte, 7 a UTF-16 byte order mark. Of the 215
cases of typecheck's selection 158 hold a CR. Proved in a scratch repository with the root `.gitattributes`:
`git add` of `compiler/ExportAssignment7.ts` (76 bytes, blob 9c8b78da) stores 71 bytes (blob 6d7e2a43) under
`typecheck/fixtures/` and upstream's blob under a directory with `* -text`. A `.symbols` baseline keeps its
bytes on `git add`, and loses them with `core.autocrlf=true`, the setting of Git for Windows and of the
autofix workflow (`format.yml:30`). Every offset of a tree dump and of a diagnostic after the first line
break then differs from upstream. The conformance corpus gets the same three files.

## 6. The checks of the integrator at a merge

### CK-1. Comment runs and markers: a path exemption

To: integrator.

`internal/STATE.md` has the integrator check a merged branch for comment runs and for TODO and FIXME. The
corpus is copied byte for byte:

- Case files with two comment lines in a row, of 12,445: 8,386 with the line test of
  `.github/workflows/comment-cop.yml` on the text as UTF-8 (what that workflow would see in a patch); 8,352
  with two `//` lines; 8,199 and 8,162 when the byte order mark of the first line is not removed; 8,131
  when `//` has to be at column 0. The figure 8,238 of the task text was not reproduced by any of twelve
  definitions (`probes/comment_variants.ts`). In 6,455 files every run is made of directives such as
  `// @target: es2015`.
- 29 case files hold TODO, FIXME or XXX (39, 5 and 4 places; none holds HACK), and 2 of the 4 files of
  `tests/lib`.
- 3 of the 4 files of `tests/lib` and 98 of the 108 library files have such a run.
- Error baselines, which quote the cases: 469 of TypeScript's 9,056 and 408 of typescript-go's 7,027 have
  such a run, 19 and 21 a marker.
- 547 case files hold `#` and three or more digits (336 say "Repro from #" or "Repros from #"): a check for
  pull request numbers in comments trips there too.

Ask: the check leaves out `test/cli/lint/conformance/corpus/` and `test/cli/lint/typecheck/fixtures/`, for
example with the pathspecs `:(exclude)test/cli/lint/conformance/corpus` and
`:(exclude)test/cli/lint/typecheck/fixtures`. The files of the runner, `sweep.ts` and `conformance.test.ts`
are checked as any other file. The workflow itself reads only paths that start with `src/`
(`comment-cop.yml:99`), so CI needs no change.

### CK-2. The list may not shrink: a check at the merge

To: integrator.

`conformance.md`: "A committed list of passing names may grow and may not shrink." The test file sees one
commit: it fails when a listed instance does not pass, and it cannot see that a commit took a name out of
the list. The comparison of two revisions of the list exists in the prototype of the sweep
(`test-file-and-sweep/top-down/sweep.ts`, the option `--since <revision>`: it reads the list of that
revision with `git show`, runs no instance, and exits with 1 when a name left a list, moved from E to C, or
the level was lowered).

Ask: before a unit branch is merged, run the command that `conformance/API.md` names for this (in the
prototype `bun test/cli/lint/conformance/sweep.ts --since <the commit before the merge>`), for
`test/cli/lint/conformance/expectations.json` and for the list of K5, and do not merge when it fails.

Until then: only the review of the diff guards the rule.

## 7. What only CI can verify

No Windows machine and no macOS machine was available. Nothing below is verified. A green run on Linux says
nothing about them. Watch the first run of these lanes for:

- CI-1, long paths (Windows). The longest path of the corpus is 200 characters (today 159). The CI image
  sets `core.longpaths` (`scripts/build/ci-images/spec.ts:1376`); a clone without it fails with "Filename
  too long" when its root is longer than about 58 characters (259 less the 200 and one separator).
- CI-2, line endings (Windows). The image sets `core.autocrlf` false (`spec.ts:1374`). A clone with
  `autocrlf` true has to leave the corpus byte for byte: proved by simulation only
  (`corpus-repo-hazards/prove-corpus.sh`).
- CI-3, links (Windows). 19 run instances make links. Without the right to make links their status has to
  be "unsupported on this platform", not "fail".
- CI-4, case rules (macOS, Windows). The harness runs every instance with case-sensitive names
  (`harnessutil.go:105`) and the disk of these systems is not: a check that reads the disk finds `A.ts` for
  `a.ts`, so a diagnostic about the casing of a file name can differ. 2 run instances
  (`compiler/commonSourceDir3.ts`, `compiler/commonSourceDir4.ts`) have units below `A:/` and `a:/`, which
  are one directory there. No two paths of the corpus itself differ only by case. Predicted by the
  materialisation research, not measured: 182 run instances cannot be written to disk on macOS, 183 on
  Windows (188 without the right to make links), 185 on Linux.
- CI-5, names in the output (Windows, macOS). A drive, back slashes, a short name of the temporary
  directory (`RUNNER~1`), `/var` against `/private/var`: the mapping from real to virtual names was tested
  on Linux only.
- CI-6, time. Process creation on Windows and under ASAN is not measured. The numbers of section 1 are from
  one loaded Linux machine. The unit tests of the runner run inside the test process: reading 12,445 cases
  there in a debug build with ASAN is not measured either.
- CI-7, LeakSanitizer in the ASAN lane: RP-4.
- CI-8, the size of the pull request: more than 22,000 added files. The limits of RP-6, the page "Files
  changed", and the time of a checkout.
- CI-9, a crash. Windows ends a panic with exit code 3, POSIX with a signal: the runner reads both as a
  crash, tested on Linux only.
- CI-10, that the test ran. `.claude/docs/landing-prs.md:66`: "confirm CI actually executed your tests".
  Look for `test/cli/lint/conformance.test.ts` in the log of one shard of every platform.

## 8. Questions that only the maintainers can answer

- MQ-1. `REVIEW.md:15` against an internal variable. The rule names `bun:internal-for-testing` or
  externally observable behaviour. A lint run must not start JavaScriptCore (`cli.md` C1.1), so the module
  cannot serve the command line, and the plain format cannot carry options, span length and related
  information. Is a pair of internal variables behind the gate of `src/bundler/bytecode_order.rs:63-71`
  acceptable there, as `BUN_BYTECODE_ORDER_NAMES_OUT` is? If not, the default check stays at the level
  "plain" and lists nothing, and every list is K5's.
- MQ-2. Apache-2.0 section 4(d) asks for the notices of a `NOTICE` file in what is distributed.
  `NOTICE.txt` of typescript-go (48,860 bytes) holds the notices for DefinitelyTyped, Unicode, the Document
  Object Model and others: they belong to the library files and to the Unicode tables of the scanner. Which
  file of a Bun release carries them once the checker and the libraries are in the binary? `LICENSE.md` has
  no entry for the React Compiler port either (`src/react_compiler/UPSTREAM_PORTED`).
- MQ-3. The corpus under `test/`: 22,186 files and 7.4 MiB packed in one pull request
  (`.claude/docs/landing-prs.md:67`: "Diff size itself is grounds for changes-requested"). `internal/STATE.md`
  already lists this as an open question with the default "corpus under test/".
