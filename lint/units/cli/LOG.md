# Log of the cli unit

Running log of the work on `bun --lint` in `/workspace/wt/cli` (branch `robobun/abbc0c92/lint-cli`): what was
measured, with the command, the wall time and the output, what was decided, and what is open. `API.md` beside this
file has the interface and the rulings, `NEEDS.md` the requests to the owners of other files. A new entry goes
after the last entry, and every run of a gate gets a row in "Gate results", the last section.

Each fact carries one of four words that say how it is known:

- **run**: a command run for this log. The command, its wall time and its output are given.
- **on disk**: read from a file that an earlier step left behind. The file is named. The command line that made it
  is recorded nowhere, so none is claimed.
- **read**: read in the source, at the commit named.
- **not run**: not done. The command to run is given.

All times are UTC.

## Entry 1, 2026-09-30 19:17 to 20:56: the baseline at e3566be889, the gates at a0165c2db5

The worktree was at `a0165c2db5` when the entry was begun. Other work changed it meanwhile: at 19:47 five files
were modified and not committed and four rule modules were untracked, and by 20:54 eleven commits had followed
(the list is at the end of section 8). "At `a0165c2db5`" below means the files of that commit, not the worktree.
None of the later commits was read for this entry.

**Nothing was built or compiled for this entry**: no `bun bd`, no `bun bd test`, no `cargo check`, `clippy`,
`test` or `miri`. The step that wrote it was not to build or to test. A build would also have measured a tree that
no commit names, and it would have replaced the binary of e3566be889. What is measured comes from three places
that need no build: the debug binary that the first build of the worktree linked at e3566be889, which still is
`build/debug/bun-debug` and was run directly; the files that this build and earlier cargo runs left; and rustfmt on
the files of a commit. No file of the worktree was changed; `build/debug/bun-debug` got a second name outside the
worktree (section 2).

| | asked of the bootstrap (`worktree-bootstrap-baseline`) | what this entry has |
| --- | --- | --- |
| 1 | behaviour of the debug build at e3566be889 | **run**, on the binary itself, not through `bun bd` (section 3) |
| 2 | `cargo check`, `cargo clippy` and `cargo fmt` work, and in which environment | environment **read**; earlier runs **on disk**; `cargo check` and `cargo clippy` **not run**; rustfmt **run** on the files of `a0165c2db5` (section 5) |
| 3 | `size_of::<Msg>()` and `size_of::<Metadata>()`, dev and `--release` | **run** by another method, on the debug build: 152 and 8, before and after `Metadata::Code`. The probe, bare cargo and `--release`: **not run** (section 4) |
| 4 | does `cargo test -p bun_ast line_column_tracker` link and run | **not run**. **On disk**: a native test build of `bun_ast` did not link on 2026-09-30 (section 6) |
| 5 | `as-node.test.ts` and `bun-options.test.ts` as the green baseline | **not run** (section 7) |
| | the gates of the branch | **not run**, except rustfmt. What stops them at `a0165c2db5`: **read** (section 8) |

### 1. The bootstrap of the worktree (on disk)

Birth and modification times of what the bootstrap made (`stat -c '%w %y'`), all on 2026-09-29. The commands
(`bun install`, `(cd test && bun install)`, `bun bd --version`) and their output are recorded nowhere.

| time | what |
| --- | --- |
| 15:47:32 | the worktree (`.git`) |
| 15:58:32 | `node_modules/` and `test/node_modules/` (last write in the second 15:58:39) |
| 15:58:40 | `build/debug/git-revision` (`e3566be889995ffff8b08823b9233617f979c889`), `.cargo/config.toml` |
| 15:58:41 | `vendor/` (20 directories), `build/debug/codegen/build_options.rs` |
| 16:08:20 to 16:08:23 | `build/debug/bun-debug`, 810,689,624 bytes |
| 16:08:26 | `build/debug/bun-debug.smoke-test-passed` |

`build/debug/.ninja_log`: the link of `bun-debug` runs from 518,975 ms to 576,880 ms after the start of ninja, and
the last edge (`bun-debug.smoke-test-passed`) ends at 578,020 ms. So the first debug build took 9 min 38 s in
ninja, and 9 min 46 s from `git-revision` to the smoke test.

### 2. The binary of e3566be889

`/workspace/wt/cli/build/debug/bun-debug`: inode 330389665, 810,689,624 bytes, modified 2026-09-29 16:08:23.699,
GNU build id `fa081293ab45b8578a3c33a16fdc4047349fa8cd` (`readelf -n`). **Run** at 19:35: `--version` prints
`1.4.3-debug` (1.4 s) and `--revision` prints `1.4.3-debug+e3566be88` (1.3 s). Inode, size and time were the same
before and after the runs of section 3, and at 20:17.

Why it is the build of e3566be889:

- It was linked on 2026-09-29 at 16:08. The first commit after e3566be889 (`387eb250a9`) is dated 2026-09-30
  06:13:54.
- No later build linked again (**on disk**). `.ninja_log` has 82 entries of 2026-09-30 13:09:34 to 13:48:38 (the
  plan of the Rust build and twenty Rust libraries: `bun_ast` and crates above it, the last `bun_install`; not
  `bun_lint`, `bun_jsc` or `bun_runtime`) and three of 17:43 and 17:56 (`codegen/generated_host_exports.rs`,
  `build.ninja`). It has no entry for `bun-debug` after 2026-09-29. In
  `build/debug/rust-target/x86_64-unknown-linux-gnu/deps`, `libbun_runtime-f33c741e4181e3a3.rlib` is of 2026-09-29
  16:07 and `libbun_lint-7d2963c0eb66e736.rlib` (3,998 bytes: the empty crate) of 16:00.
- Not on disk: that the worktree had no uncommitted edit when it was built. The plan of the unit says that it was
  clean at e3566be889 before the bootstrap.
- `--revision` and `build/debug/git-revision` do NOT show it. A debug build directory pins the revision at its
  first configure (`getGitRevision` in `scripts/build/config.ts`), so every later build of this directory prints
  `1.4.3-debug+e3566be88` too. The link time and the build id tell the binaries apart.

Kept for later: `/tmp/lint-cli-baseline-e3566be889/bun-debug`, a hard link to the same inode, made at 19:35:04.
The next build that links replaces `build/debug/bun-debug`; after that the behaviour of e3566be889 can only be
measured with a new build of that commit. About the kept file:

- It stays only if the linker writes a new file in place of its output. If it rewrites the old file the link
  shows the new binary. Check the build id before using it. Not tried.
- It reads some files when it runs instead of holding them: the debug profile does not set
  `cfg(bun_codegen_embed)` (`src/bun_core/util.rs:2930-2931`), so the generated JavaScript comes from
  `/workspace/wt/cli/build/debug/codegen` and a few files from `/workspace/wt/cli/src` (`runtime/ffi/FFI.h`,
  `runtime/bake/bun-framework-react/`). It is the build of e3566be889 only while those are what they were. Up to
  `a0165c2db5` the branch changes `src/ast/lib.rs`, `src/lint/`, `src/runtime/cli/lint_command.rs`,
  `test/cli/lint/` and `Cargo.lock` and nothing else (`git diff --stat e3566be889 a0165c2db5`, 39 files).
- A restart of the machine or a cleaning of `/tmp` loses it. `rm -r /tmp/lint-cli-baseline-e3566be889` removes it;
  it holds 0.8 GB once the original is replaced.

### 3. What the debug build of e3566be889 does with `--lint` (run)

Run at 19:35:15 to 19:35:58, load average 325 at the start and 420 at the end, on 16 cores. `$BIN` is
`/workspace/wt/cli/build/debug/bun-debug`, `$D` a new directory under `/tmp`. stdin is `/dev/null`, stdout and
stderr go to files, so neither is a terminal. The environment had `BUN_DEBUG_QUIET_LOGS=1` (which `bun bd` sets,
script `bd` of `package.json`), `BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1`, `BUN_GARBAGE_COLLECTOR_LEVEL=0` and
`BUN_NO_CORE_DUMP=1`. `BUN_FEATURE_FLAG_EXPERIMENTAL_LINT` was unset (`env -u`) except in P1b.

`$D/x.ts`:

```ts
import { writeFileSync } from "node:fs";
const args: string[] = process.argv.slice(2);
writeFileSync("marker-ts.txt", "x.ts ran " + JSON.stringify(args) + "\n");
console.log("x.ts ran", JSON.stringify(args));
```

`$D/x.js`:

```js
const { writeFileSync } = require("node:fs");
const line = "x.js ran " + JSON.stringify(process.argv.slice(2)) + " execArgv=" + JSON.stringify(process.execArgv);
writeFileSync("marker-js.txt", line + "\n");
console.log(line);
```

`$D/pkg/package.json`: `{ "name": "lintlog-probe", "scripts": { "lint": "echo lint-script-ran" } }`

The markers were deleted before each command.

| | command, in `$D` | stands for | wall | exit | stdout | stderr | marker |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | `$BIN --lint x.ts` | `bun bd --lint x.ts` | 4.5 s | 0 | `x.ts ran []` | empty | `marker-ts.txt` written |
| P1b | `BUN_FEATURE_FLAG_EXPERIMENTAL_LINT=1 $BIN --lint x.ts` | the central test of C1.6 | 2.0 s | 0 | `x.ts ran []` | empty | written |
| P2 | `$BIN --lint` | bare `bun bd --lint` | 0.3 s | 0 | the help of bare `bun`, 38 lines, 2,161 bytes | empty | none |
| P2b | `$BIN` | | 0.6 s | 0 | the same help, 38 lines, 2,161 bytes | empty | none |
| P3 | `$BIN lint`, in `$D/pkg` | `bun bd lint` | 1.2 s | 0 | `lint-script-ran` | `$ echo lint-script-ran` | none |
| P4 | `$BIN --bun node --lint x.js` | `bun bd --bun node --lint x.js` | 3.4 s | 0 | `x.js ran [] execArgv=["--lint"]` | empty | `marker-js.txt` written |
| P5 | `$BIN x.ts --lint` | the pin of C1.5 | 3.9 s | 0 | `x.ts ran ["--lint"]` | empty | written |
| P6 | `$BIN run --lint x.ts` | `bun run --lint` of the goal | 1.6 s | 0 | `x.ts ran []` | empty | written |

What they say:

- At e3566be889 `--lint` is dropped and the file RUNS, under the auto command (P1) and under `bun run` (P6), with
  the variable set or not (P1b). P1b is the command of the central test of cli.md C1.6: on this build it prints a
  line and writes the marker, so that test fails on a build without the change, as it must.
- Bare `--lint` prints the help and exits with 0 (P2). P2 and P2b differ in six lines, the example package names
  of `add`, `remove`, `update`, `info`, `why` and `create`, which the help picks at random on every run. The first
  seven lines of P2:

  ```
  Bun is a fast JavaScript runtime, package manager, bundler, and test runner. (1.4.3-debug+e3566be88)

  Usage: bun <command> [...flags] [...args]

  Commands:
    run       ./my-script.ts       Execute a file with Bun
              lint                 Run a package.json script
  ```

  The word `lint` in line 7 is the help's fixed example of a script (`src/runtime/cli/mod.rs:645`). A test of bare
  `bun --lint` cannot look for that word in stdout.
- `bun lint` runs the script `lint` of `package.json` (P3).
- Under the name `node` the flag lands in `process.execArgv`, the script gets no argument and runs (P4). P4 is
  the command that `fakeNodeRun(dir, ["--lint", "x.js"])` spawns (`test/harness.ts:642-657`), apart from
  `bunEnv`: it is the baseline of the pin that C1.5 adds to `as-node.test.ts`.
- After the script, `--lint` is an argument of the script (P5).

How the commands differ from the ones the plan names. `bun bd <args>` builds and then runs
`build/debug/bun-debug <args>` (`scripts/build.ts:299`); only the second half was done here, because the first
would have built the worktree of the moment. `bun bd lint` can only be run at the root of the repository, where
the script `lint` is oxlint over `src/js`; P3 uses a `package.json` of its own. P1b, P2b, P5 and P6 are additions.

### 4. `size_of::<Msg>()` and `size_of::<Metadata>()` (run, on the debug information of the debug build)

The probe of the plan (`const _: [(); 0] = [(); N + core::mem::size_of::<T>()];` appended to `src/ast/lib.rs`,
then `cargo check`) was **not run**: it edits a file of the worktree and compiles. The sizes were read instead
from the split debug information (`.dwo`) that the debug build writes beside its objects, in
`build/debug/rust-target/x86_64-unknown-linux-gnu/deps`. That is the layout rustc made when `bun bd` compiled:
profile `dev` with the flags of the debug build (`--cfg=bun_debug`, `--cfg=bun_asan`, `-Zsanitizer=address`,
`-Zbuild-std`; they are in `build/debug/rust-target/plan.input.json`).

| tree | read from | `Msg` | `Metadata` | `Data` | `MetadataResolve` |
| --- | --- | --- | --- | --- | --- |
| e3566be889, in `bun_ast` itself | `bun_ast-e33ad14205799d9e.*.059q45s.rcgu.dwo`, the 219 files of the first build, written 2026-09-29 16:01:12 to 16:01:37: the 16 that have `Msg` | 152, alignment 8 | 8, alignment 4, variants `Build` and `Resolve` | 120 | 8, alignment 4 |
| e3566be889, as `bun_jsc` sees the types | `bun_jsc-dfeeb353fcfbdab3.*.1fpcyjm.rcgu.dwo`, 256 files written 2026-09-29 16:03 to 16:04: the 107 that have `Msg` | 152, alignment 8 | 8, alignment 4, variants `Build` and `Resolve` | 120 | 8, alignment 4 |
| `src/ast/lib.rs` of `4d9b8e5139`, which is the file at `a0165c2db5` | `bun_ast-e33ad14205799d9e.*.1vjcy9b.rcgu.dwo`, the 31 files written 2026-09-30 13:10: the 16 that have `Msg` | 152, alignment 8 | 8, alignment 4, variants `Build`, `Resolve` and `Code` | 120 | 8, alignment 4 |

Every file of a set gives the same numbers (52.7 s, 15.9 s and 2.1 s for the three sets). In both trees the
fields of `Msg` are at `data` 0, `metadata` 120, `notes` 128, `redact_sensitive_information` 144 and `kind` 145:
146 bytes, 152 with the padding to the alignment. That is the layout the plan had read from the source.

The command, for one file of the second and of the third set, and what it prints for `Msg` and `Metadata` in the
first of the two. Shortened: the compile unit, the lines of `DW_AT_accessibility`, the type and the alignment of
four members, and the children of `Metadata` are left out.

```
/usr/lib/llvm-23/bin/llvm-dwarfdump --name=Msg --name=Metadata --show-parents --show-children --recurse-depth=1 \
  bun_jsc-dfeeb353fcfbdab3.drw3qlnqipkauu2bk6rvp2em7.1fpcyjm.rcgu.dwo      # e3566be889
/usr/lib/llvm-23/bin/llvm-dwarfdump --name=Msg --name=Metadata --show-parents --show-children --recurse-depth=1 \
  bun_ast-e33ad14205799d9e.0vh6vxkrr090kw69yga77qauo.1vjcy9b.rcgu.dwo      # with Metadata::Code

0x00000180:   DW_TAG_namespace
                DW_AT_name	("bun_ast")
0x000001c7:     DW_TAG_structure_type
                  DW_AT_name	("Msg")
                  DW_AT_byte_size	(0x98)
                  DW_AT_alignment	(8)
0x000001cd:       DW_TAG_member
                    DW_AT_name	("kind")
                    DW_AT_data_member_location	(0x91)
0x000001d7:       DW_TAG_member
                    DW_AT_name	("data")
                    DW_AT_data_member_location	(0x00)
0x000001e1:       DW_TAG_member
                    DW_AT_name	("metadata")
                    DW_AT_type	(0x00000267 "bun_ast::Metadata")
                    DW_AT_alignment	(4)
                    DW_AT_data_member_location	(0x78)
0x000001eb:       DW_TAG_member
                    DW_AT_name	("notes")
                    DW_AT_data_member_location	(0x80)
0x000001f5:       DW_TAG_member
                    DW_AT_name	("redact_sensitive_information")
                    DW_AT_data_member_location	(0x90)
0x00000267:     DW_TAG_structure_type
                  DW_AT_name	("Metadata")
                  DW_AT_byte_size	(0x08)
                  DW_AT_alignment	(4)
```

Why the files are what the table says (**on disk**):

- A compile of a crate writes its `.dwo` under a name of its own, the part before `.rcgu.dwo`, and leaves the
  files of the compile before. `bun_ast` has 219 codegen units and two such names: `059q45s`, 219 files of the
  first build, and `1vjcy9b`, 219 files of the build attempt of 2026-09-30 13:09 (`.ninja_log`:
  `libbun_ast-e33ad14205799d9e.rlib` at 13:10:04). Of the second 219, 31 were written at 13:10 and 188 carry the
  time of 2026-09-29: units that were not compiled again. None of the 188 has `Msg` or `Metadata` (43.6 s).
- The `src/ast/lib.rs` of that attempt was last written at 07:07:41 on 2026-09-30 and has one commit since
  e3566be889, `4d9b8e5139`.
- `bun_jsc` compiled once in the debug build: `.ninja_log` has one entry for `libbun_jsc-dfeeb353fcfbdab3.rlib`,
  of 2026-09-29 16:03, and its 256 `.dwo` have one name and that day. A bare `cargo check` of the later source
  stops in `bun_jsc` with E0004 (section 5).
- `bun run clean` or the removal of `build/` removes all of them; then only the probe on a checkout of
  e3566be889 gives the first two rows again.

Not measured for this entry:

- Bare cargo (`cargo check -p bun_ast`, without the two `--cfg` of the debug build) and `--release`. **Read** at
  `a0165c2db5`: no field of `Msg`, `Data`, `Location`, `Metadata` or `MetadataResolve` is under a `#[cfg]`
  (`src/ast/lib.rs:632-663`, `:851-854`, `:1122-1128`, `:1236-1251`), so nothing in these types asks for another
  size. The types of their fields (`Cow`, `Box`, `ImportKind`, `bun_ast::Error`) were not read.
- For `Msg` at `a0165c2db5` the source has `const _: () = assert!(core::mem::size_of::<Msg>() == 152);`
  (`src/ast/lib.rs:1244`), so every compile of `bun_ast` that succeeds proves 152 for its profile. **On disk**
  that is the debug build's compile of 13:10 and, for bare cargo in the profile `dev`, the checks of 2026-09-30
  10:10 to 10:33 (section 5). Nothing on disk is of `--release`, and e3566be889 has no such assertion.
- To finish: `/workspace/tools/lk cargo check -p bun_ast --message-format=short` and the same with `--release`
  measure `Msg` through the assertion. `Metadata` needs the probe:
  `const _: [(); 0] = [(); 1000 + core::mem::size_of::<Metadata>()];` at the end of `src/ast/lib.rs`, the two
  commands again (the error should name the length, 1008 for a size of 8; not tried), then the line removed and
  `git status` clean.

### 5. The cargo gates: environment (read), earlier runs (on disk), rustfmt (run)

Environment, **read** at `a0165c2db5`:

- Cargo resolves the workspace only when `vendor/lolhtml` and `vendor/rust-argon2` exist
  (`scripts/rust-miri.ts:63-66`), and five build scripts (`src/bun_core`, `src/install`, `src/jsc`, `src/parsers`,
  `src/runtime`) need files that the build generates. All of it comes with the first `bun bd`, so cargo works
  only after it.
- `BUN_CODEGEN_DIR`: the build scripts take it from the environment and fall back to
  `<repository>/build/debug/codegen` (`src/jsc/build.rs:30-32`, `src/bun_core/build.rs:28-30`), and panic when
  the generated file is not there. That directory exists in this worktree, so bare cargo needs no variable here.
  CI sets the variable to the same directory for `bun run rust:clippy`, for
  `cargo check --workspace --all-targets --keep-going` and for `bun run rust:miri`
  (`.github/workflows/rust-lints.yml:64`, `:73`, `:95`).
- Toolchain: `rust-toolchain.toml` pins `nightly-2026-09-15` with `clippy`, `rustfmt` and `miri`. Installed
  (**run**, `--version`): `rustc 1.100.0-nightly (574ff7d98 2026-09-14)`,
  `cargo 1.100.0-nightly (7941be6fb 2026-09-11)`, `rustfmt 1.10.0-nightly (574ff7d98b 2026-09-14)`.
- Linker: `.cargo/config.toml`, which `bun bd` writes and git ignores, makes cargo link with
  `/usr/lib/llvm-23/bin/clang++` and lld. Only a cargo command that links needs it (a test, section 6).
- Bare cargo writes to `target/`. `bun bd` compiles the same crates into `build/debug/rust-target` with other
  flags, so the two share nothing and the first bare `cargo check -p bun_runtime` compiles every crate again.
- COMMON.md: each of these commands runs as `/workspace/tools/lk <command>` with a timeout of 3600000 ms.

Earlier runs, **on disk** in `target/debug/build/<crate>/<unit>/`. `fingerprint/output-*` is what rustc printed
for the unit, `out/*.rmeta` its metadata; a unit that failed has no fingerprint file beside its output. A time is
the time of the files.

| when | what is there | errors in the output |
| --- | --- | --- |
| 2026-09-29 16:16:45 to 16:19:54 | `target/` is made. Lib units of `bun_ast`, `bun_options_types`, `bun_lint` (`f2a08f7dd304d5ca`), `bun_jsc` and `bun_runtime` (`b0a2a7cbc60cd36a`, metadata at 16:19:54) | none: the metadata of `bun_runtime` needs every crate below it |
| 2026-09-29 16:32:30 to 16:36:33 | the same crates again under other unit names: `bun_lint` (`37421b5e757b08fd`, 16:32:30), `bun_ast` (`cb65a409fca1ef3d`, `013f464f81bb0246`), `bun_options_types`, `bun_jsc` (`5302bc7241452aa1`), `bun_runtime` (`1a10d781d6895f4b`, 16:36:33) | none |
| 2026-09-29 16:38:38 | `target/cargo-timings/cargo-timing-20260929T163838682Z-1200dea30c909d08.html`: target `bun_runtime 0.0.0 (lib)`, profile `dev`, 224 units, all fresh, total time 0.0 s, `jobs=12 ncpu=12` | |
| 2026-09-29 17:01:34 to 17:01:56 | check units of the tests (`test-lib-*`, empty metadata) of `bun_ast`, `bun_lint` and `bun_options_types` | none |
| 2026-09-29 17:02:09 to 17:59:05 | `target/<triple>/` for six other targets (Windows, macOS, FreeBSD), as a check with `--target` makes them (`bun run rust:check-all` is one) | results not recorded |
| 2026-09-30 10:10 to 10:11 | the first two lib units of `bun_ast` again | none |
| 2026-09-30 10:15:26 to 10:16:30 | `target/<triple>/` for five more targets (Linux aarch64, musl, Android) | results not recorded |
| 2026-09-30 10:17:47 to 10:18:00 | a test build of `bun_ast` (`bf086e08434e68a3`) | it does not link (section 6) |
| 2026-09-30 10:18:13 | `target/miri/` is made, and the test target of `bun_ast` is built in it (`46a38c8f478813b1`) | none |
| 2026-09-30 10:32:57 to 10:33:15 | a check unit of the tests of `bun_ast` (`87fb3f71bcbfbbac`) and the lib unit `cb65a409fca1ef3d` | none |
| 2026-09-30 10:39:50 | a lib unit of `bun_lint` (`cb2c91b56bc2a964`) | six E0583, `file not found for module`: `no_compare_neg_zero`, `no_debugger`, `no_duplicate_case`, `no_empty_pattern`, `no_sparse_arrays`, `no_unsafe_negation` (`src/lint/rules/mod.rs` lines 3, 4, 7, 8, 10, 11) |
| 2026-09-30 10:47:02 | the lib unit of `bun_jsc` (`b94e80b7d49c15cf`) | two E0004, `` `bun_ast::Metadata::Code(_)` not covered ``: `src/jsc/VirtualMachine.rs:3611:20` and `src/jsc/lib.rs:1378:11` |

What the table does and does not say:

- On 2026-09-29 HEAD was e3566be889, and the four crates of the gate command
  (`cargo check -p bun_ast -p bun_options_types -p bun_lint -p bun_runtime --message-format=short`) type-checked
  with bare cargo at least twice. Another unit name means other flags or the wrapper of clippy. Which run was
  `cargo check` and which `cargo clippy`, with which variables, how long each took and what it printed is not on
  disk.
- On 2026-09-30 from 10:10 to 10:47 HEAD was `7587bce918`. These are the runs that `API.md` ("Diagnostic code on
  `bun_ast::Msg`", last paragraph) and `NEEDS.md` (X2) quote from the review of `4d9b8e5139`.
- There is no `release` directory under `target/` or `build/`: nothing was compiled or checked with `--release`.

rustfmt, **run** on the files of `a0165c2db5` in a copy outside the worktree, because the worktree held the
uncommitted files of other work:

```
X=/tmp/lintlog-head-a0165c2db5; mkdir -p $X
git -C /workspace/wt/cli archive a0165c2db5db5405d30e0c79e53916f589341e1c \
  src/lint src/runtime/cli/lint_command.rs src/ast/lib.rs rustfmt.toml | tar -x -C $X
cd $X; export RUSTUP_TOOLCHAIN=nightly-2026-09-15
rustfmt --check --edition 2024 src/lint/lib.rs                                                  # (a)
for f in $(find src -name '*.rs' | sort); do
  rustfmt --check --edition 2024 --config skip_children=true $f || echo "NOT CLEAN $f"; done    # (b)
```

- (a) 1.3 s, exit 1, one line: ``Error writing files: failed to resolve mod `no_compare_neg_zero`:
  /tmp/lintlog-head-a0165c2db5/src/lint/rules/no_compare_neg_zero.rs does not exist``. `cargo fmt -p bun_lint --
  --check` gives rustfmt the same file and the same edition and follows the `mod` lines from it, so at
  `a0165c2db5` that gate cannot pass: the six module files of the table above are not in the commit. The cargo
  command itself was not run.
- (b) 18.6 s, 21 files (19 under `src/lint`, `src/runtime/cli/lint_command.rs`, `src/ast/lib.rs`): each exits
  with 0 and prints nothing. Each file is formatted, taken alone. Control: the same command on a copy of
  `src/lint/rules/mod.rs` with two more blanks after one `fn` prints the diff and exits with 1.
- At `a0165c2db5` no `mod` line reaches `src/runtime/cli/lint_command.rs`, so `cargo fmt` of `bun_runtime` does
  not look at it there. (b) did.

### 6. Rust `#[test]`s as native executables (on disk; not run)

`cargo test -p bun_ast line_column_tracker` was **not run** for this entry. **On disk**, of 2026-09-30 10:17:47
(`invoked.timestamp`) to 10:18:00, with HEAD at `7587bce918`:
`target/debug/build/bun_ast/bf086e08434e68a3/fingerprint/output-test-lib-bun_ast`, what rustc printed for the test
target of `bun_ast`. Shortened here: the link line and seven of the nine blocks of `undefined symbol` are left
out, and `...` stands for a directory.

```
error: linking with `/usr/lib/llvm-23/bin/clang++` failed: exit status: 1
ld.lld: error: undefined symbol: mi_heap_malloc
>>> referenced by MimallocArena.rs:560 (src/bun_alloc/MimallocArena.rs:560)
>>>               .../out/bun_ast-bf086e08434e68a3.5xpdn8topys68yyiba91oqfk3.1v247pk.rcgu.o:(bun_alloc::mimalloc_arena::heap_alloc_maybe_aligned)
ld.lld: error: undefined symbol: simdutf__validate_ascii
>>> referenced by lib.rs:1466 (src/bun_core/lib.rs:1466)
>>>               bun_core-cc73572b3dba021a.b9lqkyucs08fkmrga9ezrcf35.0tcffbd.rcgu.o:(bun_core::strings_impl::is_all_ascii) in archive .../libbun_core-cc73572b3dba021a.rlib
clang++: error: linker command failed with exit code 1 (use -v to see invocation)
error: aborting due to 1 previous error
```

Nine symbols are undefined: `mi_heap_malloc`, `mi_heap_malloc_aligned`, `mi_malloc_usable_size`,
`mi_is_in_heap_region`, `mi_free_size` and `mi_free_size_aligned` (mimalloc, used by `src/bun_alloc`),
`highway_index_of_char` and `highway_index_of_any_char` (highway, `src/highway/lib.rs:232` and `:544`), and
`simdutf__validate_ascii` (simdutf, `src/bun_core/lib.rs:1466`). `out/` of the unit has the objects and no
executable.

- So the native test executable of `bun_ast` did not link in this worktree on that day: cargo links the Rust
  crates, and the C and C++ libraries that `bun` is linked with are not among them. Whether it links at
  e3566be889 is not known. The symbols are used by `src/bun_alloc`, `src/highway` and `src/bun_core`, which the
  branch does not touch (`git diff --stat e3566be889 01db053fed` has no file under them), and the test target has
  gained only the three tests of `msg_code_tests` since; but it was not tried.
- Under Miri nothing is linked. **On disk**: the test target of `bun_ast` built under Miri in the worktree at
  10:18 (`target/miri/x86_64-unknown-linux-gnu/debug/build/bun_ast/46a38c8f478813b1/fingerprint/test-lib-bun_ast`).
  `API.md` quotes the run: `MIRIFLAGS=-Zmiri-tree-borrows cargo miri test -p bun_ast --lib msg_code_tests`, 3
  passed. That is also how CI runs the tests of a crate, and only for the crates of `MIRI_CRATES`
  (`scripts/rust-miri.ts:39-57`): `bun_ast` is in the list, `bun_lint` is not (`NEEDS.md` X3).
- For the unit: a `#[test]` of `bun_ast` runs under Miri. The tests of `src/lint` have been run in scratch
  workspaces only (`NEEDS.md` X3, `c2-seam-arbitration/logs/`); in the real workspace neither a native run nor a
  Miri run of `bun_lint` is recorded, and until section 8 is green none is possible.

### 7. `as-node.test.ts` and `bun-options.test.ts` at e3566be889 (not run)

The green baseline was **not taken**: it is a test run. `test/cli/run/as-node.test.ts` (11 tests),
`test/cli/env/bun-options.test.ts` (7 tests) and `test/harness.ts` of the worktree were those of e3566be889 at
20:17 (`git diff --quiet e3566be889 -- <the three paths>` exits with 0). At 20:33:04 other work wrote
`bun-options.test.ts` (one line changed, not committed); `as-node.test.ts` and `harness.ts` were still unchanged
at 20:34. While a file is unchanged, its baseline is this, with the kept binary and with nothing built (`bunExe()`
is `process.execPath`, so the tests spawn that binary):

```
cd /workspace/wt/cli
K=/tmp/lint-cli-baseline-e3566be889/bun-debug
readelf -n $K | grep -q fa081293ab45b8578a3c33a16fdc4047349fa8cd || echo "not the binary of e3566be889"
for f in test/cli/run/as-node.test.ts test/cli/env/bun-options.test.ts; do
  git diff --quiet e3566be889 -- $f test/harness.ts || { echo "$f or the harness has changed: skipped"; continue; }
  BUN_DEBUG_QUIET_LOGS=1 /workspace/tools/lk $K test $f
done
```

The tests were not run. The two guards were tried at 20:41 with `echo` in place of the last command: they let
`as-node.test.ts` through and skipped `bun-options.test.ts`. A file that has changed is no longer the file of
e3566be889: the pins of C1.5 and the test of `--lint` in `BUN_OPTIONS` go into these two, and the test of the
refusal is meant to fail on this binary. Its baseline is the text of `git show e3566be889:<path>`, run from a
place where `harness` resolves, that is under `test/` of a checkout; that was not tried either. Without the kept
binary the baseline needs a build of e3566be889 outside this worktree.

### 8. The gates at `a0165c2db5` (read; not run)

| gate | command | at `a0165c2db5` |
| --- | --- | --- |
| build | `/workspace/tools/lk bun bd --version` | **not run**. Cannot pass (1 and 2 below). **On disk**: the attempts of 2026-09-30 13:09 and 17:43 did not link |
| check | `/workspace/tools/lk cargo check -p bun_ast -p bun_options_types -p bun_lint -p bun_runtime --message-format=short` | **not run**. Cannot pass (1 and 2) |
| clippy | `/workspace/tools/lk cargo clippy -p bun_lint` | **not run**. Cannot pass (1) |
| fmt | `cargo fmt -p bun_lint -- --check` | rustfmt **run** on the files of the commit: cannot pass (1). Each of the 21 files is formatted (section 5) |
| tests of the unit | `/workspace/tools/lk bun bd test test/cli/lint/lint.test.ts`, and the same for `test/cli/lint/diagnostics.test.ts`, `test/cli/lint/rules.test.ts`, `test/cli/run/as-node.test.ts`, `test/cli/env/bun-options.test.ts` | **not run**. They need the build, and 3 |
| Rust tests | `MIRIFLAGS=-Zmiri-tree-borrows /workspace/tools/lk cargo miri test -p bun_ast --lib msg_code_tests`, and `-p bun_lint --lib` | **not run**. The second cannot pass (1) |

What stops them, **read** in the files of `a0165c2db5` (`git show a0165c2db5:<path>`):

1. `src/lint/rules/mod.rs` declares eleven modules and the commit has five of the files. Missing:
   `no_compare_neg_zero`, `no_debugger`, `no_duplicate_case`, `no_empty_pattern`, `no_sparse_arrays`,
   `no_unsafe_negation`. `bun_lint` does not compile, and `bun_runtime` depends on it.
2. `Metadata::Code` has no arm in `src/jsc/VirtualMachine.rs:3612`, `src/jsc/lib.rs:1379` and
   `src/runtime/server/DevErrorPage.rs:159`. `bun_jsc` and `bun_runtime` do not compile (`NEEDS.md` X2).
3. The flag is not there: no line of `src/runtime/cli/Arguments.rs` or `src/options_types/context.rs` has `lint`,
   and `src/runtime/cli/mod.rs` does not declare `lint_command`. With 1 and 2 solved a build of this commit would
   still run `x.ts` for `bun --lint x.ts`, as P1 does.
4. `scripts/rust-miri.ts` has no `bun_lint` in `MIRI_CRATES` (`NEEDS.md` X3).

Eleven commits landed while this entry was written. By their subjects most of them are about 1 and 3. They were
not read for this entry and nothing of them was run, so the table above is not about them:

| time | commit | subject |
| --- | --- | --- |
| 19:47:59 | `e1a33c353f` | lint: add the rule no-compare-neg-zero |
| 19:48:16 | `0eb4275454` | lint: add the hidden flag --lint, read ahead of bunfig into the context |
| 19:52:05 | `c66d1abf17` | lint: refuse --lint among the flags of bunx, before the package name |
| 19:52:11 | `bfc03073e2` | lint: add the rule no-unsafe-negation |
| 19:58:12 | `dcbbd2db53` | lint: add the rule no-empty-pattern |
| 20:14:22 | `66bf3e151e` | lint: bun --lint checks its operands ahead of every run mode |
| 20:14:57 | `01db053fed` | lint: a compiled executable refuses --lint among its own options |
| 20:41:21 | `73933f7aa0` | lint: bun --lint refuses a token starting with `-` after the first file |
| 20:45:41 | `8358260034` | lint: refuse --lint unless BUN_FEATURE_FLAG_EXPERIMENTAL_LINT is on |
| 20:48:42 | `f53c4d9bd1` | lint: add the rule no-duplicate-case |
| 20:54:06 | `d6cf19f5dd` | lint: name ESLint's commit in UPSTREAM_PORTED, add its licence text |

### 9. Decisions of this entry, and what is open

Decisions:

1. The behaviour of e3566be889 was measured on the binary that was already linked, not through `bun bd`, and
   the binary is kept under `/tmp` (section 2).
2. The sizes were read from the debug information of the debug build, not with the probe (section 4).
3. rustfmt was run on the files of a commit outside the worktree, not `cargo fmt` inside it (section 5).
4. The rulings of C1, C2 and C3 are not repeated here. They are in `API.md` ("The command `bun --lint` (rulings
   of C1)", "Diagnostic code on `bun_ast::Msg`", "What `bun --lint` prints", "Rules and ESLint: every deliberate
   difference") and the requests in `NEEDS.md` (X2, X3).

Open:

1. The green baseline of the two test files (section 7). It needs the kept binary, so it comes before the next
   restart of the machine and before `/tmp` is cleaned.
2. Every gate of section 8. The first run of each goes into "Gate results" with its wall time and its output.
   For `cargo check` and `cargo clippy` that is also the first record of what they print and how long they take:
   the runs of 2026-09-29 left none (section 5).
3. `size_of::<Metadata>()` with bare cargo and with `--release`, and `size_of::<Msg>()` with `--release`
   (section 4).
4. Whether the native test executable of `bun_ast` links at e3566be889 (section 6).
5. `API.md`, "State of the tree", says it was read at `e8031ec9ce`. Under "Not in the tree" it has
   "`lint_command.rs` does not call `bun_lint::lint` and does not call `Parser::parse_only`", and at `a0165c2db5`
   `src/runtime/cli/lint_command.rs:161` is `parser.parse_only(|tree| bun_lint::lint(file, tree, source, &arena))`
   (since `7dd3e55437`). With the commits of section 8 on top, that section needs a new reading.
6. This file is committed on the notes branch and not pushed. `/workspace/tools/save-notes "cli: LOG.md"` pushes
   it; it also stages every other change under `/workspace/notes`.

## Gate results

One row for each run of a gate, newest last. "Commit" is the commit whose files were measured; say so when the
worktree had other changes.

| when | commit | gate | command | wall | result |
| --- | --- | --- | --- | --- | --- |
| 2026-09-30 19:39 | `a0165c2db5`, its files in `/tmp` | fmt of `bun_lint` | `rustfmt --check --edition 2024 src/lint/lib.rs` | 1.3 s | exit 1: the file of the module `no_compare_neg_zero` does not exist |
| 2026-09-30 19:40 | `a0165c2db5`, its files in `/tmp` | fmt, file by file | `rustfmt --check --edition 2024 --config skip_children=true <file>` for 21 files | 18.6 s | 21 of 21 exit 0 |

No other gate has been run for this log: build, `cargo check`, `cargo clippy`, the `bun:test` files and the Rust
tests have no row yet.
