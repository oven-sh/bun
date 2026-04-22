/**
 * Compilation constructors.
 *
 * These are NOT abstractions — they're shortcuts that build a `BuildNode` and
 * register it with the Ninja instance. A "library" is just an array of cxx()
 * outputs + one ar() output. An executable is cxx() outputs + one link().
 */

import { mkdirSync } from "node:fs";
import { basename, dirname, extname, relative, resolve } from "node:path";
import type { Config } from "./config.ts";
import { assert } from "./error.ts";
import { writeIfChanged } from "./fs.ts";
import type { BuildNode, Ninja, Rule } from "./ninja.ts";
import { quote } from "./shell.ts";
import { streamPath } from "./stream.ts";

// ---------------------------------------------------------------------------
// Rule registration — call once per Ninja instance
// ---------------------------------------------------------------------------

/**
 * Register all compilation-related ninja rules.
 * Call once before using cxx/cc/pch/link/ar.
 */
export function registerCompileRules(n: Ninja, cfg: Config): void {
  // Quote tool paths — ninja passes commands through cmd/sh; a space in a
  // toolchain path (e.g. "C:\Program Files\LLVM\bin\clang-cl.exe") would
  // split argv without quoting. quote() passes through safe paths unchanged.
  const q = (p: string) => quote(p, cfg.windows);
  const cc = q(cfg.cc);
  const cxx = q(cfg.cxx);
  const ar = q(cfg.ar);
  const ccacheLauncher = cfg.ccache !== undefined ? `${q(cfg.ccache)} ` : "";

  // Depfile handling differs between clang (gcc-style .d) and clang-cl (/showIncludes)
  const depfileOpts: Pick<Rule, "depfile" | "deps"> = cfg.windows
    ? { deps: "msvc" }
    : { depfile: "$out.d", deps: "gcc" };

  // ─── C++ compile ───
  // Note: $cxxflags is set per-build (allows per-file overrides).
  n.rule("cxx", {
    command: cfg.windows
      ? `${ccacheLauncher}${cxx} /nologo /showIncludes $cxxflags /c $in /Fo$out`
      : `${ccacheLauncher}${cxx} $cxxflags -MMD -MT $out -MF $out.d -c $in -o $out`,
    description: "cxx $out",
    ...depfileOpts,
  });

  // ─── C++ compile with PCH ───
  // PCH is loaded with -include-pch (clang) or /Yu (clang-cl).
  // $pch_file is the .pch/.gch output, $pch_header is the wrapper .hxx.
  //
  // Both -include-pch AND -include (force-include of the wrapper) are passed,
  // mirroring CMake's target_precompile_headers(). The force-include re-applies
  // `#pragma clang system_header` for the current translation unit's
  // preprocessing pass — without it, warnings from PCH-included headers aren't
  // suppressed (the pragma's effect is per-preprocessing-pass, not per-AST).
  // The -Xclang prefix is required: plain -include doesn't combine with PCH
  // on the clang driver, but -Xclang bypasses the driver's sanity check.
  //
  // clang-cl: same -Xclang -include-pch / -include pair as posix. clang-cl
  // accepts -Xclang directly. The MSVC-style alternative (/Yu + /FI) does
  // NOT work: clang-cl's /Yu scans the literal source for the through-header
  // and ignores /FI-injected includes, so it errors with "#include ... not
  // seen" on any TU that doesn't itself spell out the wrapper include.
  n.rule("cxx_pch", {
    command: cfg.windows
      ? `${ccacheLauncher}${cxx} /nologo /showIncludes $cxxflags -Xclang -include-pch -Xclang $pch_file -Xclang -include -Xclang $pch_header /c $in /Fo$out`
      : `${ccacheLauncher}${cxx} $cxxflags -Winvalid-pch -Xclang -include-pch -Xclang $pch_file -Xclang -include -Xclang $pch_header -MMD -MT $out -MF $out.d -c $in -o $out`,
    description: "cxx $out",
    ...depfileOpts,
  });

  // ─── C compile ───
  n.rule("cc", {
    command: cfg.windows
      ? `${ccacheLauncher}${cc} /nologo /showIncludes $cflags /c $in /Fo$out`
      : `${ccacheLauncher}${cc} $cflags -MMD -MT $out -MF $out.d -c $in -o $out`,
    description: "cc $out",
    ...depfileOpts,
  });

  // ─── NASM assemble (Windows-x64 only) ───
  // BoringSSL's win-x64 assembly is NASM syntax; clang can't assemble it.
  // -MD writes a Make-style depfile; nasm 2.14+ supports it.
  if (cfg.nasm !== undefined) {
    n.rule("nasm", {
      command: `${q(cfg.nasm)} $nasmflags -MD $out.d -o $out $in`,
      description: "nasm $out",
      depfile: "$out.d",
      deps: "gcc",
    });
  }

  // ─── PCH compilation ───
  // Compiles a header into a precompiled header.
  //
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
  n.rule("pch", {
    command: cfg.windows
      ? `${ccacheLauncher}${cxx} /nologo /showIncludes $cxxflags /clang:-fpch-instantiate-templates /Yc$pch_header /FI$pch_header /Fp$out /c $in /Fo$pch_stub_obj`
      : `${ccacheLauncher}${cxx} $cxxflags -Winvalid-pch -fpch-instantiate-templates -Xclang -emit-pch -Xclang -include -Xclang $pch_header -x c++-header -MD -MT $out -MF $out.d -c $in -o $out`,
    description: "pch $out",
    ...depfileOpts,
  });

  // ─── Link executable ───
  // Uses response file because object lists get long (>32k args breaks on windows).
  // console pool: link is inherently serial (one exe), takes 30s+ on large
  // binaries, and lld prints useful progress (undefined symbol errors,
  // --verbose timing). Streaming beats sitting at [N/N] wondering if it hung.
  // stream.ts --console: passthrough + ninja Windows buffering fix — see stream.ts.
  //
  // Windows: -fuse-ld=lld forces lld-link (VS dev shell puts link.exe
  // first in PATH, clang-cl would default to it). /link separator —
  // everything after passes verbatim to lld-link. Our ldflags are all
  // pure linker options (/STACK, /DEF, /OPT, /errorlimit, system libs)
  // that clang-cl's driver doesn't recognize.
  const wrap = `${cfg.jsRuntime} ${q(streamPath)} link --console`;
  n.rule("link", {
    command: cfg.windows
      ? `${wrap} ${cxx} /nologo -fuse-ld=lld @$out.rsp /Fe$out /link $ldflags`
      : `${wrap} ${cxx} @$out.rsp $ldflags -o $out`,
    description: "link $out",
    rspfile: "$out.rsp",
    rspfile_content: "$in_newline",
    pool: "console",
  });

  // ─── Static library archive ───
  n.rule("ar", {
    command: cfg.windows ? `${ar} /nologo /out:$out @$out.rsp` : `${ar} rcs $out @$out.rsp`,
    description: "ar $out",
    rspfile: "$out.rsp",
    rspfile_content: "$in_newline",
  });
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
 * E.g. src/bun.js/bindings/foo.cpp → obj/src_bun.js_bindings_foo.cpp.o
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
 * Assemble a NASM-syntax `.asm` file. Returns absolute path to the .obj
 * output. Windows-x64 only — gas-syntax `.S` goes through cc().
 */
export function nasm(
  n: Ninja,
  cfg: Config,
  src: string,
  opts: { flags: string[]; orderOnlyInputs?: string[] },
): string {
  assert(extname(src) === ".asm", `nasm() expects .asm source, got: ${src}`);
  assert(cfg.nasm !== undefined, "nasm not found in toolchain", {
    hint: "Install from https://nasm.us or `winget install NASM.NASM`",
  });
  const out = objectPath(cfg, src);
  n.build({
    outputs: [out],
    rule: "nasm",
    inputs: [resolve(cfg.cwd, src)],
    orderOnlyInputs: [objectDirStamp(cfg), ...(opts.orderOnlyInputs ?? [])],
    vars: { nasmflags: opts.flags.join(" ") },
  });
  return out;
}

function compile(n: Ninja, cfg: Config, src: string, opts: CompileOpts, lang: "cxx" | "cc"): string {
  const absSrc = resolve(cfg.cwd, src);
  const out = objectPath(cfg, src);

  const rule = opts.pch !== undefined && lang === "cxx" ? "cxx_pch" : lang;
  const flagVar = lang === "cxx" ? "cxxflags" : "cflags";

  const implicitInputs: string[] = [...(opts.implicitInputs ?? [])];
  const vars: Record<string, string> = {
    [flagVar]: opts.flags.join(" "),
  };

  // PCH is always an implicit dep — if it changes, recompile.
  if (opts.pch !== undefined) {
    assert(opts.pchHeader !== undefined, "cxx with pch requires pchHeader (the wrapper .hxx)");
    implicitInputs.push(opts.pch);
    vars.pch_file = n.rel(opts.pch);
    vars.pch_header = n.rel(opts.pchHeader);
  }

  const node: BuildNode = {
    outputs: [out],
    rule,
    inputs: [absSrc],
    orderOnlyInputs: [objectDirStamp(cfg), ...(opts.orderOnlyInputs ?? [])],
    vars,
  };
  if (implicitInputs.length > 0) node.implicitInputs = implicitInputs;
  if (opts.pool !== undefined) node.pool = opts.pool;
  n.build(node);

  // Record for compile_commands.json
  n.addCompileCommand({
    directory: cfg.buildDir,
    file: absSrc,
    output: n.rel(out),
    arguments: [
      lang === "cxx" ? cfg.cxx : cfg.cc,
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

  const node: BuildNode = {
    outputs: [out],
    rule: "pch",
    // Compile the STUB, force-include the wrapper.
    inputs: [stubCxx],
    // absHeader + wrapper editing must rebuild PCH. Dep outputs too — see
    // the docstring above for why these can't be order-only (startup-stat
    // vs mid-build header regeneration). The depfile tracks the REST.
    implicitInputs: [absHeader, wrapperHeader, ...(opts.implicitInputs ?? [])],
    orderOnlyInputs: [pchDirStamp(cfg), ...(opts.orderOnlyInputs ?? [])],
    vars: {
      cxxflags: opts.flags.join(" "),
      pch_header: n.rel(wrapperHeader),
    },
  };
  if (cfg.windows) {
    node.implicitOutputs = [stubObj];
    node.vars!.pch_stub_obj = n.rel(stubObj);
  }
  n.build(node);

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
  /** Output linker map to this path (for debugging symbol bloat). */
  linkerMapOutput?: string;
}

/**
 * Link an executable. Returns absolute path to output (with cfg.exeSuffix
 * appended — clang-cl /Fe auto-appends .exe; ninja's output path must match).
 */
export function link(n: Ninja, cfg: Config, out: string, objects: string[], opts: LinkOpts): string {
  const absOut = resolve(cfg.buildDir, out + cfg.exeSuffix);

  // Linker map is an implicit output (ninja tracks it but not in $out)
  const implicitOutputs: string[] = [];
  if (opts.linkerMapOutput !== undefined) {
    implicitOutputs.push(resolve(cfg.buildDir, opts.linkerMapOutput));
  }

  const node: BuildNode = {
    outputs: [absOut],
    rule: "link",
    inputs: [...objects, ...opts.libs],
    vars: {
      ldflags: opts.flags.join(" "),
    },
  };
  if (implicitOutputs.length > 0) node.implicitOutputs = implicitOutputs;
  if (opts.implicitInputs !== undefined && opts.implicitInputs.length > 0) {
    node.implicitInputs = opts.implicitInputs;
  }
  n.build(node);

  return absOut;
}

/**
 * Create a static library. Returns absolute path to output.
 */
export function ar(n: Ninja, cfg: Config, out: string, objects: string[]): string {
  const absOut = resolve(cfg.buildDir, out);

  n.build({
    outputs: [absOut],
    rule: "ar",
    inputs: objects,
  });

  return absOut;
}

// ---------------------------------------------------------------------------
// Path computation
// ---------------------------------------------------------------------------

/**
 * Compute the .o output path for a source file.
 *
 * Mirrors the source tree under obj/, so `src/bun.js/bindings/foo.cpp` →
 * `obj/src/bun.js/bindings/foo.cpp.o`. Generated sources (codegen .cpp
 * files under buildDir) go under `obj/codegen/` to keep a single tree.
 *
 * Ninja does NOT auto-create parent directories of outputs. Directories
 * are created at configure time — each `cxx()`/`cc()` call tracks its
 * object's parent dir, and `createObjectDirs()` is called once at the end
 * of configure to mkdir the whole tree. Same approach as CMake, which
 * pre-creates `CMakeFiles/<target>.dir/` during its generate step.
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
  }

  return resolve(cfg.buildDir, "obj", relSrc + cfg.objSuffix);
}

/**
 * Stamp file for the obj/ directory. Object files depend on this order-only
 * so the dir exists before compilation runs.
 */
function objectDirStamp(cfg: Config): string {
  return resolve(cfg.buildDir, "obj", ".dir");
}

function pchDirStamp(cfg: Config): string {
  return resolve(cfg.buildDir, "pch", ".dir");
}

/**
 * Register directory stamp rules. Call once.
 */
export function registerDirStamps(n: Ninja, cfg: Config): void {
  const objDir = dirname(objectDirStamp(cfg));
  const pchDir = dirname(pchDirStamp(cfg));

  // Single rule, mkdir + touch stamp. Configure pre-creates these dirs;
  // the rule still runs once to write the stamp ninja tracks. Both sides
  // must tolerate "already exists" — posix has -p, cmd doesn't, so
  // suppress the error (2>nul) and touch unconditionally (&).
  n.rule("mkdir_stamp", {
    command: cfg.host.os === "windows" ? `cmd /c "mkdir $dir 2>nul & type nul > $out"` : `mkdir -p $dir && touch $out`,
    description: "mkdir $dir",
  });

  n.build({
    outputs: [objectDirStamp(cfg)],
    rule: "mkdir_stamp",
    inputs: [],
    vars: { dir: n.rel(objDir) },
  });

  n.build({
    outputs: [pchDirStamp(cfg)],
    rule: "mkdir_stamp",
    inputs: [],
    vars: { dir: n.rel(pchDir) },
  });
}
