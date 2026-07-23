/**
 * Compiler, linker, and define flags for the bun target.
 *
 * Design: ONE flat table per flag category. Each entry has a `when` predicate
 * and a `desc`. To find out why a flag is set, grep for it in this file.
 * Related flags (e.g. `-fno-unwind-tables` + `--no-eh-frame-hdr` + strip
 * `-R .eh_frame`) live adjacent so their coupling is obvious.
 *
 * Note: dependency include paths (WebKit, boringssl, etc.) are NOT here —
 * they come from each dep's `Provides.includes`. This file covers only flags
 * that apply uniformly to bun's own C/C++ sources.
 */

import { join } from "node:path";
import { bunExeName, type Config } from "./config.ts";
import { quote, slash } from "./shell.ts";
import { ucrtServicingLibDir } from "./winsysroot.ts";

export type FlagValue = string | string[] | ((cfg: Config) => string | string[]);

/**
 * Main-thread stack size for darwin executables (18 MB — JSC's interpreter
 * and the bundler's visitor recursion both go deep). Passed to the linker as
 * `-Wl,-stack_size` on native darwin links; ld64.lld parses but doesn't
 * implement that option, so cross links additionally patch LC_MAIN.stacksize
 * post-link with the same value (shims/macho-postlink.c). Keep in sync with
 * the Windows `/STACK:` reserve and the Linux `-z stack-size` below.
 */
export const DARWIN_STACK_SIZE = "0x1200000";

export interface Flag {
  /** Flag(s) to emit. Can be a function for flags that interpolate config values. */
  flag: FlagValue;
  /** Predicate. Omitted = always. */
  when?: (cfg: Config) => boolean;
  /** Restrict to one language. Omitted = both C and C++. */
  lang?: "c" | "cxx";
  /** What this flag does. Used by `--explain-flags`. */
  desc: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// CPU TARGET FLAGS
//   -march/-mcpu/-mtune. Split out so deps that manage their own optimization
//   and sanitizer flags (WebKit) can still inherit the target arch without
//   the rest of globalFlags.
// ═══════════════════════════════════════════════════════════════════════════

export const cpuTargetFlags: Flag[] = [
  {
    flag: "-mcpu=apple-m1",
    when: c => c.darwin && c.arm64,
    desc: "Target Apple M1 (works on all Apple Silicon)",
  },
  {
    flag: ["-march=armv8-a+crc", "-mtune=ampere1"],
    when: c => (c.linux || c.freebsd) && c.arm64 && c.abi !== "android",
    desc: "ARM64 Linux/FreeBSD: ARMv8-A base + CRC, tuned for Ampere (Graviton-like)",
  },
  {
    flag: ["-march=armv8-a+crc", "-mtune=cortex-a78"],
    when: c => c.linux && c.arm64 && c.abi === "android",
    desc: "ARM64 Android: ARMv8-A base + CRC, tuned for Cortex-A78 (common big core)",
  },
  {
    flag: ["/clang:-march=armv8-a+crc", "/clang:-mtune=ampere1"],
    when: c => c.windows && c.arm64,
    desc: "ARM64 Windows: clang-cl prefix required (/clang: passes to clang)",
  },
  {
    flag: "-march=nehalem",
    when: c => c.x64,
    desc: "x64: Nehalem (2008) — no AVX, broadest compatibility",
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL COMPILER FLAGS
//   Applied to BOTH bun's own sources AND forwarded to vendored deps
//   via -DCMAKE_C_FLAGS / -DCMAKE_CXX_FLAGS.
// ═══════════════════════════════════════════════════════════════════════════

export const globalFlags: Flag[] = [
  // ─── Cross-compilation target/sysroot ───
  // Generic — currently only Android sets these. Kept first so the
  // target triple is in effect before any arch-dependent flags.
  {
    flag: c => `--target=${c.crossTarget!}`,
    when: c => c.crossTarget !== undefined,
    desc: "Cross-compile target triple (clang is inherently a cross-compiler)",
  },
  {
    flag: c => `--sysroot=${c.sysroot!}`,
    when: c => c.sysroot !== undefined,
    desc: "Cross-compile sysroot (target libc headers + libs)",
  },
  {
    // Windows cross-compile: clang-cl can't read the VS dev shell's INCLUDE
    // env on a non-Windows host. /winsysroot points it at an xwin-style
    // splat laid out like a VS install (VC/Tools/MSVC + Windows Kits/10),
    // covering the MSVC CRT/STL and Windows SDK headers + import libs.
    // The lld-link equivalent (/winsysroot:) is added in linkerFlags below.
    flag: c => ["/winsysroot", quote(c.winsysroot!, false)],
    when: c => c.windows && c.winsysroot !== undefined,
    desc: "Windows cross-compile: MSVC CRT + Windows SDK root (xwin splat)",
  },
  {
    // Same host-GCC #include_next leak as the FreeBSD block below: on
    // amazonlinux, clang's driver injects /usr/include/c++/N even with
    // --sysroot. -nostdlibinc drops all default system include paths
    // (keeping clang's resource dir) and we add back only the NDK's three
    // dirs in the order #include_next expects: libc++ → per-arch bionic
    // → generic bionic.
    flag: c => [
      "-nostdlibinc",
      "-isystem",
      join(c.sysroot!, "usr", "include", "c++", "v1"),
      "-isystem",
      join(c.sysroot!, "usr", "include", c.arm64 ? "aarch64-linux-android" : "x86_64-linux-android"),
      "-isystem",
      join(c.sysroot!, "usr", "include"),
    ],
    when: c => c.abi === "android",
    lang: "cxx",
    desc: "Android: explicit NDK include paths only (suppress host GCC C++ detection)",
  },
  {
    flag: ["-DANDROID", "-D_FILE_OFFSET_BITS=64"],
    when: c => c.abi === "android",
    desc: "Android: platform define + 64-bit off_t (bionic defaults to 32-bit on LP32)",
  },
  {
    // On hosts with a GCC install (amazonlinux), clang's driver auto-detects
    // it and injects /usr/include/c++/N into the search list — even with
    // --sysroot, --gcc-toolchain, and -nostdinc++. That breaks #include_next
    // in the sysroot's libc++ headers. -nostdlibinc drops ALL standard system
    // include paths (host AND sysroot defaults) while keeping clang's own
    // resource dir (stddef.h etc.); we then add back only the two sysroot
    // dirs in the correct order so #include_next from c++/v1 finds usr/include.
    flag: c => [
      "-nostdlibinc",
      "-isystem",
      join(c.sysroot!, "usr", "include", "c++", "v1"),
      "-isystem",
      join(c.sysroot!, "usr", "include"),
    ],
    when: c => c.freebsd && c.sysroot !== undefined,
    lang: "cxx",
    desc: "FreeBSD: explicit sysroot include paths only (suppress host GCC C++ detection)",
  },
  {
    // C compiles don't have the host-C++-path leak, so --sysroot's default
    // search is fine — but it omits __BSD_VISIBLE when no feature-test macro
    // is set on some clang configs. Match what FreeBSD's own cc does.
    flag: "-D__BSD_VISIBLE=1",
    when: c => c.freebsd,
    desc: "FreeBSD: expose BSD typedefs (u_long etc.) in <sys/types.h>",
  },
  {
    // macOS cross-compile: C++ must see Apple's libc++ from the SDK and
    // nothing from the build host. Left to its defaults, clang prefers its
    // own toolchain libc++ headers (<llvm>/include/c++/v1) — a newer libc++
    // than the OS dylib the SDK's libc++.tbd describes, so compiles pick up
    // out-of-line symbols (e.g. std::__hash_memory, added in libc++ 19) that
    // Apple's libc++ never exports → undefined symbols at link. On CI images
    // with a host GCC install the driver also injects the host's
    // /usr/include/c++/N and /usr/include into the search list (the FreeBSD
    // block above documents the same behaviour; -nostdlibinc alone did not
    // stop it there either), which breaks the SDK headers' #include_next
    // chains. So drop every default include dir (-nostdinc) and rebuild the
    // exact list Apple's own driver uses: SDK libc++ → clang builtins → SDK
    // libc → SDK frameworks. Native darwin builds keep the default search.
    flag: c => [
      "-nostdinc",
      "-isystem",
      join(c.osxSysroot!, "usr", "include", "c++", "v1"),
      "-isystem",
      join(c.clangResourceDir!, "include"),
      "-isystem",
      join(c.osxSysroot!, "usr", "include"),
      "-iframework",
      join(c.osxSysroot!, "System", "Library", "Frameworks"),
    ],
    when: c =>
      c.darwin && c.crossTarget !== undefined && c.osxSysroot !== undefined && c.clangResourceDir !== undefined,
    lang: "cxx",
    desc: "macOS cross: only the SDK's (Apple) libc++/libc/framework headers + clang builtins",
  },

  {
    // Emit the address-significance table (__DATA,__llvm_addrsig) so
    // ld64.lld's --icf=safe knows which functions never have their address
    // taken and can be folded without breaking pointer-identity comparisons
    // (the same table -faddrsig emits by default on ELF for the Linux
    // -Wl,-icf=safe). Cross-only: lld consumes the section and drops it
    // from the output, but Apple's ld doesn't know it and would copy ~8
    // bytes of dead __DATA per TU into the native binary — and `strip`
    // won't remove a regular data section post-link. Flip the predicate to
    // plain `c.darwin` once someone confirms on a Mac that Apple's ld
    // discards it.
    flag: "-faddrsig",
    when: c => c.darwin && c.crossTarget !== undefined,
    desc: "macOS cross: address-significance table for the linker's safe ICF",
  },

  // ─── CPU target ───
  ...cpuTargetFlags,
  {
    // CMake auto-added these via CMAKE_OSX_DEPLOYMENT_TARGET/CMAKE_OSX_SYSROOT;
    // we must add explicitly. Without this, clang/ld64 default to the host SDK
    // version — CI builds get minos=15.0, breaking macOS 13/14 users at launch.
    flag: c => [`-mmacosx-version-min=${c.osxDeploymentTarget!}`, "-isysroot", c.osxSysroot!],
    when: c => c.darwin && c.osxDeploymentTarget !== undefined && c.osxSysroot !== undefined,
    desc: "macOS deployment target + SDK (sets LC_BUILD_VERSION minos)",
  },

  // ─── MSVC runtime (Windows) ───
  {
    flag: "/MTd",
    when: c => c.windows && c.debug,
    desc: "Static debug MSVC runtime",
  },
  {
    flag: "/MT",
    when: c => c.windows && c.release,
    desc: "Static MSVC runtime",
  },
  {
    flag: "/U_DLL",
    when: c => c.windows,
    desc: "Undefine _DLL (we link statically)",
  },

  // ─── Optimization ───
  {
    // cmake's Release/RelWithDebInfo build types append this to
    // CMAKE_<LANG>_FLAGS_<TYPE> automatically; nested-cmake deps got it
    // from there. Direct deps only see globalFlags, so it must be here
    // too — otherwise every assert() in zstd/boringssl/mimalloc/etc.
    // stays live in release. (bun's own NDEBUG in `defines` below is
    // redundant after this, but harmless.)
    flag: "-DNDEBUG",
    when: c => c.release,
    desc: "Disable libc assert() (release builds, direct deps included)",
  },
  {
    flag: "-O0",
    when: c => c.unix && c.debug,
    desc: "No optimization (debug)",
  },
  {
    flag: "/Od",
    when: c => c.windows && c.debug,
    desc: "No optimization (debug)",
  },
  {
    flag: "-Os",
    when: c => c.unix && c.smol,
    desc: "Optimize for size (MinSizeRel)",
  },
  {
    flag: "/Os",
    when: c => c.windows && c.smol,
    desc: "Optimize for size (MinSizeRel)",
  },
  {
    flag: "-O3",
    when: c => c.unix && c.release && !c.smol,
    desc: "Optimize for speed",
  },
  {
    flag: "/O2",
    when: c => c.windows && c.release && !c.smol,
    desc: "Optimize for speed (MSVC /O2 ≈ clang -O2)",
  },

  // ─── Debug info ───
  {
    flag: "/Z7",
    when: c => c.windows,
    desc: "Emit debug info into .obj (no .pdb during compile)",
  },
  {
    flag: "-gdwarf-4",
    when: c => c.darwin,
    desc: "DWARF 4 debug info (dsymutil-compatible)",
  },
  {
    // Nix LLVM doesn't support zstd — but we target standard distros.
    // Nix users can override via profile if needed.
    flag: ["-g3", "-gz=zstd"],
    when: c => c.unix && c.debug,
    desc: "Full debug info, zstd-compressed",
  },
  {
    flag: "-g1",
    when: c => c.unix && c.release,
    desc: "Minimal debug info for backtraces",
  },
  {
    flag: "-glldb",
    when: c => c.unix,
    desc: "Tune debug info for LLDB",
  },

  // ─── ASAN (global — passed to deps so they link against the same runtime) ───
  // Unlike UBSan (bun-target-only below), ASAN must be global: the runtime
  // library has to match across all linked objects or you get crashes at init.
  {
    flag: "-fsanitize=address",
    when: c => c.asan,
    desc: "AddressSanitizer (also forwarded to deps for ABI consistency)",
  },

  // ─── C++ language behavior ───
  {
    flag: "-fno-exceptions",
    when: c => c.unix,
    desc: "Disable C++ exceptions",
  },
  {
    flag: "/EHs-c-",
    when: c => c.windows,
    desc: "Disable C++ exceptions (MSVC: s- disables C++, c- disables C)",
  },
  {
    flag: "-fno-c++-static-destructors",
    when: c => c.unix,
    lang: "cxx",
    desc: "Skip static destructors at exit (JSC assumes this)",
  },
  {
    // /clang: (not -Xclang): single token survives CMAKE_CXX_FLAGS
    // re-tokenization in nested dep configures. -Xclang <arg> pair gets
    // split by cmake's try_compile → "unknown argument". Also more correct:
    // /clang: passes to the driver, -Xclang to cc1.
    flag: "/clang:-fno-c++-static-destructors",
    when: c => c.windows,
    lang: "cxx",
    desc: "Skip static destructors at exit (clang-cl syntax)",
  },
  {
    flag: "-fno-rtti",
    when: c => c.unix,
    desc: "Disable RTTI (no dynamic_cast/typeid)",
  },
  {
    flag: "/GR-",
    when: c => c.windows,
    desc: "Disable RTTI (MSVC syntax)",
  },

  // ─── Frame pointers (needed for profiling/backtraces) ───
  {
    flag: ["-fno-omit-frame-pointer", "-mno-omit-leaf-frame-pointer"],
    when: c => c.unix,
    desc: "Keep frame pointers (for profiling and backtraces)",
  },
  {
    flag: "/Oy-",
    when: c => c.windows,
    desc: "Keep frame pointers",
  },

  // ─── Visibility ───
  {
    flag: ["-fvisibility=hidden", "-fvisibility-inlines-hidden"],
    when: c => c.unix,
    desc: "Hidden symbol visibility (explicit exports only)",
  },

  // ─── Unwinding / exception tables ───
  // These go together: -fno-unwind-tables at compile, --no-eh-frame-hdr at
  // link (release glibc), and strip -R .eh_frame at post-link (release glibc).
  // See linkerFlags and stripFlags below — kept adjacent intentionally.
  {
    flag: ["-fno-unwind-tables", "-fno-asynchronous-unwind-tables"],
    when: c => c.unix,
    desc: "Skip unwind tables (we don't use C++ exceptions)",
  },
  {
    // libuv stubs use C23 anonymous parameters
    flag: "-Wno-c23-extensions",
    when: c => c.unix,
    desc: "Allow C23 extensions (libuv stubs use anonymous parameters)",
  },

  // ─── Sections (enables dead-code stripping at link) ───
  {
    flag: "-ffunction-sections",
    when: c => c.unix,
    desc: "One section per function (for --gc-sections)",
  },
  {
    flag: "/Gy",
    when: c => c.windows,
    desc: "One section per function (COMDAT folding)",
  },
  {
    flag: "-fdata-sections",
    when: c => c.unix,
    desc: "One section per data item (for --gc-sections)",
  },
  {
    flag: "/Gw",
    when: c => c.windows,
    desc: "One section per data item",
  },
  {
    // Address-significance table: enables safe ICF at link.
    // Macos debug mode + this flag breaks libarchive configure ("pid_t doesn't exist").
    // darwin cross targets get this from their own entry above (debug and
    // release), so skip them here rather than emit the flag twice.
    flag: "-faddrsig",
    when: c => (c.debug && c.linux) || (c.release && c.unix && !(c.darwin && c.crossTarget !== undefined)),
    desc: "Emit address-significance table (enables safe ICF)",
  },

  // ─── Windows-specific codegen ───
  {
    flag: "/GF",
    when: c => c.windows,
    desc: "String pooling (merge identical string literals)",
  },
  {
    flag: "/GA",
    when: c => c.windows,
    desc: "Optimize TLS access (assume vars defined in executable)",
  },

  // ─── Linux-specific codegen ───
  {
    flag: "-fno-semantic-interposition",
    when: c => c.linux,
    desc: "Assume no symbol interposition (enables more inlining across TUs)",
  },

  // ─── Hardening (assertions builds) ───
  {
    flag: "-fno-delete-null-pointer-checks",
    when: c => c.assertions,
    desc: "Don't optimize out null checks (hardening)",
  },

  // ─── Diagnostics ───
  {
    flag: "-fdiagnostics-color=always",
    when: c => c.unix,
    desc: "Colored compiler errors",
  },
  {
    flag: "-ferror-limit=100",
    when: c => c.unix,
    desc: "Stop after 100 errors",
  },
  {
    flag: "/clang:-ferror-limit=100",
    when: c => c.windows,
    desc: "Stop after 100 errors (clang-cl syntax)",
  },

  // ─── LTO (compile-side) ───
  {
    // Thin, not full: each .o carries a per-module summary so the link runs
    // the LTO backends in parallel (and could cache them) instead of merging
    // every module into one serial multi-gigabyte regular-LTO partition. The
    // WebKit macos -lto prebuilts and rustc's -Clinker-plugin-lto bitcode are
    // both ThinLTO-summaried, so this makes the whole link one uniform
    // ThinLTO graph with cross-module importing across C++/Rust/JSC
    // boundaries. All platforms now use ThinLTO (the linux JSC ThinLTO
    // miscompile was fixed in the WebKit prebuilt).
    flag: "-flto=thin",
    when: c => c.unix && c.lto,
    desc: "Thin link-time optimization",
  },
  {
    // Windows (cross) uses ThinLTO like darwin: clang-cl accepts -flto=thin
    // directly (core option), the WebKit windows-amd64-lto prebuilt is
    // ThinLTO-summaried bitcode, and rustc's -Clinker-plugin-lto bitcode is
    // too, so lld-link runs one uniform ThinLTO graph with cross-language
    // importing. lld-link does LTO automatically when it sees bitcode
    // inputs — no link-side -flto spelling exists or is needed there.
    flag: "-flto=thin",
    when: c => c.windows && c.lto,
    desc: "Thin link-time optimization (clang-cl)",
  },
  {
    // Unix only (not windows): on COFF, whole-program vtable opt drops
    // vtable symbols that associative COMDAT sections still name as their
    // parent and the LTO codegen aborts ("Associative COMDAT symbol
    // '??_7...' does not exist"). The WebKit windows-amd64-lto prebuilt is
    // built without it for the same reason.
    flag: ["-fforce-emit-vtables", "-fwhole-program-vtables"],
    when: c => c.unix && c.lto,
    lang: "cxx",
    desc: "Enable devirtualization across whole program (LTO only)",
  },
  {
    // Every summaried bitcode module in the link must agree on the
    // EnableSplitLTOUnit flag or lld dies with "inconsistent LTO Unit
    // splitting". -fwhole-program-vtables (above) defaults the split ON for
    // C++ on ELF targets but it's a cxx-only flag, so the C modules (zlib,
    // c-ares, mimalloc, boringssl's .c files, ...) would disagree. Force it
    // OFF everywhere instead of on: split LTO units shunt every module's
    // vtables + type metadata into a merged regular-LTO half — a serial
    // merged module, which is exactly what ThinLTO is supposed to avoid.
    // The type hierarchy goes into the per-module ThinLTO summaries instead
    // (typeidCompatibleVTable entries) and whole-program devirtualization
    // runs in index-based mode via --lto-whole-program-visibility at link
    // time. 0 is also the default for rustc, for Apple targets, and for the
    // WebKit -lto prebuilts, so this is the configuration that can't drift.
    flag: "-fno-split-lto-unit",
    when: c => c.lto,
    desc: "Index-based WPD: keep type metadata in the ThinLTO summaries, no regular-LTO half",
  },

  // ─── PGO (compile-side) ───
  {
    flag: c => `-fprofile-generate=${c.pgoGenerate}`,
    when: c => c.unix && !!c.pgoGenerate,
    desc: "IR PGO: instrument for profile generation",
  },
  {
    flag: c => [
      `-fprofile-use=${c.pgoUse}`,
      "-Wno-profile-instr-out-of-date",
      "-Wno-profile-instr-unprofiled",
      "-Wno-backend-plugin",
    ],
    when: c => c.unix && !!c.pgoUse,
    desc: "IR PGO: optimize with profile data",
  },

  // ─── Path remapping (CI reproducibility) ───
  {
    flag: c => [
      `-ffile-prefix-map=${c.cwd}=.`,
      `-ffile-prefix-map=${c.vendorDir}=vendor`,
      `-ffile-prefix-map=${c.cacheDir}=cache`,
    ],
    when: c => c.unix && c.ci,
    desc: "Remap source paths in debug info (reproducible builds)",
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// BUN-ONLY COMPILER FLAGS
//   Applied ONLY to bun's own .c/.cpp files, NOT forwarded to deps.
//   This is where -Werror, sanitizer flags, and bun-specific tweaks live.
// ═══════════════════════════════════════════════════════════════════════════

export const bunOnlyFlags: Flag[] = [
  // ─── Build profiling ───
  {
    flag: "-ftime-trace",
    when: c => c.timeTrace,
    lang: "cxx",
    desc: "Emit per-TU Chrome-trace JSON next to each .o (analyze with ClangBuildAnalyzer)",
  },

  // ─── Language standard ───
  // WebKit uses gnu++ extensions on Linux; if we don't match, the first
  // memory allocation crashes (ABI mismatch in sized delete).
  // Not in globalFlags because deps set their own standard.
  {
    flag: "-std=gnu++23",
    when: c => c.linux || c.freebsd,
    lang: "cxx",
    desc: "C++23 with GNU extensions (required to match WebKit's ABI on Linux/FreeBSD)",
  },
  {
    flag: "-std=c++23",
    when: c => c.darwin,
    lang: "cxx",
    desc: "C++23 standard",
  },
  {
    flag: "/std:c++23preview",
    when: c => c.windows,
    lang: "cxx",
    desc: "C++23 standard (MSVC flag for clang-cl)",
  },
  // C standard: gnu17 on unix (cmake: C_STANDARD 17 with C_EXTENSIONS
  // default ON → -std=gnu17). Can't go to C23 — MSVC doesn't support it.
  // Most .c files are usockets/llhttp which would compile fine without,
  // but explicit is better than compiler-default drift.
  {
    flag: "-std=gnu17",
    when: c => c.unix,
    lang: "c",
    desc: "C17 with GNU extensions (matches cmake's C_STANDARD 17 + default C_EXTENSIONS)",
  },
  {
    flag: "/std:c17",
    when: c => c.windows,
    lang: "c",
    desc: "C17 standard (MSVC-mode flag for clang-cl; no GNU extensions in MSVC mode)",
  },

  // ─── Sanitizers (bun only — deps would break with -Werror + UBSan) ───
  // Note: -fsanitize=address is in globalFlags (deps need ABI consistency).
  // UBSan is bun-only because it's stricter and vendored code often violates it.
  // Enabled: debug builds (non-musl — musl's implementation hits false positives),
  // and release-asan builds (if you're debugging memory you want UBSan too).
  // Darwin cross-compiles are excluded: the UBSan runtime dylib for macOS
  // isn't shipped by the Linux LLVM toolchain, so the link would fail.
  {
    flag: [
      "-fsanitize=null",
      "-fno-sanitize-recover=all",
      "-fsanitize=bounds",
      "-fsanitize=return",
      "-fsanitize=nullability-arg",
      "-fsanitize=nullability-assign",
      "-fsanitize=nullability-return",
      "-fsanitize=returns-nonnull-attribute",
      "-fsanitize=unreachable",
    ],
    when: c =>
      c.unix &&
      !(c.darwin && c.crossTarget !== undefined) &&
      ((c.debug && c.abi !== "musl" && c.abi !== "android" && !c.freebsd) || (c.release && c.asan)),
    desc: "Undefined-behavior sanitizers",
  },
  {
    flag: ["-fsanitize-coverage=trace-pc-guard", "-DFUZZILLI_ENABLED"],
    when: c => c.fuzzilli,
    desc: "Fuzzilli coverage instrumentation",
  },

  // ─── Bun-target-specific ───
  {
    flag: ["-fconstexpr-steps=6000000", "-fconstexpr-depth=54"],
    when: c => c.unix,
    lang: "cxx",
    desc: "Raise constexpr limits (JSC uses heavy constexpr; the embedded module registry literals are large)",
  },
  {
    flag: ["-fno-pic", "-fno-pie"],
    when: c => c.unix && c.abi !== "android",
    desc: "No position-independent code (we're a final executable)",
  },
  {
    flag: "-fPIC",
    when: c => c.abi === "android",
    desc: "Android requires PIE since API 21; bionic's loader rejects non-PIE",
  },

  // ─── Warnings-as-errors (unix) ───
  {
    flag: [
      "-Werror=return-type",
      "-Werror=return-stack-address",
      "-Werror=implicit-function-declaration",
      "-Werror=uninitialized",
      "-Werror=conditional-uninitialized",
      "-Werror=suspicious-memaccess",
      "-Werror=int-conversion",
      "-Werror=nonnull",
      "-Werror=move",
      "-Werror=sometimes-uninitialized",
      "-Wno-c++23-lambda-attributes",
      "-Wno-nullability-completeness",
      "-Wno-character-conversion",
      "-Werror",
    ],
    when: c => c.unix,
    desc: "Treat most warnings as errors; suppress known-noisy ones",
  },
  {
    // Debug adds -Werror=unused; release omits it (vars used only in ASSERT)
    flag: ["-Werror=unused", "-Wno-unused-function"],
    when: c => c.unix && c.debug,
    desc: "Warn on unused vars in debug (catches dead code)",
  },
  {
    // Windows: suppress noisy warnings from headers we don't control
    flag: [
      "-Wno-nullability-completeness",
      "-Wno-inconsistent-dllimport",
      "-Wno-incompatible-pointer-types",
      "-Wno-deprecated-declarations",
      "-Wno-character-conversion",
    ],
    when: c => c.windows,
    desc: "Suppress noisy warnings from system/dependency headers",
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// PREPROCESSOR DEFINES
//   -D flags passed to every bun compilation unit.
// ═══════════════════════════════════════════════════════════════════════════

export const defines: Flag[] = [
  // ─── Always on ───
  {
    flag: [
      "_HAS_EXCEPTIONS=0",
      "LIBUS_USE_OPENSSL=1",
      "LIBUS_USE_BORINGSSL=1",
      "WITH_BORINGSSL=1",
      "STATICALLY_LINKED_WITH_JavaScriptCore=1",
      "STATICALLY_LINKED_WITH_BMALLOC=1",
      "BUILDING_WITH_CMAKE=1",
      "JSC_OBJC_API_ENABLED=0",
      "BUN_SINGLE_THREADED_PER_VM_ENTRY_SCOPE=1",
      "NAPI_EXPERIMENTAL=ON",
      "NOMINMAX",
      "IS_BUILD",
      "BUILDING_JSCONLY__",
    ],
    desc: "Core bun defines (always on)",
  },
  {
    // Shell-escaped quotes so clang receives literal quotes in the define
    // (the preprocessor needs the string to be "26.3.0", not bare 26.3.0).
    flag: c => `REPORTED_NODEJS_VERSION=\\"${c.nodejsVersion}\\"`,
    desc: "Node.js version string reported by process.version",
  },
  {
    flag: c => `REPORTED_NODEJS_ABI_VERSION=${c.nodejsAbiVersion}`,
    desc: "Node.js ABI version (process.versions.modules)",
  },
  {
    flag: c => `REPORTED_NODEJS_V8_VERSION=\\"${c.nodejsV8Version}\\"`,
    desc: "V8 version string (process.versions.v8)",
  },
  {
    // Hardcoded ON — experimental flag not exposed in config
    flag: "USE_BUN_MIMALLOC=1",
    desc: "Use mimalloc as default allocator",
  },

  // ─── Config-dependent ───
  {
    flag: "ASSERT_ENABLED=1",
    when: c => c.assertions,
    desc: "Enable runtime assertions",
  },
  {
    flag: "BUN_DEBUG=1",
    when: c => c.debug,
    desc: "Enable debug-only code paths",
  },
  {
    flag: "LIBUS_SOCKET_FAULT_INJECTION=1",
    when: c => c.socketFaultInjection,
    desc: "Compile usockets bsd_* syscall fault-injection hooks (runtime-armed via bun:internal-for-testing)",
  },
  {
    // slash(): path becomes a C string literal — `\U` would be a unicode escape.
    flag: c => `BUN_DYNAMIC_JS_LOAD_PATH=\\"${slash(join(c.buildDir, "js"))}\\"`,
    when: c => c.debug && !c.ci,
    desc: "Hot-reload built-in JS from build dir (dev convenience)",
  },
  {
    // Standard define that disables assert() in libc headers. CMake adds
    // this automatically for Release builds; we do it explicitly.
    flag: "NDEBUG",
    when: c => c.release,
    desc: "Disable libc assert() (release builds)",
  },

  // ─── Platform ───
  {
    flag: "_DARWIN_NON_CANCELABLE=1",
    when: c => c.darwin,
    desc: "Use non-cancelable POSIX calls on Darwin",
  },
  {
    flag: ["WIN32", "_WINDOWS", "WIN32_LEAN_AND_MEAN=1", "_CRT_SECURE_NO_WARNINGS", "BORINGSSL_NO_CXX=1"],
    when: c => c.windows,
    desc: "Standard Windows defines + disable CRT security warnings",
  },
  {
    flag: "U_STATIC_IMPLEMENTATION",
    when: c => c.windows,
    desc: "ICU static linkage (without this: ABI mismatch → STATUS_STACK_BUFFER_OVERRUN)",
  },
  {
    flag: "U_DISABLE_RENAMING=1",
    when: c => c.darwin,
    desc: "Disable ICU symbol renaming (using system ICU)",
  },

  // ─── Feature toggles ───
  {
    flag: "LAZY_LOAD_SQLITE=0",
    when: c => c.staticSqlite,
    desc: "SQLite statically linked",
  },
  {
    flag: "LAZY_LOAD_SQLITE=1",
    when: c => !c.staticSqlite,
    desc: "SQLite loaded at runtime",
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// LINKER FLAGS
//   For the final bun executable link step only.
// ═══════════════════════════════════════════════════════════════════════════

export const linkerFlags: Flag[] = [
  // ─── Sanitizers ───
  {
    flag: "-fsanitize=address",
    when: c => c.unix && c.asan,
    desc: "Link ASAN runtime",
  },
  {
    flag: "-fsanitize=null",
    when: c =>
      c.unix &&
      c.debug &&
      c.abi !== "musl" &&
      c.abi !== "android" &&
      !c.freebsd &&
      !(c.darwin && c.crossTarget !== undefined),
    desc: "Link UBSan runtime",
  },
  {
    flag: "-fsanitize=null",
    when: c => c.unix && c.release && c.asan,
    desc: "Link UBSan runtime (release-asan)",
  },
  {
    // Unix links the sanitizer-coverage runtime; on Windows the two
    // trace-pc-guard callbacks are provided by CoverageWindows.cpp, so
    // nothing extra is linked.
    flag: "-fsanitize-coverage=trace-pc-guard",
    when: c => c.fuzzilli && c.unix,
    desc: "Link fuzzilli coverage runtime",
  },

  // ─── LTO (link-side) ───
  {
    // Whole-program devirtualization needs two things: the type hierarchy in
    // the ThinLTO summaries (compile-side -fwhole-program-vtables with
    // -fno-split-lto-unit) and the linker's assertion that every derived
    // class is visible in this link — without the visibility upgrade WPD
    // only fires for classes explicitly annotated [[clang::lto_visibility]],
    // i.e. never. A static executable that only dlopens C-ABI addons (NAPI)
    // satisfies the whole-program assumption. ld64.lld has no named option
    // for this; -mllvm reaches the underlying cl::opt directly.
    flag: ["-Wl,-mllvm,-whole-program-visibility"],
    when: c => c.darwin && c.lto,
    desc: "Enable index-based whole-program devirtualization at link time",
  },
  {
    // ELF spelling of the entry above. The WebKit -lto prebuilts carry the
    // !type/!vcall_visibility metadata (built with -fwhole-program-vtables),
    // so this upgrades JSC/WTF's exported classes to hidden LTO visibility
    // and lets WPD fire on them, not just on our -fvisibility=hidden classes.
    flag: ["-Wl,--lto-whole-program-visibility"],
    when: c => c.unix && !c.darwin && c.lto,
    desc: "Enable index-based whole-program devirtualization at link time (lld ELF)",
  },
  {
    flag: ["-flto=thin", "-fwhole-program-vtables", "-fforce-emit-vtables"],
    when: c => c.unix && c.lto,
    desc: "LTO at link time (matches compile-side -flto=thin)",
  },
  {
    // Without -O at link time, clang's driver defaults LTO codegen to -O2.
    // CMake implicitly forwarded CMAKE_CXX_FLAGS (incl. -O2) to the link line;
    // we must do so explicitly. Dropping this cost ~5 MB of .text on linux-x64
    // (less unrolling/inlining in JSC — measurable in Yarr, DFG, BuiltinNames).
    // ELF only: the driver forwards this to lld as -plugin-opt=O2. The Darwin
    // driver forwards no opt-level flag at all — see the next entry.
    flag: "-O2",
    when: c => c.unix && !c.darwin && c.lto && c.release && !c.smol,
    desc: "LTO codegen at -O2 (ELF: forwarded to lld as -plugin-opt=O2)",
  },
  {
    // The Darwin driver drops a bare -O at link time (`clang++ -### …` shows
    // no opt-level flag reaching the linker), so Mach-O LTO would codegen at
    // ld64.lld's built-in defaults: --lto-O2 for the IR pipeline and
    // --lto-CGO2 (CodeGenOptLevel::Default) for instruction selection —
    // inline threshold 225 and default isel, while the per-TU build codegens
    // everything at -O3 + CodeGenOptLevel::Aggressive (threshold 275). Pass
    // ld64.lld's own options so LTO codegen matches the compile side.
    // Cross links only: --lto-O/--lto-CGO are lld-specific, and only the
    // darwin cross link uses lld's Mach-O port (ld64.lld). Native darwin
    // links go through Apple's ld, which rejects unknown double-dash options,
    // so they keep the driver's default LTO codegen level.
    // arm64 only: O3 codegen costs +0.3 MB there but +3.1 MB on x64 (the
    // higher inline threshold is much more expensive in x86-64's
    // variable-length encoding); x64 stays at lld's default --lto-O2/CGO2.
    flag: ["-Wl,--lto-O3", "-Wl,--lto-CGO3"],
    when: c => c.darwin && c.arm64 && c.crossTarget !== undefined && c.lto && c.release && !c.smol,
    desc: "LTO codegen at -O3 + aggressive isel (Darwin driver forwards no -O to ld64.lld)",
  },
  {
    flag: "-Os",
    when: c => c.unix && c.lto && c.smol,
    desc: "LTO codegen at -Os (matches compile-side opt level)",
  },

  // ─── PGO (link-side) ───
  {
    flag: c => `-fprofile-generate=${c.pgoGenerate}`,
    when: c => c.unix && !!c.pgoGenerate,
    desc: "IR PGO: link profiling runtime",
  },
  {
    flag: c => `-fprofile-use=${c.pgoUse}`,
    when: c => c.unix && !!c.pgoUse,
    desc: "IR PGO: LTO+PGO at link time",
  },

  // ─── Windows ───
  {
    // Explicit machine type — clang-cl's driver does not reliably forward
    // its default target to lld-link when invoked as a pure link driver
    // (no source inputs, /link separator), so on arm64 lld-link would
    // autodetect x64 and reject every arm64 input. CMake's Windows-MSVC
    // platform module always set /machine: from CMAKE_SYSTEM_PROCESSOR,
    // which is why the pre-ninja build never needed this in BuildBun.cmake.
    flag: c => `/machine:${c.arm64 ? "arm64" : "x64"}`,
    when: c => c.windows,
    desc: "Target machine type for lld-link (required on arm64; x64 hosts default correctly but explicit is harmless)",
  },
  {
    // Serviced UCRT overlay: an explicit /libpath: is searched before the
    // /winsysroot-derived paths, so its libucrt.lib/ucrt.lib win over the
    // splat's stale copies (see UCRT_SERVICING_VERSION in winsysroot.ts —
    // the VS-manifest payload xwin downloads carries an ancient arm64 UCRT
    // with broken printf formatting).
    flag: c => quote(`/libpath:${ucrtServicingLibDir(c)!}`, false),
    when: c => c.windows && c.host.os !== "windows",
    desc: "Windows cross-compile: serviced Universal CRT static libs (SDK NuGet) override the splat's",
  },
  {
    // Windows cross-compile: these ldflags go after /link, straight to
    // lld-link, which doesn't see the compile-side `/winsysroot` from
    // globalFlags — repeat it in lld-link's own spelling so the MSVC CRT
    // and Windows SDK import libraries (libcmt, kernel32, ...) are found
    // without a VS dev shell's LIB env.
    flag: c => quote(`/winsysroot:${c.winsysroot!}`, false),
    when: c => c.windows && c.winsysroot !== undefined,
    desc: "Windows cross-compile: MSVC CRT + Windows SDK library search root (xwin splat)",
  },
  {
    flag: ["/STACK:0x1200000,0x200000", "/errorlimit:0"],
    when: c => c.windows,
    desc: "18MB stack reserve (JSC uses deep recursion), no error limit",
  },
  {
    flag: "/DEBUG:FULL",
    when: c => c.windows && c.debug,
    desc: "Emit PDB so the crash handler can symbolize stack traces",
  },
  {
    flag: [
      "/LTCG",
      "/OPT:REF",
      // SAFEICF (lld-specific) only folds functions whose address is never
      // taken (it honours .llvm_addrsig; objects without one — MSVC CRT
      // import libs, the prebuilt ICU data — are treated conservatively), so
      // JSC ClassInfo native constructors — stored as pointers and compared
      // for identity — stay distinct. /OPT:ICF (aggressive) folded
      // callBigIntConstructor with constructBigInt → "not a constructor",
      // and broke expect.any(Constructor); see commit 218430c731. Mirrors
      // Linux `-Wl,-icf=safe`.
      "/OPT:SAFEICF",
      // String-literal tail merging (lld-specific; MSVC link.exe has no
      // equivalent). Helps .rdata the same way --icf handles .rodata.cst on ELF.
      "/OPT:lldtailmerge",
      // 512-byte section file alignment (default is 4 KB). Was present in
      // the pre-ninja CMake config; harmless to page-in cost since sections
      // are few and large.
      "/FILEALIGN:0x200",
      "/DEBUG:FULL",
      "/delayload:ole32.dll",
      "/delayload:WINMM.dll",
      "/delayload:dbghelp.dll",
      "/delayload:WS2_32.dll",
      "/delayload:WSOCK32.dll",
      "/delayload:ADVAPI32.dll",
      "/delayload:IPHLPAPI.dll",
      "/delayload:CRYPT32.dll",
    ],
    when: c => c.windows && c.release,
    desc: "Release link opts + delay-load non-critical DLLs (faster startup)",
  },

  // ─── macOS ───
  {
    flag: ["-Wl,-no_compact_unwind", `-Wl,-stack_size,${DARWIN_STACK_SIZE}`, "-fno-keep-static-consts"],
    when: c => c.darwin,
    desc: "18MB stack, skip compact unwind",
  },
  {
    // Force the linker to reserve + emit LC_CODE_SIGNATURE on arm64 cross
    // links so the post-link fixup (shims/macho-postlink.c) has a signature
    // to replace after patching the stack size — arm64 macOS refuses to exec
    // unsigned binaries. x64 deliberately ships UNSIGNED, matching the
    // native x64 build (Apple's ld only auto-signs arm64; x64 macOS runs
    // unsigned binaries fine, an ad-hoc signature buys nothing there, and
    // the CodeDirectory costs 32 bytes per 4 KB page ≈ 0.8% of the binary).
    flag: "-Wl,-adhoc_codesign",
    when: c => c.darwin && c.crossTarget !== undefined && c.arm64,
    desc: "macOS arm64 cross-link: emit an ad-hoc LC_CODE_SIGNATURE for macho-postlink to replace",
  },
  {
    // `bun build --compile` grows the __BUN placeholder segment in place and
    // can only shift the one segment nothing references by address —
    // __LINKEDIT — so __BUN must be the last content segment. Apple's ld
    // orders known segments canonically (…, __DATA_DIRTY, __BUN, __LINKEDIT),
    // but ld64.lld orders unknown segments by creation order, and the
    // -sectcreate'd __BUN is created before the input objects' __DATA_DIRTY
    // is encountered — leaving __DATA_DIRTY *between* __BUN and __LINKEDIT.
    // Growing __BUN then overlaps it (`OverlappingSegments` from
    // src/exe_format/macho.rs). Fold __DATA_DIRTY into __DATA instead: it
    // holds a single 8-byte JSC::SourceProfiler hook and is only meaningful
    // as a dyld-shared-cache page-grouping hint, which executables don't use.
    flag: "-Wl,-rename_segment,__DATA_DIRTY,__DATA",
    when: c => c.darwin && c.crossTarget !== undefined,
    desc: "macOS cross-link: keep __BUN as the last content segment so `bun build --compile` can grow it",
  },
  {
    // Identical-code folding, on top of -dead_strip: dead_strip removes
    // unreferenced functions, ICF merges duplicate ones (template/bindgen
    // instantiations, mostly). `safe` only folds functions whose address is
    // never taken, per the -faddrsig table in globalFlags — the aggressive
    // mode is what folded callBigIntConstructor into constructBigInt on
    // Windows (/OPT:ICF) and broke `expect.any()`. Matches the Linux
    // release link's -Wl,-icf=safe. lld-only: Apple's ld has no ICF, so
    // this is a cross-only divergence (smaller binary than native). The
    // prebuilt WebKit archives are compiled with -faddrsig too, so WebKit
    // code participates in the folding.
    flag: "-Wl,--icf=safe",
    when: c => c.darwin && c.crossTarget !== undefined && c.release,
    desc: "macOS cross-link: fold identical address-insignificant functions",
  },
  {
    // -ld_new selects Apple's new linker — only meaningful (and only
    // understood) when Apple's ld driver does the link. ld64.lld (the
    // cross-link path) parses it as `-l d_new` and fails.
    flag: "-Wl,-ld_new",
    when: c => c.darwin && c.crossTarget === undefined,
    desc: "Use new Apple linker (native darwin links only)",
  },
  {
    // Cross-link from a non-darwin host: same pattern as Android/FreeBSD —
    // target triple + explicit linker. -isysroot is added by the deployment-
    // target flag below; the clang driver forwards it to ld64.lld as
    // -syslibroot. -mlinker-version≥520 makes the driver emit the modern
    // -platform_version argument ld64.lld requires (without it the driver
    // assumes an ancient host ld64 and emits nothing usable); the exact
    // value only gates driver behavior, so track a recent ld64 release.
    flag: c => [`--target=${c.crossTarget!}`, "-mlinker-version=705", `--ld-path=${c.ld}`],
    when: c => c.darwin && c.crossTarget !== undefined,
    desc: "macOS cross-link: target triple + ld64.lld + modern linker arg style",
  },
  {
    // The `__BUN,__bun` standalone-graph placeholder (c-bindings.cpp) is a
    // 16 KB-aligned section. On x86_64, ld64.lld 16K-aligns its FILE offset
    // inside a 4K-aligned segment but not its VM span, producing
    // filesize > vmsize for the __BUN segment — an invalid Mach-O that
    // llvm-strip/dsymutil (and codesign) reject. Capping the section's
    // alignment at the x86_64 page size removes the padding asymmetry; the
    // placeholder only needs 8-byte alignment at runtime, and
    // `bun build --compile` rewrites the segment at 16 KB alignment anyway
    // (exe_format/macho.rs). arm64 uses 16 KB pages, so it's unaffected.
    flag: ["-Wl,-sectalign,__BUN,__bun,0x1000"],
    when: c => c.darwin && c.crossTarget !== undefined && c.x64,
    desc: "macOS x64 cross-link: keep the __BUN segment's filesize ≤ vmsize under ld64.lld",
  },
  {
    // Must also be passed at link: ld64 reads this to write LC_BUILD_VERSION.minos.
    // Without it, ld64 defaults to the SDK version (15.0 on CI) → binary refuses
    // to launch on macOS 13/14. globalFlags doesn't flow to ldflags, so repeat here.
    flag: c => [`-mmacosx-version-min=${c.osxDeploymentTarget!}`, "-isysroot", c.osxSysroot!],
    when: c => c.darwin && c.osxDeploymentTarget !== undefined && c.osxSysroot !== undefined,
    desc: "macOS deployment target at link (sets LC_BUILD_VERSION minos)",
  },
  {
    flag: "-Wl,-w",
    when: c => c.darwin && c.debug,
    desc: "Suppress all linker warnings (workaround: no selective suppress for alignment warnings as of 2025-07)",
  },
  {
    flag: c => ["-dead_strip", "-dead_strip_dylibs", `-Wl,-map,${c.buildDir}/${bunExeName(c)}.linker-map`],
    when: c => c.darwin && c.release,
    desc: "Dead-code strip + emit linker map",
  },
  {
    // Mach-O keeps DWARF in the input .o files and records their paths in
    // the linked binary's debug map (N_OSO stabs); dsymutil follows the map
    // to build the .dSYM. Under LTO the "input objects" are temporaries the
    // linker deletes after the link, which would leave the debug map dangling
    // and the dSYM empty. -object_path_lto persists the LTO-codegen'd object
    // at a stable path inside the build dir and points the debug map at it.
    flag: c => `-Wl,-object_path_lto,${c.buildDir}/${bunExeName(c)}.lto.o`,
    when: c => c.darwin && c.lto,
    desc: "Persist the LTO-generated object so dsymutil can extract its DWARF into the dSYM",
  },

  // ─── Linux ───
  {
    flag: c => [`--target=${c.crossTarget!}`, `--sysroot=${c.sysroot!}`],
    when: c => c.linux && c.abi !== "android" && c.crossTarget !== undefined && c.sysroot !== undefined,
    desc: "linux sysroot link (gnu: ubuntu:20.04+gcc-13; musl: alpine)",
  },
  {
    // Wrap glibc symbols whose default version on the sysroot's glibc (2.31)
    // is > 2.17. Each __wrap_X in workaround-missing-symbols.cpp pins to the
    // 2.2.5/2.17 compat version (or a raw syscall) so the binary's verneed
    // never exceeds the floor.
    flag: [
      "exp",
      "exp2",
      "expf",
      "fcntl64",
      "getrandom",
      "gettid",
      "log",
      "log2",
      "log2f",
      "logf",
      "pow",
      "powf",
      "quick_exit",
      // libpthread/libdl → libc.so merge (2.32/2.34)
      "__libc_start_main",
      "__pthread_key_create",
      "dladdr",
      "dlerror",
      "dlsym",
      "dlvsym",
      "pthread_attr_setstack",
      "pthread_attr_setstacksize",
      "pthread_getattr_np",
      "pthread_getspecific",
      "pthread_key_create",
      "pthread_key_delete",
      "pthread_kill",
      "pthread_mutex_trylock",
      "pthread_mutexattr_destroy",
      "pthread_mutexattr_init",
      "pthread_mutexattr_settype",
      "pthread_once",
      "pthread_rwlock_destroy",
      "pthread_rwlock_rdlock",
      "pthread_rwlock_unlock",
      "pthread_rwlock_wrlock",
      "pthread_setspecific",
      // stat-family inline → real symbol (2.33)
      "fstat",
      "fstat64",
      "fstatat",
      "fstatat64",
      "mknod",
      // syscall wrappers (2.27/2.28)
      "copy_file_range",
      "memfd_create",
      "statx",
      // no older version (2.29/2.35)
      "_dl_find_object",
      "posix_spawn_file_actions_addchdir_np",
    ].map(s => `-Wl,--wrap=${s}`),
    when: c => c.linux && c.abi === "gnu",
    desc: "Wrap glibc 2.18+ symbols (portable down to glibc 2.17)",
  },
  {
    flag: ["-static-libstdc++", "-static-libgcc"],
    when: c => c.linux && c.abi === "gnu",
    desc: "Static C++ runtime (don't depend on host libstdc++)",
  },
  {
    flag: ["-lstdc++", "-lgcc"],
    when: c => c.linux && c.abi === "musl",
    desc: "Dynamic C++ runtime on musl (static unavailable)",
  },
  {
    flag: c => [
      `--target=${c.crossTarget!}`,
      `--sysroot=${c.sysroot!}`,
      "--rtlib=compiler-rt",
      "--unwindlib=libunwind",
      "-stdlib=libc++",
      "-static-libstdc++",
      // -l:libunwind.a (driver-emitted) searches -L paths; point at the NDK's
      // own per-arch runtime dir so it resolves regardless of resource-dir layout.
      `-L${join(c.androidNdkRuntimeDir!, c.arm64 ? "aarch64" : "x86_64")}`,
    ],
    when: c => c.linux && c.abi === "android",
    desc: "Android link: target/sysroot + compiler-rt/libunwind + static libc++",
  },
  {
    // Paired with compile-side -fno-unwind-tables above.
    // Gated on release (not LTO): the workspace is `panic = "abort"` and
    // C++ is `-fno-exceptions`/`-fno-unwind-tables`, so nothing unwinds at
    // runtime regardless of LTO. Backtraces walk frame pointers (forced on
    // both sides). Debug builds keep .eh_frame for gdb/libunwind.
    flag: "-Wl,--no-eh-frame-hdr",
    when: c => c.linux && c.abi === "gnu" && c.release,
    desc: "Omit eh_frame header (release; size/RSS opt; see stripFlags for matching -R .eh_frame)",
  },
  {
    flag: "-Wl,--eh-frame-hdr",
    when: c => c.linux && !(c.abi === "gnu" && c.release),
    desc: "Keep eh_frame header (debug/musl/android; needed for DWARF backtraces)",
  },
  {
    flag: c => `--ld-path=${c.ld}`,
    when: c => c.linux,
    desc: "Use lld instead of system ld",
  },
  {
    flag: ["-fno-pic", "-Wl,-no-pie"],
    when: c => c.linux && c.abi !== "android",
    desc: "No PIE (we don't need ASLR; simpler codegen)",
  },
  {
    flag: ["-fPIC", "-pie"],
    when: c => c.abi === "android",
    desc: "Android: bionic loader requires PIE",
  },
  {
    flag: [
      "-Wl,--as-needed",
      "-Wl,-z,stack-size=12800000",
      "-Wl,-z,lazy",
      "-Wl,-z,norelro",
      // (no --pack-dyn-relocs=relr: DT_RELR needs glibc ≥ 2.36 to load,
      // and we wrap symbols for portability down to 2.17. With -no-pie
      // there are <500 R_*_RELATIVE entries anyway — not worth the compat
      // break.)
      "-Wl,-O2",
      "-Wl,--gdb-index",
      "-Wl,-z,combreloc",
      // NOTE: --sort-section=name was here historically; lld ignores it
      // for the default `.text` rule. We also deliberately do NOT pass
      // `-z keep-text-section-prefix`: without a PGO profile, LLVM's *static*
      // `.unlikely` heuristic mislabels a lot of error/panic/bring-up code
      // that actually runs on the `bun <file>` startup path; segregating it
      // into `.text.unlikely` made ~84% of that section resident at startup
      // anyway, so the monolithic default `.text` has *better* RSS locality.
      "-Wl,--hash-style=both",
      "-Wl,--build-id=sha1",
    ],
    when: c => c.linux,
    desc: "Linux linker tuning: lazy binding, large stack, fast gdb loading",
  },
  {
    flag: "-Wl,--gc-sections",
    when: c => c.linux && c.release,
    desc: "Garbage-collect unused sections (release only; debug keeps Zig dbHelper symbols)",
  },
  {
    // Always icf=safe in release. The stripped `bun` shares its build-id
    // with `bun-profile`, so disabling ICF on the profile binary "for perf
    // symbolication" would also bloat the shipped binary's .text — and
    // `perf` symbolicates folded functions fine via the linker-map anyway.
    flag: c => ["-Wl,-icf=safe", `-Wl,-Map=${c.buildDir}/${bunExeName(c)}.linker-map`],
    when: c => c.linux && c.release && !c.asan && !c.valgrind,
    desc: "Identical-code-folding (safe; perf symbolication uses the linker-map)",
  },
  {
    // When a PGO profile is loaded (`--pgo-use`, e.g. the two-stage `btg`
    // build driven by scripts/build-pgo.ts) clang AND rustc emit `.text.hot` /
    // `.text.unlikely` section prefixes from *measured* execution counts.
    // Tell lld to keep those prefixes (it merges them into one `.text` by
    // default) so the hot cold-start working set — clap → CLI dispatch →
    // module loader → js_parser/js_printer bring-up → JSC VM init — lands in
    // one contiguous run of pages instead of being scattered across the ~54 MB
    // `.text` (each hot fn otherwise drags in a 64 KB fault-around window of
    // cold neighbours: ~+1.3 MB resident `.text` vs the PGO+BOLT'd shipped
    // binary).
    // Gated strictly on `pgoUse`: without a real profile this flag is harmful
    // (the static `.unlikely` heuristic is wrong for our startup path — see
    // the linker-tuning block above).
    flag: "-Wl,-z,keep-text-section-prefix",
    when: c => c.linux && c.release && !!c.pgoUse && !c.asan && !c.valgrind,
    desc: "Keep .text.hot/.text.unlikely prefixes from the PGO profile (cluster hot startup .text)",
  },
  {
    // Same goal as keep-text-section-prefix, without needing a PGO profile:
    // <buildDir>/linker.order lists the functions bun actually executes while
    // starting up, and lld sorts their input sections to the front of `.text`.
    // Starting up only touches ~8.5 MB of pages, but they are scattered over a
    // ~50 MB `.text` and the kernel faults in 64 KB around each one, so the
    // binary ends up with ~27 MB resident for `bun -e 'console.log(1)'`.
    // Packing them together cuts that by a third for a same-size binary.
    //
    // The file is a build artifact, never committed: configure seeds an empty one
    // (a no-op for lld) so this flag is unconditional and both link passes share
    // one build.ninja — a release build regenerates it from its own pass-1 binary
    // and reruns ninja, which relinks and nothing else. Symbols lld cannot find
    // are skipped, so a stale file only costs part of the win.
    //
    // A local `bun run build:release` therefore links unordered until you run
    // `bun run orderfile` and build again.
    flag: c => [`-Wl,--symbol-ordering-file=${orderFilePath(c)}`, "-Wl,--no-warn-symbol-ordering"],
    when: c => usesOrderFile(c),
    desc: "Sort startup-hot functions to the front of .text (cuts resident binary pages)",
  },

  // ─── Symbols / exports ───
  // These reference files on disk — linkDepends() lists the same paths
  // so ninja relinks when they change (cmake's LINK_DEPENDS equivalent).
  {
    flag: c => `/DEF:${slash(join(c.cwd, "src/symbols.def"))}`,
    when: c => c.windows,
    desc: "Exported symbol definition (.def format)",
  },
  {
    flag: c => ["-exported_symbols_list", `${c.cwd}/src/symbols.txt`],
    when: c => c.darwin,
    desc: "Exported symbol list",
  },
  {
    flag: c => [
      "-Wl,-Bsymbolic-functions",
      "-rdynamic",
      `-Wl,--dynamic-list=${c.cwd}/src/symbols.dyn`,
      `-Wl,--version-script=${c.cwd}/src/linker.lds`,
    ],
    when: c => c.linux,
    desc: "Dynamic symbol list + version script",
  },
  // ─── FreeBSD ───
  {
    flag: c => [`--target=${c.crossTarget!}`, `--sysroot=${c.sysroot!}`, "-stdlib=libc++"],
    when: c => c.freebsd && c.crossTarget !== undefined,
    desc: "FreeBSD cross-link: target/sysroot + libc++ (FreeBSD base ships libc++)",
  },
  {
    flag: c => `--ld-path=${c.ld}`,
    when: c => c.freebsd,
    desc: "Use lld instead of system ld",
  },
  {
    flag: ["-fno-pic", "-Wl,-no-pie"],
    when: c => c.freebsd,
    desc: "FreeBSD 13+ clang defaults to PIE; opt out (matches Linux, avoids -fPIC rebuild of WebKit/deps)",
  },
  {
    flag: [
      "-Wl,-O2",
      "-Wl,--as-needed",
      "-Wl,-z,stack-size=12800000",
      "-Wl,-z,lazy",
      "-Wl,-z,norelro",
      "-Wl,--gdb-index",
      "-Wl,-z,combreloc",
      "-Wl,--hash-style=both",
      "-Wl,--build-id=sha1",
    ],
    when: c => c.freebsd,
    desc: "FreeBSD linker tuning (same as Linux ELF)",
  },
  {
    // rust-lang/llvm-project doesn't enable `LLVM_ENABLE_ZLIB` (or `_ZSTD`) for
    // the lld they bundle as `rust-lld`, so this flag hard-fails there:
    //   `rust-lld: error: --compress-debug-sections: LLVM was not built with
    //   LLVM_ENABLE_ZLIB or did not find zlib at build time`.
    // We only fall onto rust-lld for cross-language LTO when rustc's LLVM is
    // newer than the system clang/lld (see config.ts `cfg.ld` selection); in
    // that case the link-time flag is dropped and llvm-objcopy compresses
    // post-link instead (shims.ts elfDebugCompressPostlinkCommand) — an
    // uncompressed bun-profile is ~2x larger and every `--compile` test
    // copies it, so leaving it uncompressed times CI out.
    flag: "-Wl,--compress-debug-sections=zlib",
    when: c => (c.linux || c.freebsd) && c.ld !== c.rustLld,
    desc: "Compress ELF debug sections (post-link via llvm-objcopy with rust-lld — built without zlib)",
  },
  {
    flag: "-Wl,--gc-sections",
    when: c => c.freebsd && c.release,
    desc: "Garbage-collect unused sections",
  },
  {
    flag: c => [
      "-Wl,-Bsymbolic-functions",
      "-rdynamic",
      `-Wl,--dynamic-list=${c.cwd}/src/symbols.dyn`,
      `-Wl,--version-script=${c.cwd}/src/linker-freebsd.lds`,
    ],
    when: c => c.freebsd,
    desc: "Dynamic symbol list + version script (FreeBSD adds environ/__progname)",
  },
];

/**
 * Whether this target links with an lld symbol ordering file. ELF only, and
 * only where the startup win is worth a relink: release linux builds.
 * Not under a sanitizer — the tracer mprotects `.text` out from under it, and
 * nobody measures startup RSS on an ASAN build anyway.
 *
 * gnu only: musl links statically, so LD_PRELOAD cannot load the tracer, and
 * android is cross-compiled, so the build host cannot run the binary to trace
 * it. Neither can produce an order file, so link them unordered rather than
 * attempt a trace that always fails and annotate every build about it.
 */
export function usesOrderFile(cfg: Pick<Config, "linux" | "abi" | "release" | "asan" | "valgrind">): boolean {
  return cfg.linux && cfg.abi === "gnu" && cfg.release && !cfg.asan && !cfg.valgrind;
}

/** The order file lives in the build directory — it is generated, never committed. */
export function orderFilePath(cfg: Pick<Config, "buildDir">): string {
  return join(cfg.buildDir, "linker.order");
}

/**
 * Files the linker reads via flags above. Return as implicit inputs so
 * ninja relinks when exported symbols / version script change.
 * CMake tracks these via set_target_properties LINK_DEPENDS.
 */
export function linkDepends(cfg: Config): string[] {
  if (cfg.freebsd) return [join(cfg.cwd, "src/symbols.dyn"), join(cfg.cwd, "src/linker-freebsd.lds")];
  if (cfg.windows) return [join(cfg.cwd, "src/symbols.def")];
  if (cfg.darwin) return [join(cfg.cwd, "src/symbols.txt")];
  // linux: ELF dynamic-list + version script, plus the release symbol ordering
  // file — listing it here is what makes regenerating it relink, and only relink.
  const linux = [join(cfg.cwd, "src/symbols.dyn"), join(cfg.cwd, "src/linker.lds")];
  if (usesOrderFile(cfg)) linux.push(orderFilePath(cfg));
  return linux;
}

// ═══════════════════════════════════════════════════════════════════════════
// STRIP FLAGS
//   For the post-link strip step (release only).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Strip step only runs for plain release builds (bun-profile → bun).
 * Not for debug/asan/valgrind/assertions variants — those keep symbols.
 *
 * Always: --strip-all --strip-debug --discard-all.
 * Platform extras remove unwind/exception sections we compile without
 * (no -fexceptions, lolhtml built with panic=abort).
 *
 * Linux section removal: CMake notes llvm-strip doesn't fully delete
 * these (leaves [LOAD #2 [R]]), GNU strip does. If size matters and
 * llvm-strip's output is larger, swap to /usr/bin/strip for this step.
 */
export const stripFlags: Flag[] = [
  {
    // Core strip: symbols + debug info + local symbols.
    flag: ["--strip-all", "--strip-debug", "--discard-all"],
    desc: "Remove symbols, debug info, local symbols",
  },
  {
    flag: [
      "--remove-section=__TEXT,__eh_frame",
      "--remove-section=__TEXT,__unwind_info",
      "--remove-section=__TEXT,__gcc_except_tab",
    ],
    when: c => c.darwin,
    desc: "Remove unwind/exception sections (we compile with -fno-exceptions; these come from lolhtml etc., built with panic=abort)",
  },
  {
    // musl: no eh_frame handling differences, but CMake gates on NOT musl so we do too.
    //
    // Gated on release to match -Wl,--no-eh-frame-hdr in linkerFlags above
    // (both fire on `c.linux && c.abi === "gnu" && c.release`). GNU strip
    // does not rewrite the program header table, so the PT_GNU_EH_FRAME
    // phdr must already be absent at link time — which the matching
    // --no-eh-frame-hdr above guarantees. Nothing unwinds at runtime
    // (`panic = "abort"`, `-fno-exceptions`); release backtraces use frame
    // pointers. Saves ~962 KB of R-segment (.eh_frame 806 KB +
    // .eh_frame_hdr 142 KB + .gcc_except_table 13 KB) that otherwise gets
    // dragged into RSS via 64 KB fault-around on adjacent .rodata reads.
    flag: ["-R", ".eh_frame", "-R", ".eh_frame_hdr", "-R", ".gcc_except_table"],
    when: c => c.linux && c.abi === "gnu" && c.release,
    desc: "Remove unwind sections (GNU strip required — llvm-strip leaves [LOAD #2 [R]])",
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// INCLUDE DIRECTORIES
//   Bun's own source tree + build-time generated code.
//   Dependency includes (WebKit, boringssl, ...) come from resolveDep().
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Bun's source-tree include paths. These are the -I dirs for bun's own code
 * (not vendored deps — those come from each dep's `Provides.includes`).
 */
export function bunIncludes(cfg: Config): string[] {
  const { cwd, codegenDir, vendorDir } = cfg;
  const includes: string[] = [
    join(cwd, "packages"),
    join(cwd, "packages/bun-usockets"),
    join(cwd, "packages/bun-usockets/src"),
    join(cwd, "src/jsc/bindings"),
    join(cwd, "src/jsc/bindings/webcore"),
    join(cwd, "src/jsc/bindings/webcrypto"),
    join(cwd, "src/jsc/bindings/node/crypto"),
    join(cwd, "src/jsc/bindings/node/http"),
    join(cwd, "src/jsc/bindings/sqlite"),
    join(cwd, "src/jsc/bindings/v8"),
    join(cwd, "src/jsc/modules"),
    join(cwd, "src/js/builtins"),
    join(cwd, "src/runtime/napi"),
    join(cwd, "src/uws_sys"),
    codegenDir,
    vendorDir,
    join(vendorDir, "picohttpparser"),
    join(vendorDir, "zlib"),
    // NODEJS_HEADERS_PATH comes from the nodejs dep; added separately
  ];

  if (cfg.windows) {
    includes.push(join(cwd, "src/jsc/bindings/windows"));
  } else {
    // libuv stubs for unix (real libuv used on windows)
    includes.push(join(cwd, "src/jsc/bindings/libuv"));
  }

  // musl doesn't ship sys/queue.h (glibc-only BSDism). lshpack bundles
  // a compat copy for this case.
  if (cfg.linux && cfg.abi === "musl") {
    includes.push(join(vendorDir, "lshpack/compat/queue"));
  }

  return includes;
}

// ═══════════════════════════════════════════════════════════════════════════
// PER-FILE OVERRIDES
//   Exceptional files that need different flags than the global set.
// ═══════════════════════════════════════════════════════════════════════════

export interface FileOverride {
  /** Source path relative to cfg.cwd. */
  file: string;
  /** Extra flags appended after the global set. */
  extraFlags: FlagValue;
  when?: (cfg: Config) => boolean;
  desc: string;
}

export const fileOverrides: FileOverride[] = [
  {
    file: "src/jsc/bindings/workaround-missing-symbols.cpp",
    // -fwhole-program-vtables requires -flto; disabling one requires
    // disabling the other or clang errors.
    extraFlags: ["-fno-lto", "-fno-whole-program-vtables"],
    when: c => c.linux && c.lto && c.abi === "gnu",
    desc: "Disable LTO: LLD 21 emits glibc versioned symbols (exp@GLIBC_2.17) into .lto_discard which fails to parse '@'",
  },
  {
    file: "src/jsc/bindings/windows/rescle.cpp",
    extraFlags: "/EHsc",
    when: c => c.windows,
    desc: "Vendored electron/rcedit; VersionInfo ctor throws std::system_error caught in OnEnumResourceLanguage. Self-contained throw/catch — already excluded from PCH",
  },
  {
    file: "src/jsc/bindings/highway_json.cpp",
    extraFlags: ["-O2"],
    when: c => c.debug,
    desc:
      "Always optimize the JSON structural-index kernel (debug builds use -O0 globally). At -O0 every " +
      "highway op is an outlined call taking 64-byte vectors by value through the stack, and clang's " +
      "unoptimized codegen for that pattern raises #GP on an aligned zmm stack store under the debug " +
      "sanitizer set; it would also make every JSON parse in debug builds pathologically slow. " +
      "Covered by test/js/bun/jsonc/jsonc.test.ts and `scripts/bench-json-rust.sh --test`.",
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// COMPUTED OUTPUT
// ═══════════════════════════════════════════════════════════════════════════

export interface ComputedFlags {
  /** C compiler flags (clang -c for .c files). */
  cflags: string[];
  /** C++ compiler flags (clang++ -c for .cpp files). */
  cxxflags: string[];
  /** Preprocessor defines, without -D prefix. */
  defines: string[];
  /** Linker flags for the final bun link. */
  ldflags: string[];
  /** Strip flags for post-link. */
  stripflags: string[];
}

/**
 * Resolve a FlagValue to its final string form(s) for a given config.
 */
function resolveFlagValue(v: FlagValue, cfg: Config): string[] {
  const resolved = typeof v === "function" ? v(cfg) : v;
  return Array.isArray(resolved) ? resolved : [resolved];
}

/**
 * Evaluate a Flag table and push into c/cxx output arrays.
 */
function evalTable(table: Flag[], cfg: Config, c: string[], cxx: string[]): void {
  for (const f of table) {
    if (f.when && !f.when(cfg)) continue;
    const flags = resolveFlagValue(f.flag, cfg);
    if (f.lang === "c") {
      c.push(...flags);
    } else if (f.lang === "cxx") {
      cxx.push(...flags);
    } else {
      c.push(...flags);
      cxx.push(...flags);
    }
  }
}

/**
 * Evaluate all flag predicates for bun's own source files.
 * Combines global flags + bun-only flags.
 */
export function computeFlags(cfg: Config): ComputedFlags {
  const cflags: string[] = [];
  const cxxflags: string[] = [];
  const defs: string[] = [];
  const ldflags: string[] = [];
  const stripflags: string[] = [];

  // Compile: global first, then bun-only
  evalTable(globalFlags, cfg, cflags, cxxflags);
  evalTable(bunOnlyFlags, cfg, cflags, cxxflags);

  // Defines, linker, strip
  for (const f of defines) {
    if (f.when && !f.when(cfg)) continue;
    defs.push(...resolveFlagValue(f.flag, cfg));
  }
  for (const f of linkerFlags) {
    if (f.when && !f.when(cfg)) continue;
    ldflags.push(...resolveFlagValue(f.flag, cfg));
  }
  for (const f of stripFlags) {
    if (f.when && !f.when(cfg)) continue;
    stripflags.push(...resolveFlagValue(f.flag, cfg));
  }

  return { cflags, cxxflags, defines: defs, ldflags, stripflags };
}

/**
 * Flags forwarded to vendored dependencies via -DCMAKE_C_FLAGS/-DCMAKE_CXX_FLAGS.
 * This is ONLY the global table — no -Werror, no bun-specific defines, no UBSan.
 */
export function computeDepFlags(cfg: Config): { cflags: string[]; cxxflags: string[] } {
  const cflags: string[] = [];
  const cxxflags: string[] = [];
  evalTable(globalFlags, cfg, cflags, cxxflags);
  return { cflags, cxxflags };
}

/**
 * Just the -march/-mcpu/-mtune flags. For deps (WebKit) whose own build system
 * sets -O/-g/sanitizer flags but never sets a CPU target, so without this they
 * end up targeting generic x86-64 while the rest of bun targets nehalem.
 */
export function computeCpuTargetFlags(cfg: Config): string[] {
  const out: string[] = [];
  for (const f of cpuTargetFlags) {
    if (f.when && !f.when(cfg)) continue;
    out.push(...resolveFlagValue(f.flag, cfg));
  }
  return out;
}

/**
 * Per-file extra flags lookup. Call after computeFlags() when compiling a
 * specific source. Returns extra flags to append (may be empty).
 */
export function extraFlagsFor(cfg: Config, srcRelPath: string): string[] {
  const key = srcRelPath.replaceAll("\\", "/");
  for (const o of fileOverrides) {
    if (o.file !== key) continue;
    if (o.when && !o.when(cfg)) continue;
    return resolveFlagValue(o.extraFlags, cfg);
  }
  return [];
}

/**
 * Produce a human-readable explanation of all active flags for `--explain-flags`.
 * Grouped by flag type, shows each flag alongside its description.
 */
export function explainFlags(cfg: Config): string {
  const lines: string[] = [];

  const explainTable = (title: string, flags: Flag[]) => {
    const active = flags.filter(f => !f.when || f.when(cfg));
    if (active.length === 0) return;
    lines.push(`\n─── ${title} ───`);
    for (const f of active) {
      const vals = resolveFlagValue(f.flag, cfg);
      const langSuffix = f.lang ? ` [${f.lang}]` : "";
      lines.push(`  ${vals.join(" ")}${langSuffix}`);
      lines.push(`    ${f.desc}`);
    }
  };

  explainTable("Global compiler flags (bun + deps)", globalFlags);
  explainTable("Bun-only compiler flags", bunOnlyFlags);
  explainTable("Defines", defines);
  explainTable("Linker flags", linkerFlags);
  explainTable("Strip flags", stripFlags);

  const overrides = fileOverrides.filter(o => !o.when || o.when(cfg));
  if (overrides.length > 0) {
    lines.push("\n─── Per-file overrides ───");
    for (const o of overrides) {
      lines.push(`  ${o.file}: ${resolveFlagValue(o.extraFlags, cfg).join(" ")}`);
      lines.push(`    ${o.desc}`);
    }
  }

  return lines.join("\n");
}
