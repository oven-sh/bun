# bssl-sys bindings

`bun_usockets` depends on the vendored `bssl-sys` crate
(`vendor/boringssl/rust/bssl-sys`) as its raw BoringSSL layer
(.rewrite-specs/tls-semantics.md Part 2d; api.md CHANGES 1). Upstream generates
its bindings with bindgen at CMake time and links its own BoringSSL build —
neither exists in Bun's build. Instead,
`patches/boringssl/bssl-sys-prebuilt-bindings.patch` replaces the crate's
`build.rs` with one that runs bindgen (the crate, pinned `=0.72.1` as a
build-dependency) at build time:

- The Rust bindings are written to cargo's `OUT_DIR/bindgen.rs` and consumed
  through the crate's `BINDGEN_RS_FILE` escape hatch (`bssl-sys/src/lib.rs`,
  `--cfg bindgen_rs_file`). Nothing is committed; each `--target` gets its own
  bindings, generated from the vendored headers. No link directives are
  emitted — BoringSSL objects are compiled by `scripts/build/deps/boringssl.ts`
  and resolve at final-binary link, exactly like the hand-written
  `bun_boringssl_sys` externs (both binding crates coexist against the same
  objects).
- Cross-target `cargo check` (`bun run rust:check-all`) parses against
  hermetic headers keyed off the cargo `TARGET`: vendor/zig's bundled libc set
  (linux gnu/musl/android, freebsd), a macOS SDK (`MACOS_SDK` or
  `MACOS_SDK_PATH`, default newest `$HOME/.bun/build-cache/MacOSX*.sdk`, or
  `xcrun` on a macOS host), or an MSVC/UCRT xwin splat (`WINSYSROOT`, default
  `/opt/winsysroot`). A missing sysroot fails with a message naming the env
  var to set. bindgen loads libclang at runtime (clang-sys); if it isn't
  found automatically, set `LIBCLANG_PATH` to your LLVM lib dir.

## `wrapper.c` — the one committed artifact

The bindgen `--wrap-static-fns` shim (`*__extern` symbols for BoringSSL's
static-inline functions) must be **compiled into the BoringSSL objects**, so
`scripts/build/deps/boringssl.ts` needs it as a real file, not an `OUT_DIR`
artifact: this one file stays committed. That choice (over having build.rs
`cc`-compile it into a shim lib) keeps the C build path unchanged and the
bssl-sys crate link-directive-free.

It is byte-identical across targets and changes only on BoringSSL or bindgen
bumps. Staleness is enforced twice:

- `boringssl.ts` verifies at configure time that the `BORINGSSL_COMMIT` stamp
  in its first line matches the pinned commit.
- `build.rs` regenerates the shim on every build and fails if it differs from
  the committed copy (this also enforces cross-target byte-identity in CI).

## Regenerating

Re-run **`regenerate.sh`** on every BoringSSL commit bump (`BORINGSSL_COMMIT`
in `scripts/build/deps/boringssl.ts`) or bindgen version bump (pinned in the
patch). It refetches the vendored sources at the new pin and runs
`BSSL_SYS_UPDATE_WRAPPER_C=1 cargo check -p bun_usockets`, which makes
build.rs overwrite the committed `wrapper.c` instead of failing on drift.
