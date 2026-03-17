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
import { slash } from "./shell.ts";

export type FlagValue = string | string[] | ((cfg: Config) => string | string[]);

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
// GLOBAL COMPILER FLAGS
//   Applied to BOTH bun's own sources AND forwarded to vendored deps
//   via -DCMAKE_C_FLAGS / -DCMAKE_CXX_FLAGS.
// ═══════════════════════════════════════════════════════════════════════════

export const globalFlags: Flag[] = [
  // ─── CPU target ───
  {
    flag: "-mcpu=apple-m1",
    when: c => c.darwin && c.arm64,
    desc: "Target Apple M1 (works on all Apple Silicon)",
  },
  {
    // CMake auto-added these via CMAKE_OSX_DEPLOYMENT_TARGET/CMAKE_OSX_SYSROOT;
    // we must add explicitly. Without this, clang/ld64 default to the host SDK
    // version — CI builds get minos=15.0, breaking macOS 13/14 users at launch.
    flag: c => [`-mmacosx-version-min=${c.osxDeploymentTarget!}`, "-isysroot", c.osxSysroot!],
    when: c => c.darwin && c.osxDeploymentTarget !== undefined && c.osxSysroot !== undefined,
    desc: "macOS deployment target + SDK (sets LC_BUILD_VERSION minos)",
  },
  {
    flag: ["-march=armv8-a+crc", "-mtune=ampere1"],
    when: c => c.linux && c.arm64,
    desc: "ARM64 Linux: ARMv8-A base + CRC, tuned for Ampere (Graviton-like)",
  },
  {
    flag: ["/clang:-march=armv8-a+crc", "/clang:-mtune=ampere1"],
    when: c => c.windows && c.arm64,
    desc: "ARM64 Windows: clang-cl prefix required (/clang: passes to clang)",
  },
  {
    flag: "-march=nehalem",
    when: c => c.x64 && c.baseline,
    desc: "x64 baseline: Nehalem (2008) — no AVX, broadest compatibility",
  },
  {
    flag: "-march=haswell",
    when: c => c.x64 && !c.baseline,
    desc: "x64 default: Haswell (2013) — AVX2, BMI2 available",
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
    flag: "/EHsc",
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
  // link (LTO only), and strip -R .eh_frame at post-link (LTO only).
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
    flag: "-faddrsig",
    when: c => (c.debug && c.linux) || (c.release && c.unix),
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
    flag: "-flto=full",
    when: c => c.unix && c.lto,
    desc: "Full link-time optimization (not thin)",
  },
  {
    flag: "-flto",
    when: c => c.windows && c.lto,
    desc: "Link-time optimization",
  },
  {
    flag: ["-fforce-emit-vtables", "-fwhole-program-vtables"],
    when: c => c.unix && c.lto,
    lang: "cxx",
    desc: "Enable devirtualization across whole program (LTO only)",
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
  // ─── Language standard ───
  // WebKit uses gnu++ extensions on Linux; if we don't match, the first
  // memory allocation crashes (ABI mismatch in sized delete).
  // Not in globalFlags because deps set their own standard.
  {
    flag: "-std=gnu++23",
    when: c => c.linux,
    lang: "cxx",
    desc: "C++23 with GNU extensions (required to match WebKit's ABI on Linux)",
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
    when: c => c.unix && ((c.debug && c.abi !== "musl") || (c.release && c.asan)),
    desc: "Undefined-behavior sanitizers",
  },
  {
    flag: ["-fsanitize-coverage=trace-pc-guard", "-DFUZZILLI_ENABLED"],
    when: c => c.fuzzilli,
    desc: "Fuzzilli coverage instrumentation",
  },

  // ─── Bun-target-specific ───
  {
    flag: ["-fconstexpr-steps=2542484", "-fconstexpr-depth=54"],
    when: c => c.unix,
    lang: "cxx",
    desc: "Raise constexpr limits (JSC uses heavy constexpr)",
  },
  {
    flag: ["-fno-pic", "-fno-pie"],
    when: c => c.unix,
    desc: "No position-independent code (we're a final executable)",
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
    // (the preprocessor needs the string to be "24.3.0", not bare 24.3.0).
    flag: c => `REPORTED_NODEJS_VERSION=\\"${c.nodejsVersion}\\"`,
    desc: "Node.js version string reported by process.version",
  },
  {
    flag: c => `REPORTED_NODEJS_ABI_VERSION=${c.nodejsAbiVersion}`,
    desc: "Node.js ABI version (process.versions.modules)",
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
    when: c => c.unix && c.debug && c.abi !== "musl",
    desc: "Link UBSan runtime",
  },
  {
    flag: "-fsanitize=null",
    when: c => c.unix && c.release && c.asan,
    desc: "Link UBSan runtime (release-asan)",
  },
  {
    flag: "-fsanitize-coverage=trace-pc-guard",
    when: c => c.fuzzilli,
    desc: "Link fuzzilli coverage runtime",
  },

  // ─── LTO (link-side) ───
  {
    flag: ["-flto=full", "-fwhole-program-vtables", "-fforce-emit-vtables"],
    when: c => c.unix && c.lto,
    desc: "LTO at link time (matches compile-side -flto=full)",
  },
  {
    // Without -O at link time, clang's driver defaults LTO codegen to -O2.
    // CMake implicitly forwarded CMAKE_CXX_FLAGS (incl. -O2) to the link line;
    // we must do so explicitly. Dropping this cost ~5 MB of .text on linux-x64
    // (less unrolling/inlining in JSC — measurable in Yarr, DFG, BuiltinNames).
    flag: "-O2",
    when: c => c.unix && c.lto && c.release && !c.smol,
    desc: "LTO codegen at -O2",
  },
  {
    flag: "-Os",
    when: c => c.unix && c.lto && c.smol,
    desc: "LTO codegen at -Os (matches compile-side opt level)",
  },

  // ─── Windows ───
  {
    flag: ["/STACK:0x1200000,0x200000", "/errorlimit:0"],
    when: c => c.windows,
    desc: "18MB stack reserve (JSC uses deep recursion), no error limit",
  },
  {
    flag: [
      "/LTCG",
      "/OPT:REF",
      "/OPT:NOICF",
      "/DEBUG:FULL",
      "/delayload:ole32.dll",
      "/delayload:WINMM.dll",
      "/delayload:dbghelp.dll",
      "/delayload:VCRUNTIME140_1.dll",
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
    flag: ["-Wl,-ld_new", "-Wl,-no_compact_unwind", "-Wl,-stack_size,0x1200000", "-fno-keep-static-consts"],
    when: c => c.darwin,
    desc: "Use new Apple linker, 18MB stack, skip compact unwind",
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

  // ─── Linux ───
  {
    // Wrap old glibc symbols so the binary runs on older glibc
    flag: [
      "-Wl,--wrap=exp",
      "-Wl,--wrap=exp2",
      "-Wl,--wrap=expf",
      "-Wl,--wrap=fcntl64",
      "-Wl,--wrap=gettid",
      "-Wl,--wrap=log",
      "-Wl,--wrap=log2",
      "-Wl,--wrap=log2f",
      "-Wl,--wrap=logf",
      "-Wl,--wrap=pow",
      "-Wl,--wrap=powf",
    ],
    when: c => c.linux && c.abi !== "musl",
    desc: "Wrap glibc 2.29+ symbols (portable to older glibc)",
  },
  {
    flag: ["-static-libstdc++", "-static-libgcc"],
    when: c => c.linux && c.abi !== "musl",
    desc: "Static C++ runtime (don't depend on host libstdc++)",
  },
  {
    flag: ["-lstdc++", "-lgcc"],
    when: c => c.linux && c.abi === "musl",
    desc: "Dynamic C++ runtime on musl (static unavailable)",
  },
  {
    // Paired with compile-side -fno-unwind-tables above.
    // Only in LTO builds — otherwise .eh_frame is needed for backtraces.
    flag: "-Wl,--no-eh-frame-hdr",
    when: c => c.linux && c.lto,
    desc: "Omit eh_frame header (LTO builds; size opt; see stripFlags for matching -R .eh_frame)",
  },
  {
    flag: "-Wl,--eh-frame-hdr",
    when: c => c.linux && !c.lto,
    desc: "Keep eh_frame header (non-LTO; needed for backtraces)",
  },
  {
    flag: c => `--ld-path=${c.ld}`,
    when: c => c.linux,
    desc: "Use lld instead of system ld",
  },
  {
    flag: ["-fno-pic", "-Wl,-no-pie"],
    when: c => c.linux,
    desc: "No PIE (we don't need ASLR; simpler codegen)",
  },
  {
    flag: [
      "-Wl,--as-needed",
      "-Wl,-z,stack-size=12800000",
      "-Wl,--compress-debug-sections=zlib",
      "-Wl,-z,lazy",
      "-Wl,-z,norelro",
      "-Wl,-O2",
      "-Wl,--gdb-index",
      "-Wl,-z,combreloc",
      "-Wl,--sort-section=name",
      "-Wl,--hash-style=both",
      "-Wl,--build-id=sha1",
    ],
    when: c => c.linux,
    desc: "Linux linker tuning: lazy binding, large stack, compressed debug, fast gdb loading",
  },
  {
    flag: "-Wl,--gc-sections",
    when: c => c.linux && c.release,
    desc: "Garbage-collect unused sections (release only; debug keeps Zig dbHelper symbols)",
  },
  {
    flag: c => ["-Wl,-icf=safe", `-Wl,-Map=${c.buildDir}/${bunExeName(c)}.linker-map`],
    when: c => c.linux && c.release && !c.asan && !c.valgrind,
    desc: "Safe identical-code-folding + linker map (release only)",
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
      "-Bsymbolics-functions",
      "-rdynamic",
      `-Wl,--dynamic-list=${c.cwd}/src/symbols.dyn`,
      `-Wl,--version-script=${c.cwd}/src/linker.lds`,
    ],
    when: c => c.linux,
    desc: "Dynamic symbol list + version script",
  },
];

/**
 * Files the linker reads via flags above. Return as implicit inputs so
 * ninja relinks when exported symbols / version script change.
 * CMake tracks these via set_target_properties LINK_DEPENDS.
 */
export function linkDepends(cfg: Config): string[] {
  if (cfg.windows) return [join(cfg.cwd, "src/symbols.def")];
  if (cfg.darwin) return [join(cfg.cwd, "src/symbols.txt")];
  return [join(cfg.cwd, "src/symbols.dyn"), join(cfg.cwd, "src/linker.lds")];
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
    // Strip only runs on plain release (shouldStrip gates debug/asan/valgrind/assertions)
    // which in CI always has LTO on — in practice paired with --no-eh-frame-hdr.
    flag: ["-R", ".eh_frame", "-R", ".gcc_except_table"],
    when: c => c.linux && c.abi !== "musl",
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
    join(cwd, "src/bun.js/bindings"),
    join(cwd, "src/bun.js/bindings/webcore"),
    join(cwd, "src/bun.js/bindings/webcrypto"),
    join(cwd, "src/bun.js/bindings/node/crypto"),
    join(cwd, "src/bun.js/bindings/node/http"),
    join(cwd, "src/bun.js/bindings/sqlite"),
    join(cwd, "src/bun.js/bindings/v8"),
    join(cwd, "src/bun.js/modules"),
    join(cwd, "src/js/builtins"),
    join(cwd, "src/napi"),
    join(cwd, "src/deps"),
    codegenDir,
    vendorDir,
    join(vendorDir, "picohttpparser"),
    join(vendorDir, "zlib"),
    // NODEJS_HEADERS_PATH comes from the nodejs dep; added separately
  ];

  if (cfg.windows) {
    includes.push(join(cwd, "src/bun.js/bindings/windows"));
  } else {
    // libuv stubs for unix (real libuv used on windows)
    includes.push(join(cwd, "src/bun.js/bindings/libuv"));
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
    file: "src/bun.js/bindings/workaround-missing-symbols.cpp",
    // -fwhole-program-vtables requires -flto; disabling one requires
    // disabling the other or clang errors.
    extraFlags: ["-fno-lto", "-fno-whole-program-vtables"],
    when: c => c.linux && c.lto && c.abi !== "musl",
    desc: "Disable LTO: LLD 21 emits glibc versioned symbols (exp@GLIBC_2.17) into .lto_discard which fails to parse '@'",
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
 * Per-file extra flags lookup. Call after computeFlags() when compiling a
 * specific source. Returns extra flags to append (may be empty).
 */
export function extraFlagsFor(cfg: Config, srcRelPath: string): string[] {
  for (const o of fileOverrides) {
    if (o.file !== srcRelPath) continue;
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
