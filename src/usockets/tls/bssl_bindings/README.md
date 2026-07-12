# Pre-generated bssl-sys bindings

`bun_usockets` depends on the vendored `bssl-sys` crate
(`vendor/boringssl/rust/bssl-sys`) as its raw BoringSSL layer
(.rewrite-specs/tls-semantics.md Part 2d; api.md CHANGES 1). Upstream generates
its bindings with bindgen at CMake time and links its own BoringSSL build —
neither exists in Bun's build. Instead:

- **`wrapper_<target>.rs`** — bindgen output per Rust target triple, committed
  here and consumed through the crate's `BINDGEN_RS_FILE` escape hatch
  (`bssl-sys/src/lib.rs`, `--cfg bindgen_rs_file`). The escape-hatch plumbing
  lives in `patches/boringssl/bssl-sys-prebuilt-bindings.patch`, which replaces
  the crate's `build.rs` with one that sets the cfg + env var and emits **no
  link directives** — BoringSSL objects are compiled by
  `scripts/build/deps/boringssl.ts` and resolve at final-binary link, exactly
  like the hand-written `bun_boringssl_sys` externs (both binding crates
  coexist against the same objects; signatures agree because headers and
  `rust/` tree come from the same pinned commit).
- **`wrapper.c`** — the bindgen `--wrap-static-fns` shims (`*__extern` symbols
  for BoringSSL's static-inline functions). Byte-identical across targets
  (`regenerate.sh` enforces this); compiled once as part of the boringssl dep
  in `scripts/build/deps/boringssl.ts`. The header list from
  `bssl-sys/wrapper.h` is inlined so it builds with only
  `-I vendor/boringssl/include`; `extern "C"` guards keep the symbol names
  unmangled under the dep's `lang: "cxx"` compile.
- **`regenerate.sh`** — regenerates everything above. **Must be re-run on
  every BoringSSL commit bump** (`BORINGSSL_COMMIT` in
  `scripts/build/deps/boringssl.ts`); fold into the upgrade-boringssl flow.
  Staleness is enforced mechanically: the script stamps `BORINGSSL_COMMIT`
  into the first line of every generated file, and `boringssl.ts` verifies
  the stamps at configure time — a bump that skips regeneration fails
  `bun run build` with a re-run instruction instead of silently compiling
  bindings from the old headers.
  Requires `bindgen` (cargo install bindgen-cli; generated with 0.72.1) and
  hermetic libc headers: vendor/zig's bundled set (linux gnu/musl), a macOS
  SDK, and an MSVC/UCRT splat (see the script header for env overrides).

Decision (tls-semantics.md OQ-4/OQ-5): bindings are vendored outputs rather
than a build-time bindgen step — no bindgen/libclang toolchain dependency in
the build, and the committed diff makes fork drift reviewable on bumps.
