/**
 * Compilation constructors.
 *
 * These are NOT abstractions — they're shortcuts that build one compiler,
 * linker or archiver invocation and declare it as a task. A "library" is just
 * an array of cxx() outputs + one ar() output. An executable is cxx() outputs
 * + one link().
 */

import { mkdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import type { Config } from "./config.ts";
import { assert } from "./error.ts";
import { writeIfChanged } from "./fs.ts";
import type { NativeTask, Ninja } from "./ninja.ts";
import { postlinkCommands } from "./shims.ts";

// ---------------------------------------------------------------------------
// Tool invocations
// ---------------------------------------------------------------------------

/**
 * Depfile handling differs between clang (gcc-style .d, `-MMD -MF`) and
 * clang-cl (`/showIncludes` on stdout).
 */
function depfileFor(cfg: Config, out: string): NativeTask["depfile"] {
  return cfg.windows ? { kind: "msvc" } : { kind: "gcc", path: `${out}.d` };
}

/** `-c src -o out` in the dialect of the target compiler. */
function compileOutputArgs(cfg: Config, n: Ninja, src: string, out: string): string[] {
  return cfg.windows ? ["/c", n.rel(src), `/Fo${n.rel(out)}`] : ["-c", n.rel(src), "-o", n.rel(out)];
}

/**
 * Compiles are capped at the core count, below the engine's (and ninja's)
 * default job count of cores + 2, so cargo and dep builds start the moment
 * they are ready instead of queueing behind a thousand compiles.
 */
export const COMPILE_POOL = "compile";

/** Register the pools compile tasks use. Call once per Ninja instance. */
export function registerCompilePools(n: Ninja): void {
  n.pool(COMPILE_POOL, availableParallelism());
}

// ---------------------------------------------------------------------------
// Compilation constructors
// ---------------------------------------------------------------------------

export interface CompileOpts {
  /** Compiler flags (including -I, -D — caller assembles). */
  flags: string[];
  /** PCH to use (absolute path to .pch/.gch output). */
  pch?: string;
  /** Original header the PCH was built from (needed for clang-cl /Yu). */
  pchHeader?: string;
  /**
   * Extra implicit deps. Use for generated headers this specific .cpp needs
   * (e.g. ErrorCode.cpp depends on ErrorCode+List.h), and for dep outputs
   * (lib*.a) — local sub-builds rewrite forwarding headers as undeclared
   * side effects, so the lib is the invalidation signal; order-only would
   * lag one build behind.
   */
  implicitInputs?: string[];
  /**
   * Order-only deps. Must exist before compile, but mtime not tracked.
   * The compiler's .d depfile tracks ACTUAL header dependencies on
   * subsequent builds — order-only is for "header must be generated
   * before first compile attempts to #include it".
   *
   * Use for codegen headers (declared ninja outputs with restat, so
   * depfile tracking is exact). Dep outputs (lib*.a) go in
   * implicitInputs instead — see above.
   */
  orderOnlyInputs?: string[];
  /** Job pool override. */
  pool?: string;
}

/**
 * Compile a C++ source file. Returns absolute path to the .o output.
 *
 * Output path: {buildDir}/obj/{path-from-cwd-with-slashes-flattened}.o
 * E.g. src/jsc/bindings/foo.cpp → obj/src_jsc_bindings_foo.cpp.o
 */
export function cxx(n: Ninja, cfg: Config, src: string, opts: CompileOpts): string {
  assert(
    extname(src) === ".cpp" || extname(src) === ".cc" || extname(src) === ".cxx",
    `cxx() expects .cpp/.cc/.cxx source, got: ${src}`,
  );
  return compile(n, cfg, src, opts, "cxx");
}

/**
 * Compile a C source file. Returns absolute path to the .o output.
 *
 * `.S` (preprocessed assembly) is also accepted — clang dispatches on the
 * extension and runs cpp + as. Used by deps that ship hand-tuned kernels
 * (e.g. zstd's huf_decompress_amd64.S).
 */
export function cc(n: Ninja, cfg: Config, src: string, opts: Omit<CompileOpts, "pch" | "pchHeader">): string {
  const ext = extname(src);
  assert(ext === ".c" || ext === ".S", `cc() expects .c/.S source, got: ${src}`);
  // C files never use PCH (PCH is C++-only in our build)
  return compile(n, cfg, src, opts, "cc");
}

/**
 * Assemble a NASM-syntax `.asm` file (BoringSSL win-x64, libjpeg-turbo x86_64
 * SIMD). Returns absolute path to the object output. gas-syntax `.S` goes
 * through cc().
 */
export function nasm(
  n: Ninja,
  cfg: Config,
  src: string,
  opts: { flags: string[]; orderOnlyInputs?: string[] },
): string {
  assert(extname(src) === ".asm", `nasm() expects .asm source, got: ${src}`);
  assert(cfg.nasm !== undefined, "nasm not found in toolchain", {
    hint:
      cfg.host.os === "windows"
        ? "Install from https://nasm.us or `winget install NASM.NASM`"
        : "Install nasm from your distro (apt/dnf/brew install nasm) or https://nasm.us",
  });
  const out = objectPath(cfg, src);
  // -MD writes a Make-style depfile; nasm 2.14+ supports it.
  n.task({
    kind: "nasm",
    label: n.rel(out),
    commands: [{ argv: [cfg.nasm, ...opts.flags, "-MD", `${n.rel(out)}.d`, "-o", n.rel(out), resolve(cfg.cwd, src)] }],
    outputs: [out],
    inputs: [resolve(cfg.cwd, src)],
    after: opts.orderOnlyInputs,
    depfile: { kind: "gcc", path: `${out}.d` },
    pool: COMPILE_POOL,
  });
  return out;
}

function compile(n: Ninja, cfg: Config, src: string, opts: CompileOpts, lang: "cxx" | "cc"): string {
  const absSrc = resolve(cfg.cwd, src);
  const out = objectPath(cfg, src);
  const compiler = lang === "cxx" ? cfg.cxx : cfg.cc;

  const argv: string[] = [];
  if (cfg.ccache !== undefined) argv.push(cfg.ccache);
  argv.push(compiler);
  if (cfg.windows) argv.push("/nologo", "/showIncludes");
  argv.push(...opts.flags);

  const implicitInputs: string[] = [...(opts.implicitInputs ?? [])];

  // PCH is loaded with -include-pch, plus a force-include of the wrapper
  // header, mirroring CMake's target_precompile_headers(). The force-include
  // re-applies `#pragma clang system_header` for the current translation
  // unit's preprocessing pass — without it, warnings from PCH-included
  // headers aren't suppressed (the pragma's effect is per-preprocessing-pass,
  // not per-AST). The -Xclang prefix is required: plain -include doesn't
  // combine with PCH on the clang driver, but -Xclang bypasses the driver's
  // sanity check. clang-cl accepts the same -Xclang pair; its MSVC-style
  // alternative (/Yu + /FI) does NOT work — /Yu scans the literal source for
  // the through-header and ignores /FI-injected includes.
  if (opts.pch !== undefined && lang === "cxx") {
    assert(opts.pchHeader !== undefined, "cxx with pch requires pchHeader (the wrapper .hxx)");
    if (!cfg.windows) argv.push("-Winvalid-pch");
    argv.push(
      "-Xclang",
      "-include-pch",
      "-Xclang",
      n.rel(opts.pch),
      "-Xclang",
      "-include",
      "-Xclang",
      n.rel(opts.pchHeader),
    );
    // If the PCH changes, recompile.
    implicitInputs.push(opts.pch);
  }
  if (!cfg.windows) argv.push("-MMD", "-MT", n.rel(out), "-MF", `${n.rel(out)}.d`);
  argv.push(...compileOutputArgs(cfg, n, absSrc, out));

  n.task({
    kind: lang,
    label: n.rel(out),
    commands: [{ argv }],
    outputs: [out],
    inputs: [absSrc],
    implicitInputs,
    after: opts.orderOnlyInputs,
    depfile: depfileFor(cfg, out),
    pool: opts.pool ?? COMPILE_POOL,
  });

  // Record for compile_commands.json
  n.addCompileCommand({
    directory: cfg.buildDir,
    file: absSrc,
    output: n.rel(out),
    arguments: [
      compiler,
      ...opts.flags,
      ...(opts.pch !== undefined ? ["-include-pch", n.rel(opts.pch)] : []),
      "-c",
      absSrc,
      "-o",
      out,
    ],
  });

  return out;
}

/**
 * Compile a header into a precompiled header.
 * Returns `{ pch, wrapperHeader }` — both paths absolute.
 *
 * Writes a wrapper .hxx with `#pragma clang system_header` +
 * `#include <original>`, compiles
 * THAT to a .pch. The pragma marks everything transitively included as a
 * system header — warnings from those headers are suppressed even with
 * -Werror. This matters for JSC headers (which trigger -Wundefined-var-template
 * by design — template statics defined in .cpp, linker resolves).
 *
 * Consumers should pass BOTH paths to cxx(): the .pch via -include-pch, the
 * wrapper via -include. The force-include re-applies the system_header pragma
 * for that translation unit's preprocessing pass.
 */
export function pch(
  n: Ninja,
  cfg: Config,
  header: string,
  opts: {
    flags: string[];
    /**
     * Files whose change must invalidate the PCH. Typically: dep output
     * libs (libJavaScriptCore.a etc.).
     *
     * Can't be order-only: the depfile tracks headers, but ninja stats at
     * startup. Local WebKit headers live in buildDir and get regenerated
     * by dep_build MID-RUN. At startup ninja sees old headers → thinks
     * PCH is fresh → cxx fails with "file modified since PCH was built"
     * → needs a second build. With these implicit, restat propagates the
     * lib change to PCH and it rebuilds in the same run.
     *
     * Cost: PCH also rebuilds on unrelated dep bumps (brotli etc.). Rare
     * enough to accept for correctness.
     */
    implicitInputs?: string[];
    /**
     * Must exist before PCH compiles; changes don't invalidate it.
     * Codegen outputs go here — they only change when inputs change,
     * and inputs don't change mid-build.
     */
    orderOnlyInputs?: string[];
  },
): { pch: string; wrapperHeader: string } {
  const absHeader = resolve(cfg.cwd, header);
  const pchDir = resolve(cfg.buildDir, "pch");
  const wrapperHeader = resolve(pchDir, `${basename(header)}.hxx`);
  const stubCxx = resolve(pchDir, `${basename(header)}.hxx.cxx`);
  const out = resolve(pchDir, `${basename(header)}.hxx.pch`);
  // clang-cl /Yc compiles the stub source AND emits a PCH in one invocation,
  // so it always writes a side-effect .obj. Unlike MSVC, clang's PCH is a
  // serialized AST (not a partial object file), so consumers don't need this
  // .obj linked — we declare it only so ninja tracks/cleans it.
  const stubObj = `${stubCxx}${cfg.objSuffix}`;

  // Write the wrapper at configure time. `#pragma clang system_header` must
  // be the FIRST non-comment line for clang to honor it.
  //
  // Both files are configure-time artifacts — their content is fully
  // determined by `header`. writeIfNotChanged: avoid touching mtime.
  mkdirSync(pchDir, { recursive: true });
  writeIfChanged(
    wrapperHeader,
    [
      `/* generated by scripts/build/compile.ts */`,
      `#pragma clang system_header`,
      `#ifdef __cplusplus`,
      `#include "${absHeader}"`,
      `#endif`,
      ``,
    ].join("\n"),
  );
  // Stub .cxx — empty. Compiled as the "main file"; wrapper is force-included.
  // The pragma is ignored in main files but works in includes, hence this dance.
  writeIfChanged(stubCxx, `/* generated by scripts/build/compile.ts */\n`);

  // CMake's approach (replicated here): compile an EMPTY stub .cxx as the
  // main file, force-include the wrapper .hxx via -Xclang -include, emit
  // the PCH via -Xclang -emit-pch. The indirection lets `#pragma clang
  // system_header` in the wrapper take effect — that pragma is ignored
  // when the file containing it is the MAIN file, but works when the
  // file is included. -fpch-instantiate-templates: instantiate templates
  // during PCH compilation instead of deferring to each consuming .cpp
  // (faster builds, CMake does this too).
  // -MD (not -MMD): the wrapper header has `#pragma clang system_header` to
  // suppress JSC warnings, which makes everything it transitively includes
  // "system" for -MMD purposes. -MMD would give a near-empty depfile; -MD
  // tracks all headers so PCH invalidates when WebKit headers change.
  // -fno-pch-timestamp: don't embed input mtimes in the PCH. A cached PCH's
  // embedded mtime can be stale (e.g. after deleting pch/ and reconfiguring)
  // → every consumer fails with "mtime changed". The depfile already
  // tracks invalidation; clang's redundant mtime check just fights caching.
  // Windows: -Xclang -include, NOT /FI. clang-cl's /FI auto-promotes to
  // -include-pch when a .pch already exists at the /Fp path — even for the
  // /Yc -emit-pch cc1 job — so a stale PCH (e.g. after a cxxflags change)
  // gets validated instead of overwritten and the build fails with
  // "<langopt> was enabled in precompiled file but is currently disabled".
  // -Xclang goes straight to cc1, bypassing the driver's auto-detection.
  //
  // No ccache for the PCH. CCACHE_BASEDIR + CCACHE_NOHASHDIR (set in
  // configure.ts so worktrees share .o cache entries) makes the pch compile
  // hash identically across worktrees, but clang bakes ABSOLUTE header paths
  // into the .pch artifact. ccache would serve worktree A's .pch (with
  // /path/to/A/src/... inside) to worktree B; B's .cpp files then see
  // every PCH-reached header at A's path and their own #include of the same
  // header at B's path → #pragma once doesn't match → "redefinition of
  // 'DOMClientIsoSubspaces'" et al. The pch compile is one ~10-15s job per
  // build; the cross-worktree correctness hazard outweighs the cache savings.
  const wrapper = n.rel(wrapperHeader);
  const argv = cfg.windows
    ? [
        cfg.cxx,
        "/nologo",
        "/showIncludes",
        ...opts.flags,
        "/clang:-fpch-instantiate-templates",
        "-Xclang",
        "-fno-pch-timestamp",
        `/Yc${wrapper}`,
        "-Xclang",
        "-include",
        "-Xclang",
        wrapper,
        `/Fp${n.rel(out)}`,
        "/c",
        n.rel(stubCxx),
        `/Fo${n.rel(stubObj)}`,
      ]
    : [
        cfg.cxx,
        ...opts.flags,
        "-Winvalid-pch",
        "-fpch-instantiate-templates",
        "-Xclang",
        "-fno-pch-timestamp",
        "-Xclang",
        "-emit-pch",
        "-Xclang",
        "-include",
        "-Xclang",
        wrapper,
        "-x",
        "c++-header",
        "-MD",
        "-MT",
        n.rel(out),
        "-MF",
        `${n.rel(out)}.d`,
        "-c",
        n.rel(stubCxx),
        "-o",
        n.rel(out),
      ];

  n.task({
    kind: "pch",
    label: n.rel(out),
    commands: [{ argv }],
    outputs: [out],
    // clang-cl /Yc always writes the stub's .obj as a side effect. Declared
    // so the engine tracks and cleans it; nothing links it.
    implicitOutputs: cfg.windows ? [stubObj] : undefined,
    // Compile the STUB, force-include the wrapper.
    inputs: [stubCxx],
    // absHeader + wrapper editing must rebuild PCH. Dep outputs too — see
    // the docstring above for why these can't be order-only (startup-stat
    // vs mid-build header regeneration). The depfile tracks the REST.
    implicitInputs: [absHeader, wrapperHeader, ...(opts.implicitInputs ?? [])],
    after: opts.orderOnlyInputs,
    depfile: depfileFor(cfg, out),
    pool: COMPILE_POOL,
  });

  return { pch: out, wrapperHeader };
}

// ---------------------------------------------------------------------------
// Link & archive
// ---------------------------------------------------------------------------

export interface LinkOpts {
  /** Static libraries to link (absolute paths). Included in $in. */
  libs: string[];
  /** Linker flags. */
  flags: string[];
  /**
   * Files the link reads that aren't in $in — symbol lists (symbols.def,
   * symbols.txt, symbols.dyn), linker scripts (linker.lds), manifests.
   * Editing these should trigger relink (cmake's LINK_DEPENDS equivalent).
   */
  implicitInputs?: string[];
  /** Map files the link's flags make it write alongside the executable (flags.ts linkerMapOutputs). */
  linkerMapOutputs?: string[];
}

/**
 * Link an executable. Returns absolute path to output (with cfg.exeSuffix
 * appended — clang-cl /Fe auto-appends .exe; ninja's output path must match).
 */
export function link(n: Ninja, cfg: Config, out: string, objects: string[], opts: LinkOpts): string {
  const absOut = resolve(cfg.buildDir, out + cfg.exeSuffix);
  const rsp = `${absOut}.rsp`;

  // Object lists get long (>32k args breaks on windows): a response file
  // carries the inputs. The link owns the console: it is inherently serial
  // (one exe), takes 30s+ on large binaries, and lld prints useful progress
  // (undefined symbol errors, --verbose timing).
  //
  // Windows: -fuse-ld=lld forces lld-link (VS dev shell puts link.exe
  // first in PATH, clang-cl would default to it). /link separator —
  // everything after passes verbatim to lld-link. Our ldflags are all
  // pure linker options (/STACK, /DEF, /OPT, /errorlimit, system libs)
  // that clang-cl's driver doesn't recognize.
  //
  // /clang:-B<dir of cfg.ld> pins WHICH lld-link `-fuse-ld=lld` resolves:
  // -B program-prefix dirs are searched before the driver's own InstalledDir
  // and PATH. Normally that's the same host-LLVM lld-link the driver would
  // pick anyway; under cross-language LTO resolveConfig() swaps cfg.ld to
  // rustc's gcc-ld/lld-link (newer LLVM, able to read rustc's bitcode), and
  // this is what makes the link actually use it — clang-cl has no working
  // --ld-path= spelling, and `-fuse-ld=<abs path>` mangles the path with the
  // target triple.
  const argv = cfg.windows
    ? [
        cfg.cxx,
        "/nologo",
        "-fuse-ld=lld",
        `/clang:-B${dirname(cfg.ld)}`,
        `@${n.rel(rsp)}`,
        `/Fe${n.rel(absOut)}`,
        "/link",
        ...opts.flags,
      ]
    : [cfg.cxx, `@${n.rel(rsp)}`, ...opts.flags, "-o", n.rel(absOut)];

  n.task({
    kind: "link",
    label: n.rel(absOut),
    // Darwin cross links and rust-lld ELF links need a fixup on the linked
    // file (re-sign, compress DWARF). They run after the link succeeds, so
    // the declared output is the final artifact. See shims.ts.
    commands: [{ argv }, ...postlinkCommands(cfg, n.rel(absOut))],
    outputs: [absOut],
    // Linker maps: tracked, but not the product.
    implicitOutputs: (opts.linkerMapOutputs ?? []).map(map => resolve(cfg.buildDir, map)),
    inputs: [...objects, ...opts.libs],
    implicitInputs: opts.implicitInputs,
    rspfile: rsp,
    console: true,
  });

  return absOut;
}

/**
 * Create a static library. Returns absolute path to output. `implicitInputs`
 * are waited for but not archived (the forbidUndefined stamps of the dep
 * objects going in).
 */
export function ar(n: Ninja, cfg: Config, out: string, objects: string[], implicitInputs: string[] = []): string {
  const absOut = resolve(cfg.buildDir, out);
  const rsp = `${absOut}.rsp`;

  n.task({
    kind: "ar",
    label: n.rel(absOut),
    commands: [
      {
        argv: cfg.windows
          ? [cfg.ar, "/nologo", `/out:${n.rel(absOut)}`, `@${n.rel(rsp)}`]
          : [cfg.ar, "rcs", n.rel(absOut), `@${n.rel(rsp)}`],
      },
    ],
    outputs: [absOut],
    inputs: objects,
    implicitInputs,
    rspfile: rsp,
  });

  return absOut;
}

// ---------------------------------------------------------------------------
// Path computation
// ---------------------------------------------------------------------------

/**
 * Compute the .o output path for a source file.
 *
 * Mirrors the source tree under obj/, so `src/jsc/bindings/foo.cpp` →
 * `obj/src/jsc/bindings/foo.cpp.o`. Generated sources (codegen .cpp
 * files under buildDir) go under `obj/codegen/` to keep a single tree.
 * The runner creates the parent directory before the compiler runs.
 */
function objectPath(cfg: Config, src: string): string {
  const absSrc = resolve(cfg.cwd, src);

  // Normalize to repo-root-relative path. Generated sources (in buildDir)
  // get mapped to their buildDir-relative location so `codegen/Foo.cpp`
  // stays `codegen/Foo.cpp.o` — no prefix needed since codegen/ doesn't
  // collide with any src/ subdir.
  let relSrc: string;
  if (absSrc.startsWith(cfg.buildDir)) {
    relSrc = relative(cfg.buildDir, absSrc);
  } else {
    relSrc = relative(cfg.cwd, absSrc);
    // --local-deps checkouts may live outside the repo; map them onto the
    // vendor/<name>/ path the pinned source would have so obj/ stays a tree.
    for (const [name, dir] of Object.entries(cfg.localDeps)) {
      if (absSrc.startsWith(dir + sep)) {
        relSrc = relative(cfg.cwd, resolve(cfg.vendorDir, name, relative(dir, absSrc)));
        break;
      }
    }
  }
  assert(!relSrc.startsWith(".."), `object path for ${absSrc} escapes the build dir (obj/${relSrc})`);

  return resolve(cfg.buildDir, "obj", relSrc + cfg.objSuffix);
}
