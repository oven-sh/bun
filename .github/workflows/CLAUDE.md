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

##### Clang-format-21

- Installs ONLY `clang-format-21` package (not the entire LLVM toolchain)
- Uses `--no-install-recommends --no-install-suggests` to skip unnecessary packages
- Quiet installation with `-qq` and `-o=Dpkg::Use-Pty=0`

##### Rustfmt

- The pinned nightly is set via `RUSTUP_TOOLCHAIN` in the step `env:` (kept in sync with `channel` in `rust-toolchain.toml`); `cargo fmt --all` runs against the workspace at the repo root.
- `RUSTUP_TOOLCHAIN` makes rustup ignore `rust-toolchain.toml` entirely, so the workflow installs only the host toolchain + `rustfmt` (`rustup toolchain install --profile minimal --component rustfmt`) rather than the file's full cross-target list.

### Updating the Workflow

#### To update the Rust toolchain:

1. Bump `channel` in `rust-toolchain.toml` (and `Dockerfile`/`bootstrap.sh` to match).
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
export LLVM_VERSION_MAJOR=19
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

Four independent jobs that each run one cargo command over the Rust workspace. They share `.github/actions/rust-lint-setup`, a composite action that installs LLVM from apt.llvm.org (configure resolves a clang even though nothing here compiles C++), Bun, optionally a pinned Rust toolchain plus components, runs `bun install`, then `bun scripts/build.ts --configure-only` and the ninja targets a job asks for: `clone-lolhtml clone-rust-argon2` (cargo cannot resolve the workspace until the vendored `lol_html` and `rust-argon2` path dependencies exist) and, for jobs that check `bun_runtime`/`bun_jsc`/`bun_core`, `codegen` (their `include!()`d sources under `build/debug/codegen`).

| Job       | Check name            | Runs                                                        | Blocking                       |
| --------- | --------------------- | ----------------------------------------------------------- | ------------------------------ |
| `clippy`  | `cargo clippy`        | `bun run rust:clippy`                                       | yes                            |
| `miri`    | `cargo miri test`     | `bun run rust:miri` (`scripts/rust-miri.ts`)                | yes                            |
| `lolhtml` | `lol-html cargo test` | `cargo test` in `vendor/lolhtml`                            | yes                            |
| `mordant` | `mordant`             | `cargo dylint --manifest-path Cargo.toml --all --workspace` | advisory (`continue-on-error`) |

- `clippy`, `miri` and `lolhtml` pin `RUSTUP_TOOLCHAIN` at the workflow level (kept in sync with `channel` in `rust-toolchain.toml`) so rustup does not install that file's cross-target list; the action installs the toolchain with `--profile minimal` plus the components the job names (`clippy`, `miri rust-src`, none).
- `lolhtml` exists because the vendored lol-html is a fork (oven-sh/lol-html, `bun` branch) whose own test suite is the only thing guarding the fork's invariants. It used to trigger only on `scripts/build/deps/lolhtml.ts`; it now shares the workflow's wider path filter.
- `mordant` runs the [mordant](https://github.com/scarletindustries/mordant) dylint pack. It sets `RUSTUP_TOOLCHAIN: stable` instead: mordant is built with, and lints us using, the nightly named in its own rust-toolchain file, which dylint fetches on demand, so the outer cargo only needs to exist. Because that nightly is older than ours, the job passes `-A unknown_lints` through `DYLINT_RUSTFLAGS`. Two caches cover the slow parts: `~/.cargo/bin/{cargo-dylint,dylint-link}` keyed on `DYLINT_VERSION`, and `~/.dylint_drivers` + `target/dylint/libraries` keyed on `DYLINT_VERSION` plus the pinned mordant rev read out of `Cargo.toml`. It is skipped on `merge_group`.

### mordant: pin, baseline, disabled lints

- The pack is pinned by commit in `Cargo.toml` under `[workspace.metadata.dylint]`. A bump can also fail if this workspace stops compiling on mordant's nightly.
- `dylint.toml`'s `[mordant]` table points `baseline` at `mordant-baseline.toml` (per-(lint, file) counts of the findings that predate the job) and lists the lints this repo has switched off under `disabled`, each with its reason.
- In baseline mode mordant prints findings over the baseline as warnings and writes them to `target/mordant/over-baseline.txt` (relative to the workspace root). The job deletes that file, runs dylint, and fails if the file is non-empty; absent or empty means clean. Fixing baselined findings needs no baseline update.
- The invocation passes `--manifest-path Cargo.toml` even though that is the default. Without it, dylint turns a failing `cargo metadata` (for example a manifest that the merge with main broke) into a warning, finds no libraries, and exits 0, which the over-baseline check above reads as clean. With it, dylint propagates the cargo error and the step fails.
- Locally, `bun run rust:mordant` is the same dylint invocation and `bun run rust:mordant:baseline` regenerates the baseline (`MORDANT_BASELINE_WRITE=1`). Both need `cargo install cargo-dylint dylint-link` once, and expect `build/debug/codegen`, `vendor/lolhtml` and `vendor/rust-argon2` to exist, which any normal `bun bd` leaves behind.

To bump mordant: change the `rev` in `Cargo.toml`, run `bun run rust:mordant`, fix what the new revision reports or regenerate `mordant-baseline.toml` with `bun run rust:mordant:baseline`, and put the triage in the PR description.
