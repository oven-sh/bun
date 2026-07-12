#!/usr/bin/env bash
# Refreshes the committed bssl-sys --wrap-static-fns shim (wrapper.c). Re-run
# on every BoringSSL commit bump (BORINGSSL_COMMIT in
# scripts/build/deps/boringssl.ts) or bindgen bump (pinned in
# patches/boringssl/bssl-sys-prebuilt-bindings.patch) — see README.md.
#
# The Rust bindings themselves are generated into cargo's OUT_DIR at build
# time by the patched vendored bssl-sys build.rs; wrapper.c is the only
# committed artifact (it must be compiled into the BoringSSL objects).
set -euo pipefail

BUN_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"

# Refetch vendor/boringssl at the pinned commit (also re-applies the patch).
(cd "$BUN_ROOT" && bun run build --target=clone-boringssl)

# build.rs regenerates the shim every build; this env makes it overwrite the
# committed copy instead of failing on drift. Host target suffices — build.rs
# enforces cross-target byte-identity on every other target's build.
(cd "$BUN_ROOT" && BSSL_SYS_UPDATE_WRAPPER_C=1 cargo check -p bun_usockets)

echo "updated src/usockets/tls/bssl_bindings/wrapper.c:"
head -1 "$BUN_ROOT/src/usockets/tls/bssl_bindings/wrapper.c"
