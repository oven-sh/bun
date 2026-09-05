/**
 * What a linked bun executable must look like from the outside, per target:
 * the invariants `verify-binary.ts` checks as a validation of the link edge.
 * Everything here is derived from `Config` at configure time and serialized
 * into `<exe>.verify.json`; the checker itself never imports the build system.
 *
 * When one of these trips, the question is always "did we mean to change
 * this?": a new NEEDED library, a raised glibc floor, a new static initializer
 * or a lost hardening bit are exactly the changes that ship unnoticed and get
 * reported from the field. Update the expectation in the same change that
 * intends it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.ts";

export type BinaryFormat = "elf" | "macho" | "pe";

export interface BinaryExpectations {
  format: BinaryFormat;
  /**
   * Exported (dynamic) symbols: every export must equal one of `exact`, match
   * one of `patterns` (`*` wildcards) by its raw name, or one of
   * `demangledPatterns` by its demangled name (a version script's
   * `extern "C++"` block). Nothing may leak past the export lists in src/
   * (linker.lds / symbols.txt / symbols.def) — on Windows a stray
   * `__declspec(dllexport)` does exactly that.
   */
  exports: { exact: string[]; patterns: string[]; demangledPatterns: string[] };
  /**
   * The dynamic libraries the executable loads (ELF DT_NEEDED, Mach-O
   * LC_LOAD_DYLIB install names, PE import + delay-import DLL names, compared
   * case-insensitively on PE). Exact when the build targets a pinned runtime
   * (a sysroot, the macOS SDK, the Windows SDK); a local Linux build against
   * the host's libc may only load a subset (newer glibc folds libdl/libpthread
   * into libc.so.6).
   */
  neededLibs: { names: string[]; exact: boolean };
  /**
   * ELF symbol versioning ceilings: for each version-namespace prefix the
   * highest version any import may require (`GLIBC: "2.17"`). A prefix not
   * listed here may not appear at all. Undefined = not checked (a local build
   * against the host libc inherits whatever that libc's headers select).
   */
  maxSymbolVersions?: Record<string, string>;
  /** Mach-O `minos`, PE subsystem version ("6.0"); exact. */
  minOSVersion?: string;
  /** Undefined dynamic symbols that must not appear (`*` wildcards). */
  forbiddenImports: string[];
  /**
   * Allowed static initializers (`*` wildcards over the symbol each
   * .init_array / __init_offsets entry points at). Ours is a codebase with
   * none of its own; the runtime's (mimalloc, libstdc++'s locale tables,
   * crt) are listed. Undefined = not checkable on this format (PE).
   */
  staticInitializers?: string[];
  elf?: {
    type: "EXEC" | "DYN";
    /** PT_GNU_STACK must be RW, never RWE. */
    execStack: false;
    /** No PT_LOAD segment both writable and executable. */
    rwxLoad: false;
    relro: boolean;
    bindNow: boolean;
  };
  pe?: {
    /** Exact set of IMAGE_DLL_CHARACTERISTICS_* names. */
    dllCharacteristics: string[];
    subsystem: string;
  };
  macho?: {
    /** MH_* flags that must be present. */
    flags: string[];
    /** Segment name → maxprot, for the segments that must not gain W or X. */
    segmentMaxProt: Record<string, string>;
  };
  /**
   * The profile executable keeps a symbol table and debug sections (ELF; on
   * Mach-O debug info lives in the dSYM, on PE in the PDB). `compressed`:
   * the debug sections carry SHF_COMPRESSED.
   */
  debugInfo?: { symtab: boolean; debugSections: boolean; compressed: boolean };
}

/**
 * `global:` patterns of an ld version script (the part before `local:`):
 * plain ones match mangled names, those inside `extern "C++" { … }` match
 * demangled names — returned as `patterns` / `demangledPatterns`.
 */
function versionScriptGlobals(path: string): { patterns: string[]; demangledPatterns: string[] } {
  const text = readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/#.*$/gm, "");
  const globals = text.split(/\blocal\s*:/)[0]!.split(/\bglobal\s*:/)[1] ?? "";
  const patterns: string[] = [];
  const demangledPatterns: string[] = [];
  let inCxx = false;
  for (const raw of globals.split(/[;\n]/)) {
    const s = raw.trim();
    if (s.length === 0) continue;
    if (s.startsWith('extern "C++"')) {
      inCxx = true;
      continue;
    }
    if (s === "}" || s === "};") {
      inCxx = false;
      continue;
    }
    if (s.includes("{") || s.includes("}")) continue;
    (inCxx ? demangledPatterns : patterns).push(s);
  }
  return { patterns, demangledPatterns };
}

/** One symbol per line, `#`/`;` comments and blank lines skipped (symbols.txt, symbols.def bodies). */
function symbolList(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map(l => l.trim())
    .filter(
      l => l.length > 0 && !l.startsWith("#") && !l.startsWith(";") && l !== "EXPORTS" && !l.startsWith("LIBRARY"),
    );
}

export function binaryFormat(cfg: Config): BinaryFormat {
  return cfg.windows ? "pe" : cfg.darwin ? "macho" : "elf";
}

/**
 * Static initializers the runtime libraries contribute. bun, JSC and WTF add
 * none (WTF's NeverDestroyed / LazyNeverDestroyed exist so they don't have
 * to); a `_GLOBAL__sub_I_<file>` from one of ours is the thing to catch.
 */
const runtimeInitializers = [
  "_ZL17mi_process_attachv", // mimalloc
  "frame_dummy", // crtbegin
  "register_classes", // freebsd crt
  "__init_cpu_features*", // compiler-rt / bionic ifunc resolvers
  "init_have_lse_atomics", // compiler-rt outline atomics (aarch64)
  "__do_init", // crt
  "_R*3std3sys4args4unix3imp15ARGV_INIT_ARRAY*", // Rust std: argv capture
  "_R*3std3sys18configure_builtins13RUST_LSE_INIT*", // Rust std: aarch64 outline-atomics probe
  // libstdc++ linked statically on glibc targets: its own iostream/locale tables.
  "_GLOBAL__sub_I_eh_alloc.cc",
  "_GLOBAL__sub_I_cxx11_locale_inst.cc",
  "_GLOBAL__sub_I_cxx11_wlocale_inst.cc",
  "_GLOBAL__sub_I_ios_errcat.cc",
  "_GLOBAL__sub_I_locale_inst.cc",
  "_GLOBAL__sub_I_system_error.cc",
  "_GLOBAL__sub_I_wlocale_inst.cc",
];

/**
 * Imports that would mean a toolchain feature we build without has crept in:
 * C++ exceptions/RTTI runtime from a shared libstdc++/libc++, the unwinder
 * driving them, libgcc's emulated TLS, libatomic.
 */
const forbiddenImportsCommon = [
  "__cxa_throw",
  "__cxa_rethrow",
  "__cxa_allocate_exception",
  "__gxx_personality_*",
  "__emutls_*",
  "__atomic_*",
];

export function binaryExpectations(cfg: Config): BinaryExpectations {
  const format = binaryFormat(cfg);
  const src = (f: string) => join(cfg.cwd, "src", f);

  if (format === "elf") {
    const android = cfg.abi === "android";
    const musl = cfg.abi === "musl";
    const freebsd = cfg.freebsd;
    // A sysroot pins the libc the binary is built against (every CI lane);
    // without one the host's headers decide NEEDED and symbol versions.
    const pinned = cfg.sysroot !== undefined;
    const loader = cfg.x64 ? "ld-linux-x86-64.so.2" : "ld-linux-aarch64.so.1";
    const neededLibs = freebsd
      ? ["libc++.so.1", "libc.so.7", "libcxxrt.so.1", "libm.so.5", "libthr.so.3"]
      : android
        ? ["libc.so", "libdl.so", "libm.so"]
        : musl
          ? [`libc.musl-${cfg.x64 ? "x86_64" : "aarch64"}.so.1`, "libstdc++.so.6"]
          : [loader, "libc.so.6", "libdl.so.2", "libm.so.6", "libpthread.so.0"];
    return {
      format,
      exports: { exact: [], ...versionScriptGlobals(src(freebsd ? "linker-freebsd.lds" : "linker.lds")) },
      neededLibs: { names: neededLibs, exact: pinned },
      // glibc 2.17 = RHEL 7 / Amazon Linux 2, the oldest distro generation bun
      // runs on. FreeBSD 13's libc is FBSD_1.7; its libc++ carries GLIBCXX_3.4
      // version tags for the libstdc++-compatible subset.
      ...(pinned && {
        maxSymbolVersions: freebsd
          ? { FBSD: "1.7", GLIBCXX: "3.4", CXXABI: "1.3" }
          : android || musl
            ? {}
            : { GLIBC: "2.17" },
      }),
      // musl and FreeBSD link the C++ runtime dynamically, so the exception
      // entry points are legitimately imported (libstdc++/libc++ reference
      // them internally); the ban applies where we link it statically.
      forbiddenImports: musl || freebsd ? ["__emutls_*"] : forbiddenImportsCommon,
      staticInitializers: runtimeInitializers,
      elf: {
        // Android requires PIE; everywhere else bun is a fixed-address
        // executable (-fno-pic, see flags.ts). No RELRO / BIND_NOW anywhere
        // today (flags.ts links -z norelro for startup); recorded, not endorsed.
        type: android ? "DYN" : "EXEC",
        execStack: false,
        rwxLoad: false,
        relro: false,
        bindNow: false,
      },
      debugInfo: { symtab: true, debugSections: true, compressed: cfg.release && !cfg.asan },
    };
  }

  if (format === "macho") {
    return {
      format,
      exports: { exact: symbolList(src("symbols.txt")), patterns: [], demangledPatterns: [] },
      neededLibs: {
        names: [
          "/usr/lib/libSystem.B.dylib",
          "/usr/lib/libc++.1.dylib",
          "/usr/lib/libicucore.A.dylib",
          "/usr/lib/libresolv.9.dylib",
        ],
        exact: true,
      },
      ...(cfg.osxDeploymentTarget !== undefined && { minOSVersion: cfg.osxDeploymentTarget }),
      forbiddenImports: forbiddenImportsCommon,
      staticInitializers: runtimeInitializers,
      macho: {
        flags: ["PIE", "TWOLEVEL", "DYLDLINK"],
        segmentMaxProt: { __TEXT: "r-x", __DATA_CONST: "rw-", __DATA: "rw-", __LINKEDIT: "r--" },
      },
    };
  }

  // pe
  return {
    format,
    exports: {
      exact: [...symbolList(src("symbols.def")), "node_module_register"],
      // Node-API and the V8 / node C++ embedder API are exported from the
      // source with __declspec(dllexport) (NAPI_EXTERN, BUN_EXPORT), the C++
      // ones under their MSVC-mangled names; symbols.def adds libuv.
      patterns: ["napi_*", "node_api_*", "?*@v8@@*", "?*@node@@*"],
      demangledPatterns: [],
    },
    neededLibs: {
      exact: true,
      names: [
        "ADVAPI32.dll",
        "CRYPT32.dll",
        "IPHLPAPI.DLL",
        "KERNEL32.dll",
        "OLEAUT32.dll",
        "SHELL32.dll",
        "USER32.dll",
        "USERENV.dll",
        "WS2_32.dll",
        "WSOCK32.dll",
        "api-ms-win-core-synch-l1-2-0.dll",
        "bcryptprimitives.dll",
        "dbghelp.dll",
        "ntdll.dll",
        "ole32.dll",
      ],
    },
    minOSVersion: "6.0",
    forbiddenImports: [...forbiddenImportsCommon, "_CxxThrowException", "__CxxFrameHandler*"],
    pe: {
      dllCharacteristics: ["DYNAMIC_BASE", "HIGH_ENTROPY_VA", "NX_COMPAT", "TERMINAL_SERVER_AWARE"],
      subsystem: "IMAGE_SUBSYSTEM_WINDOWS_CUI",
    },
  };
}
