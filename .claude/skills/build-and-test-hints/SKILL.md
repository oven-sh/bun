---
name: build-and-test-hints
description: Hints for building and testing when toolchain version mismatches block compilation. Covers mise for C/C++ toolchains and cargo +stable for Rust.
---

# Build and Test Hints

Use when a build fails due to a toolchain version mismatch (too new, too old, or wrong channel).

## C/C++ toolchain via mise

When a project requires a specific clang/gcc version and the system compiler doesn't match:

```bash
# List available versions
mise ls-remote clang | grep "21\."

# Install and pin to the project (creates/mutates mise.toml)
mise use clang@21.1.8 -y

# Verify it's active (must eval mise activate first)
eval "$(mise activate bash)" && clang --version
```

The installed binary lives at `~/.local/share/mise/installs/clang/<version>/.mise-bins/clang`.

mise installs a complete conda-based toolchain including `ar`, `ld`, `nm`, `objcopy`, `ranlib` — not just the compiler frontend.

### Notes

- `mise use` writes to `mise.toml` in the project root, so the pin is per-project.
- You may need `eval "$(mise activate bash)"` in non-interactive shells; bare `which clang` may still resolve to the system compiler.
- `lld` is NOT included in the conda clang package; only `ld` (BFD linker) is provided.

## Rust: cargo +stable

When a project has a `rust-toolchain.toml` that pins an older version, bare `cargo` triggers a rustup download that can time out or fail. Use `cargo +stable` to skip it:

```bash
# Check system Rust version
rustc --version

# If system >= pinned, use +stable
cargo +stable test -p <crate>
cargo +stable fmt -- --check
cargo +stable clippy --tests -p <crate>

# One-shot environment variable alternative
RUSTUP_TOOLCHAIN=stable cargo test -p <crate>
```

Use `cargo +stable` as the default. Only fall back to the pinned toolchain when `+stable` causes compilation errors on newer editions/features.
