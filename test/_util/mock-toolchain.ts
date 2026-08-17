/**
 * Fake `Toolchain`s for driving scripts/build's `resolveConfig()` from tests.
 * None of the paths exist: resolveConfig() records them without running
 * anything, so the build-script tests run on hosts with no LLVM installed.
 *
 * Every `Toolchain` field is populated, so adding a field to the interface is
 * a type error here and nowhere else; test/internal/source-lints/
 * mock-toolchain.test.ts checks the same thing at runtime, since the test
 * tree is not type-checked in CI.
 */
import type { Toolchain } from "../../scripts/build/config.ts";

/**
 * What `resolveLlvmToolchain()` (scripts/build/tools.ts) finds on a Linux host
 * with a complete LLVM install, as used for native linux targets and for
 * darwin cross-compiles: GNU `strip` is the default strip, and the optional
 * Mach-O tools (ld64.lld, llvm-strip, dsymutil) are all present. Tools that
 * are only resolved for windows targets are absent.
 */
export function mockToolchain(overrides: Partial<Toolchain> = {}): Toolchain {
  const toolchain: Toolchain = {
    cc: "/fake/llvm/bin/clang",
    cxx: "/fake/llvm/bin/clang++",
    hostCc: undefined,
    hostCxx: undefined,
    // The LLVM_VERSION pin in scripts/build/tools.ts. rustc's LLVM is kept a
    // major ahead of it: the tests that set `rustLld` rely on that skew to
    // make resolveConfig() swap rust-lld in as `ld`.
    clangVersion: "21.1.8",
    clangResourceDir: "/fake/llvm/lib/clang/21",
    ar: "/fake/llvm/bin/llvm-ar",
    ranlib: "/fake/llvm/bin/llvm-ranlib",
    ld: "/fake/llvm/bin/ld.lld",
    ld64Lld: "/fake/llvm/bin/ld64.lld",
    rustLld: undefined,
    rustLlvmVersion: "22.1.4",
    rustSysroot: undefined,
    rustHostTriple: undefined,
    strip: "/fake/bin/strip",
    llvmStrip: "/fake/llvm/bin/llvm-strip",
    dsymutil: "/fake/llvm/bin/dsymutil",
    bun: "/fake/bin/bun",
    jsRuntime: "/fake/bin/bun",
    esbuild: "/fake/bin/esbuild",
    ccache: undefined,
    cmake: "/fake/bin/cmake",
    cargo: undefined,
    cargoHome: undefined,
    rustupHome: undefined,
    msvcLinker: undefined,
    rc: undefined,
    mt: undefined,
    nasm: undefined,
  };
  return { ...toolchain, ...overrides };
}

/**
 * The same host resolving a windows target: `resolveLlvmToolchain()` switches
 * to the MSVC-flavored tool family (clang-cl, llvm-lib, lld-link, llvm-rc,
 * llvm-mt, nasm), keeps plain clang/clang++ as the host compilers, and skips
 * the resource-dir probe. Everything host-side is inherited from
 * `mockToolchain()`.
 */
export function mockWindowsCrossToolchain(overrides: Partial<Toolchain> = {}): Toolchain {
  return mockToolchain({
    cc: "/fake/llvm/bin/clang-cl",
    cxx: "/fake/llvm/bin/clang-cl",
    hostCc: "/fake/llvm/bin/clang",
    hostCxx: "/fake/llvm/bin/clang++",
    clangResourceDir: undefined,
    ar: "/fake/llvm/bin/llvm-lib",
    ld: "/fake/llvm/bin/lld-link",
    rc: "/fake/llvm/bin/llvm-rc",
    mt: "/fake/llvm/bin/llvm-mt",
    nasm: "/fake/bin/nasm",
    ...overrides,
  });
}
