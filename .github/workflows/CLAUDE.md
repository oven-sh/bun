# GitHub Actions Workflow Maintenance Guide

This document provides guidance for maintaining the GitHub Actions workflows in this repository.

## format.yml Workflow

### Overview

The `format.yml` workflow runs code formatters (Prettier, clang-format, and `cargo fmt`) on pull requests and pushes to main. It's optimized for speed by running all formatters in parallel. It also regenerates the checked-in `*.generated.rs` string maps (`bun run codegen:string-maps`) before the formatters start: everything the step leaves modified, formatting or codegen, is what the autofix.ci action at the end of the job pushes back to the PR (failing the run when it had anything to push), so nothing that produces fixes may run after it, and nothing that only verifies should run before it.

### Key Components

#### 1. Clang-format Script (`scripts/run-clang-format.sh`)

- **Purpose**: Formats C++ source and header files
- **What it does**:
  - Globs C++ files via `bun scripts/glob-sources.ts cxx`
  - Finds all header files in `src/` and `packages/`
  - Excludes third-party directories (libuv, napi, deps, vendor, sqlite, etc.)
  - Requires specific clang-format version (no fallbacks)

**Important exclusions**:

- `src/runtime/napi/` - Node API headers (third-party)
- `src/jsc/bindings/libuv/` - libuv headers (third-party)
- `src/jsc/bindings/sqlite/` - SQLite headers (third-party)
- `src/runtime/ffi/ffi-*.h` - FFI headers (generated/third-party)
- `src/deps/` - Dependencies (third-party)
- Files in `vendor/`, `third_party/`, `generated/` directories

#### 2. Parallel Execution

The workflow runs all three formatters simultaneously:

- Each formatter outputs with a prefix (`[prettier]`, `[clang-format]`, `[rustfmt]`)
- Output is streamed in real-time without blocking
- Uses GitHub Actions groups (`::group::`) for collapsible sections

#### 3. Tool Installation

##### Clang-format-23

- Installs ONLY `clang-format-23` package (not the entire LLVM toolchain)
- Uses `--no-install-recommends --no-install-suggests` to skip unnecessary packages
- Quiet installation with `-qq` and `-o=Dpkg::Use-Pty=0`

##### Rustfmt

- The pinned nightly is set via `RUSTUP_TOOLCHAIN` in the step `env:` (kept in sync with `channel` in `rust-toolchain.toml`); `cargo fmt --all` runs against the workspace at the repo root.
- `RUSTUP_TOOLCHAIN` makes rustup ignore `rust-toolchain.toml` entirely, so the workflow installs only the host toolchain + `rustfmt` (`rustup toolchain install --profile minimal --component rustfmt`) rather than the file's full cross-target list.

### Updating the Workflow

#### To update the Rust toolchain:

1. Bump `channel` in `rust-toolchain.toml`.
2. Bump `RUSTUP_TOOLCHAIN` in the `Format Code` step's `env:` block in `format.yml` to the same value.
3. Bump `RUSTUP_TOOLCHAIN` in the workflow-level `env:` block in `rust-lints.yml` to the same value.
4. `cargo fmt` formatting can change between nightlies; run `cargo fmt --all` locally on the new toolchain and include the resulting diff in the same PR.

#### To update clang-format version:

1. Update `LLVM_VERSION_MAJOR` environment variable at the top of format.yml
2. Update the version check in `scripts/run-clang-format.sh`

#### To add/remove file exclusions:

1. Edit the exclusion patterns in `scripts/run-clang-format.sh` (lines 34-39)
2. Test locally to ensure the right files are being formatted

### Performance Optimizations

1. **Parallel execution**: All formatters run simultaneously
2. **Minimal installations**: Only required packages, no extras
3. **Streaming output**: Real-time feedback without buffering
4. **Early start**: Formatting begins immediately after each tool is ready

### Troubleshooting

**If formatters appear to run sequentially:**

- Check if output is being buffered (should use `sed` for line prefixing)
- Ensure background processes use `&` and proper wait commands

**If third-party files are being formatted:**

- Review exclusion patterns in `scripts/run-clang-format.sh`
- Check if new third-party directories were added that need exclusion

**If clang-format installation is slow:**

- Ensure using minimal package installation flags
- Check if apt cache needs updating
- Consider caching the clang-format binary between runs

### Testing Changes Locally

```bash
# Test the clang-format script
export LLVM_VERSION_MAJOR=23
./scripts/run-clang-format.sh format

# Test with check mode (no modifications)
./scripts/run-clang-format.sh check

# Test specific file exclusions
./scripts/run-clang-format.sh format 2>&1 | grep -E "(libuv|napi|deps)"
# Should return nothing if exclusions work correctly
```

### Important Notes

- The script defaults to **format** mode (modifies files)
- Always test locally before pushing workflow changes
- Keep the exclusion list updated as new third-party code is added

## rust-lints.yml Workflow

Four independent jobs over the Rust workspace. They share `.github/actions/rust-lint-setup`, a composite action that installs LLVM from apt.llvm.org (configure resolves a clang even though nothing here compiles C++), Bun, optionally a pinned Rust toolchain plus components, runs `bun install`, then `bun scripts/build.ts --configure-only` and the ninja targets a job asks for: `clone-lolhtml clone-rust-argon2` (cargo cannot resolve the workspace until the vendored `lol_html` and `rust-argon2` path dependencies exist) and, for jobs that check `bun_runtime`/`bun_jsc`/`bun_core`, `codegen` (their `include!()`d sources under `build/debug/codegen`).

| Job       | Check name            | Runs                                                                | Blocking                       |
| --------- | --------------------- | ------------------------------------------------------------------- | ------------------------------ |
| `clippy`  | `cargo clippy`        | `bun run rust:clippy`, then `cargo check --workspace --all-targets` | yes                            |
| `miri`    | `cargo miri test`     | `bun run rust:miri` (`scripts/rust-miri.ts`)                        | yes                            |
| `lolhtml` | `lol-html cargo test` | `cargo test` in `vendor/lolhtml`                                    | yes                            |
| `mordant` | `mordant`             | `bun run rust:mordant`                                              | advisory (`continue-on-error`) |

- `clippy` lints the default targets only (lib and bin): test code was never held to the clippy lint set. Its second step, `cargo check --workspace --all-targets`, type-checks `#[cfg(test)]` code, `tests/` and `benches/` so they keep compiling. Nothing else builds them except the crates `rust:miri` runs.
- `clippy`, `miri` and `lolhtml` pin `RUSTUP_TOOLCHAIN` at the workflow level (kept in sync with `channel` in `rust-toolchain.toml`) so rustup does not install that file's cross-target list; the action installs the toolchain with `--profile minimal` plus the components the job names (`clippy`, `miri rust-src`, none).
- `lolhtml` exists because the vendored lol-html is a fork (oven-sh/lol-html, `bun` branch) whose own test suite is the only thing guarding the fork's invariants. It used to trigger only on `scripts/build/deps/lolhtml.ts`; it now shares the workflow's wider path filter.
- `mordant` runs the [mordant](https://github.com/scarletindustries/mordant) lint pack as an advisory (`continue-on-error`) job. Mordant is not a dylint library any more: it ships its own runner, the way clippy does. `cargo mordant` is `cargo check` with `mordant-driver` (rustc with the lints linked in) as `RUSTC_WORKSPACE_WRAPPER`, and it builds into `target/mordant/check`. The shared action installs mordant's nightly (`MORDANT_TOOLCHAIN`) with `rustc-dev` and `llvm-tools-preview`, and every cargo call in the job names it (`cargo +"$MORDANT_TOOLCHAIN" …`): `cargo install --locked --git … --rev "$MORDANT_REV"` builds the two binaries with it, and `scripts/rust-mordant.ts` runs `cargo mordant` under it. It is not spelled `RUSTUP_TOOLCHAIN` because `test/internal/source-lints/ci-image-pins.test.ts` holds every `RUSTUP_TOOLCHAIN: nightly-…` in a workflow to the channel in `rust-toolchain.toml`, and this one moves with mordant instead. One cache covers them: `~/.cargo/bin/{cargo-mordant,mordant-driver}`, keyed on the nightly and the rev. The job restores it with `actions/cache/restore` and saves it with `actions/cache/save` right after the build, because the post step of `actions/cache` does not run in a job that failed, and a pull request with a finding over the baseline would then build mordant again on every push. Because that nightly is older than ours, the script passes `-A unknown_lints` through `MORDANT_RUSTFLAGS`. It is skipped on `merge_group`.
- Mordant's nightly is the compiler that checks this workspace while the lints run, so it must still be able to compile it. When a `rust-toolchain.toml` bump brings in an API that nightly lacks, the job fails on every PR until mordant moves to a newer nightly and the pin here follows. #42851 was one: the job was off from then until mordant moved to 2026-09-01.

### mordant: pin, baseline, disabled lints

- The pin is two values in the `mordant` job's `env:`: `MORDANT_REV` (a mordant commit) and `MORDANT_TOOLCHAIN` (the nightly in mordant's `rust-toolchain` file at that commit).
- `dylint.toml` keeps the name it had when mordant was a dylint library. Mordant reads only its `[mordant]` table, which points `baseline` at `mordant-baseline.toml` (per-(lint, file) counts of the findings that predate the job) and lists the lints this repo has switched off under `disabled`, each with its reason.
- In baseline mode mordant prints findings over the baseline as warnings and writes them to `target/mordant/over-baseline.txt` (relative to the workspace root). The job deletes that file, runs `cargo mordant`, and fails if the file is non-empty; absent or empty means clean. Fixing baselined findings needs no baseline update.
- `unused_pub` is the one lint that `cargo mordant` decides itself, after cargo is done. Each compilation records the `pub` items it defines and the workspace items it uses under `target/mordant/unused_pub/`, and `cargo mordant` judges the records of the units the run built. Its baseline entries sit in the section of the crate that defines the item. A use counts only from a target the run builds, and a member is judged only when the run leaves out no member that depends on it: a run under `-p` says little, and the job and the scripts pass `--workspace`. `scripts/rust-mordant.ts` names three triples (`x86_64-unknown-linux-gnu`, `x86_64-pc-windows-msvc`, `aarch64-apple-darwin`), so a use under `cfg(windows)` or `cfg(target_os = "macos")` counts; the host must be named too, since any `--target` drops it. The job and both package.json scripts go through that file, so the list is in one place. The job does not pass `--all-targets`, so an item that only tests use is reported. Passing it needs every test target in the workspace to compile on mordant's nightly, which no other CI job checks.
- The baseline file and `MORDANT_BASELINE_WRITE` are inputs of every member's compilation: mordant's driver names them in the dep-info. So a baseline write, or a change to `mordant-baseline.toml`, re-lints every member on the next run, and a warm `target/mordant/check` is safe to keep. One thing differs on a warm run where nothing changed: cargo replays a crate's warnings and does not run the driver, so that crate does not append to `over-baseline.txt` again (`unused_pub` is judged again on every run). Locally, read the warnings. The file is for CI, which always starts cold.
- Every other lint is counted per rustc process, so a file compiled under three triples is weighed against its recorded count three times, not summed. A baseline write is different: each process rewrites its crate's whole section, so over several `--target`s the last target to finish a crate wins and an entry only another target sees can be dropped. So `bun run rust:mordant:baseline` does not write in one run: the script writes one baseline per target, keeps the largest count for each entry, and takes the `unused_pub` entries from a fourth run over all three targets, the only kind that sees every use. Four runs, about four minutes on 16 cores.
- Locally, `bun run rust:mordant` is the same invocation and `bun run rust:mordant:baseline` regenerates the baseline. Both need mordant installed once, with the two values from the job's `env:`: `rustup toolchain install <MORDANT_TOOLCHAIN> --profile minimal --component rustc-dev --component llvm-tools-preview`, then `cargo +<MORDANT_TOOLCHAIN> install --locked --git https://github.com/scarletindustries/mordant --rev <MORDANT_REV>`. `cargo mordant --version` prints the commit of the installed build. The script adds the three targets' std to that toolchain itself (`rustup target add`). Both also expect `build/debug/codegen`, `vendor/lolhtml` and `vendor/rust-argon2` to exist, which any normal `bun bd` leaves behind.

To bump mordant: change `MORDANT_REV` (and `MORDANT_TOOLCHAIN`, when mordant's `rust-toolchain` file changed) in `rust-lints.yml`, install that build locally, run `bun run rust:mordant`, fix what the new revision reports or regenerate `mordant-baseline.toml` with `bun run rust:mordant:baseline`, and put the triage in the PR description.
