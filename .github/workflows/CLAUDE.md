# GitHub Actions Workflow Maintenance Guide

This document provides guidance for maintaining the GitHub Actions workflows in this repository.

## format.yml Workflow

### Overview
The `format.yml` workflow runs code formatters (Prettier, clang-format, and Zig fmt) on pull requests and pushes to main. It's optimized for speed by running all formatters in parallel.

### Key Components

#### 1. Clang-format Script (`scripts/run-clang-format.sh`)
- **Purpose**: Formats C++ source and header files
- **What it does**:
  - Reads C++ files from `cmake/sources/CxxSources.txt`
  - Finds all header files in `src/` and `packages/`
  - Excludes third-party directories (libuv, napi, deps, vendor, sqlite, etc.)
  - Requires specific clang-format version (no fallbacks)

**Important exclusions**:
- `src/napi/` - Node API headers (third-party)
- `src/bun.js/bindings/libuv/` - libuv headers (third-party)
- `src/bun.js/bindings/sqlite/` - SQLite headers (third-party)
- `src/bun.js/api/ffi-*.h` - FFI headers (generated/third-party)
- `src/deps/` - Dependencies (third-party)
- Files in `vendor/`, `third_party/`, `generated/` directories

#### 2. Parallel Execution
The workflow runs all three formatters simultaneously:
- Each formatter outputs with a prefix (`[prettier]`, `[clang-format]`, `[zig]`)
- Output is streamed in real-time without blocking
- Uses GitHub Actions groups (`::group::`) for collapsible sections

#### 3. Tool Installation

##### Clang-format-19
- Installs ONLY `clang-format-19` package (not the entire LLVM toolchain)
- Uses `--no-install-recommends --no-install-suggests` to skip unnecessary packages
- Quiet installation with `-qq` and `-o=Dpkg::Use-Pty=0`

##### Zig
- Downloads from `oven-sh/zig` releases (musl build for static linking)
- URL: `https://github.com/oven-sh/zig/releases/download/autobuild-{COMMIT}/bootstrap-x86_64-linux-musl.zip`
- Extracts to temp directory to avoid polluting the repository
- Directory structure: `bootstrap-x86_64-linux-musl/zig`

### Updating the Workflow

#### To update Zig version:
1. Find the new commit hash from https://github.com/oven-sh/zig/releases
2. Replace the hash in the wget URL (line 65 of format.yml)
3. Test that the URL is valid and the binary works

#### To update clang-format version:
1. Update `LLVM_VERSION_MAJOR` environment variable at the top of format.yml
2. Update the version check in `scripts/run-clang-format.sh`

#### To add/remove file exclusions:
1. Edit the exclusion patterns in `scripts/run-clang-format.sh` (lines 34-39)
2. Test locally to ensure the right files are being formatted

### Performance Optimizations
1. **Parallel execution**: All formatters run simultaneously
2. **Minimal installations**: Only required packages, no extras
3. **Temp directories**: Tools downloaded to temp dirs, cleaned up after use
4. **Streaming output**: Real-time feedback without buffering
5. **Early start**: Formatting begins immediately after each tool is ready

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
- The musl Zig build works on glibc systems due to static linking
- Keep the exclusion list updated as new third-party code is added