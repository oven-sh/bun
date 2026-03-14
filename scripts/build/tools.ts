/**
 * Toolchain discovery.
 *
 * Finds compilers/tools in PATH + known platform-specific locations.
 * Version-checks when a constraint is given. Throws BuildError with a helpful
 * hint when a required tool is missing.
 */

import { execSync, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { Arch, OS, Toolchain } from "./config.ts";
import { BuildError } from "./error.ts";

// ───────────────────────────────────────────────────────────────────────────
// Version range checking
// ───────────────────────────────────────────────────────────────────────────

/**
 * Parse a version like "21.1.8" out of arbitrary text (tool --version output).
 * Returns the first X.Y.Z found, or undefined.
 */
function parseVersion(text: string): string | undefined {
  const m = text.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : undefined;
}

/**
 * Compare two X.Y.Z version strings. Returns -1, 0, 1.
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai !== bi) return ai < bi ? -1 : 1;
  }
  return 0;
}

/**
 * Check if a version satisfies a range string.
 *
 * Range syntax: `>=X.Y.Z <A.B.C` (space-separated constraints, all must pass).
 * Single version without operator = exact match.
 * Empty/undefined range = always satisfied.
 */
export function satisfiesRange(version: string, range: string | undefined): boolean {
  if (range === undefined || range === "" || range === "ignore") return true;
  const v = parseVersion(version);
  if (v === undefined) return false;

  for (const part of range.split(/\s+/)) {
    if (part === "") continue;
    const m = part.match(/^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/);
    if (!m) return false; // malformed range
    const op = m[1] ?? "=";
    const target = m[2];
    if (target === undefined) return false;
    const cmp = compareVersions(v, target);
    const ok =
      op === ">="
        ? cmp >= 0
        : op === ">"
          ? cmp > 0
          : op === "<="
            ? cmp <= 0
            : op === "<"
              ? cmp < 0
              : /* "=" */ cmp === 0;
    if (!ok) return false;
  }
  return true;
}

// ───────────────────────────────────────────────────────────────────────────
// Tool discovery
// ───────────────────────────────────────────────────────────────────────────

export interface ToolSpec {
  /** Names to try, in order. On Windows `.exe` is appended automatically. */
  names: string[];
  /** Extra search paths beyond $PATH. Tried FIRST (more specific). */
  paths?: string[];
  /** Version constraint, e.g. `">=21.1.0 <22.0.0"`. */
  version?: string;
  /** How to get the version. `"--version"` (default) or `"version"` (go/zig style). */
  versionArg?: string;
  /** If true, throws BuildError when not found. */
  required: boolean;
  /** Extra hint text for the error message. */
  hint?: string;
}

/**
 * Rejection log for a single tool search — used in error messages.
 */
interface Rejection {
  path: string;
  reason: string;
}

/**
 * Find the bun executable to use for codegen. Prefers ~/.bun/bin/bun over
 * process.execPath — CI agents pin an old system bun (/usr/bin/bun), but
 * codegen scripts use newer `bun build` CLI flags. cmake did the same
 * (SetupBun.cmake: PATHS $ENV{HOME}/.bun/bin before system PATH).
 *
 * Falls back to process.execPath (the bun running us) — always works for
 * local dev where system bun is recent enough.
 */
export function findBun(os: OS): string {
  const exe = os === "windows" ? "bun.exe" : "bun";
  const userBun = join(homedir(), ".bun", "bin", exe);
  if (isExecutable(userBun)) return userBun;
  return process.execPath;
}

/**
 * Check if a file exists and is executable.
 */
function isExecutable(p: string): boolean {
  try {
    // Must check isFile(): X_OK on a directory means "traversable", not
    // "runnable". Without this, a `cmake/` dir in a PATH entry would shadow
    // the real cmake binary.
    if (!statSync(p).isFile()) return false;
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the version of a tool. Returns the parsed X.Y.Z, or a diagnostic
 * string describing why parsing failed (starts with a digit → version,
 * otherwise → failure reason for the rejection log).
 */
function getToolVersion(exe: string, versionArg: string): { version: string } | { reason: string } {
  // stdio ignore on stdin: on Windows CI the parent's stdin can be a
  // handle that blocks the child's CRT init. --version never reads stdin.
  // 30s timeout: cold start of a large binary (clang is 100+ MB) through
  // Defender scan-on-access can legitimately exceed 5s on a busy CI box.
  const result = spawnSync(exe, [versionArg], {
    encoding: "utf8",
    timeout: 30_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    return { reason: `spawn failed: ${result.error.message}` };
  }
  // Some tools print version to stderr (e.g. some zig builds). Check both.
  const version = parseVersion(result.stdout ?? "") ?? parseVersion(result.stderr ?? "");
  if (version !== undefined) return { version };
  // Parse failed — include what we saw (truncated) so the error is
  // actionable instead of just "could not parse".
  const output = ((result.stdout ?? "") + (result.stderr ?? "")).trim().slice(0, 200);
  if (result.status !== 0) {
    return { reason: `exited ${result.status}: ${output || "(no output)"}` };
  }
  return { reason: `no X.Y.Z in output: ${output || "(empty)"}` };
}

/**
 * Ask clang what arch it targets by default. Parses `Target:` from
 * `--version` output. Returns undefined if unparseable.
 *
 * CMake does this during compiler detection (project()) to set
 * CMAKE_SYSTEM_PROCESSOR — that's how the old cmake build knew arm64
 * even when cmake.exe itself was x64. process.arch reflects the running
 * process (may be emulated); the compiler's target is what we actually
 * build for.
 */
export function clangTargetArch(clang: string): Arch | undefined {
  const result = spawnSync(clang, ["--version"], {
    encoding: "utf8",
    timeout: 30_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) return undefined;
  const m = (result.stdout ?? "").match(/^Target:\s*(\S+)/m);
  if (!m) return undefined;
  const triple = m[1]!;
  // aarch64-pc-windows-msvc, arm64-apple-darwin, x86_64-unknown-linux-gnu, ...
  if (/^(aarch64|arm64)/.test(triple)) return "aarch64";
  if (/^(x86_64|x64|amd64)/i.test(triple)) return "x64";
  return undefined;
}

/**
 * Find a tool. Searches provided paths first, then $PATH.
 * Returns the absolute path or undefined (if not required).
 */
export function findTool(spec: ToolSpec): string | undefined {
  const exeSuffix = process.platform === "win32" ? ".exe" : "";
  const searchPaths = [...(spec.paths ?? []), ...(process.env.PATH ?? "").split(delimiter).filter(p => p.length > 0)];
  const versionArg = spec.versionArg ?? "--version";
  const rejections: Rejection[] = [];

  for (const name of spec.names) {
    const candidate = name.endsWith(exeSuffix) ? name : name + exeSuffix;
    for (const dir of searchPaths) {
      const full = join(dir, candidate);
      if (!isExecutable(full)) continue;

      if (spec.version !== undefined) {
        const v = getToolVersion(full, versionArg);
        if ("reason" in v) {
          rejections.push({ path: full, reason: v.reason });
          continue;
        }
        if (!satisfiesRange(v.version, spec.version)) {
          rejections.push({ path: full, reason: `version ${v.version} does not satisfy ${spec.version}` });
          continue;
        }
      }
      return full;
    }
  }

  if (spec.required) {
    const primaryName = spec.names[0] ?? "<unknown>";
    let msg = `Could not find ${primaryName}`;
    if (spec.version !== undefined) msg += ` (version ${spec.version})`;

    let hint = spec.hint ?? "";
    if (rejections.length > 0) {
      hint += (hint ? "\n" : "") + "Found but rejected:\n" + rejections.map(r => `  ${r.path}: ${r.reason}`).join("\n");
    }
    if (rejections.length === 0 && searchPaths.length > 0) {
      hint +=
        (hint ? "\n" : "") + `Searched: ${searchPaths.slice(0, 5).join(", ")}${searchPaths.length > 5 ? ", ..." : ""}`;
    }

    throw new BuildError(msg, hint ? { hint } : {});
  }
  return undefined;
}

// ───────────────────────────────────────────────────────────────────────────
// LLVM-specific discovery
// ───────────────────────────────────────────────────────────────────────────

/**
 * LLVM version constraint. Any version in the same major.minor range is
 * accepted (e.g. Alpine 3.23 ships 21.1.2 while we target 21.1.8).
 */
export const LLVM_VERSION = "21.1.8";
const LLVM_MAJOR = "21";
const LLVM_MINOR = "1";
const LLVM_VERSION_RANGE = `>=${LLVM_MAJOR}.${LLVM_MINOR}.0 <${LLVM_MAJOR}.${LLVM_MINOR}.99`;

/**
 * Known LLVM install locations per platform. Call ONCE from
 * resolveLlvmToolchain — it contains a spawn on macOS (brew --prefix as
 * fallback) which takes ~100ms, so calling it per-tool would dominate
 * configure time.
 */
function llvmSearchPaths(os: OS, arch: Arch): string[] {
  const paths: string[] = [];

  if (os === "darwin") {
    // Try the arch-default prefix first (correct for standard homebrew
    // installs — /opt/homebrew on Apple Silicon, /usr/local on Intel).
    // Only spawn `brew --prefix` as a last resort for custom installs —
    // brew's startup is slow and this runs on every configure.
    const defaultPrefix = arch === "aarch64" ? "/opt/homebrew" : "/usr/local";
    let brewPrefix: string;
    if (isExecutable(`${defaultPrefix}/bin/brew`)) {
      brewPrefix = defaultPrefix;
    } else {
      try {
        brewPrefix = execSync("brew --prefix", { encoding: "utf8", timeout: 3000 }).trim();
      } catch {
        brewPrefix = defaultPrefix;
      }
    }
    paths.push(`${brewPrefix}/opt/llvm@${LLVM_MAJOR}/bin`);
    paths.push(`${brewPrefix}/opt/llvm/bin`);
  }

  if (os === "windows") {
    // Prefer standalone LLVM over VS-bundled
    paths.push("C:\\Program Files\\LLVM\\bin");
  }

  if (os === "linux" || os === "darwin") {
    paths.push("/usr/lib/llvm/bin");
    // Debian/Ubuntu-style suffixed paths
    paths.push(`/usr/lib/llvm-${LLVM_MAJOR}.${LLVM_MINOR}.0/bin`);
    paths.push(`/usr/lib/llvm-${LLVM_MAJOR}.${LLVM_MINOR}/bin`);
    paths.push(`/usr/lib/llvm-${LLVM_MAJOR}/bin`);
    paths.push(`/usr/lib/llvm${LLVM_MAJOR}/bin`);
  }

  return paths;
}

/**
 * Version-suffixed command names (e.g. clang-21, clang-21.1).
 * Unix distros often only ship these suffixed versions.
 */
function llvmNameVariants(name: string): string[] {
  return [
    name,
    `${name}-${LLVM_MAJOR}.${LLVM_MINOR}.0`,
    `${name}-${LLVM_MAJOR}.${LLVM_MINOR}`,
    `${name}-${LLVM_MAJOR}`,
  ];
}

function llvmInstallHint(os: OS): string {
  if (os === "darwin") return `Install with: brew install llvm@${LLVM_MAJOR}`;
  if (os === "linux")
    return `Install with: apt install clang-${LLVM_MAJOR} lld-${LLVM_MAJOR}  (or equivalent for your distro)`;
  if (os === "windows") return `Install LLVM ${LLVM_VERSION} from https://github.com/llvm/llvm-project/releases`;
  return "";
}

/**
 * Find an LLVM tool with version checking. `paths` computed once by the
 * caller (contains a slow brew spawn on macOS).
 */
function findLlvmTool(
  baseName: string,
  paths: string[],
  os: OS,
  opts: { checkVersion: boolean; required: boolean },
): string | undefined {
  const spec: ToolSpec = {
    names: llvmNameVariants(baseName),
    paths,
    required: opts.required,
    hint: llvmInstallHint(os),
  };
  if (opts.checkVersion) spec.version = LLVM_VERSION_RANGE;
  return findTool(spec);
}

// ───────────────────────────────────────────────────────────────────────────
// Full toolchain resolution
// ───────────────────────────────────────────────────────────────────────────

/**
 * Resolve the entire toolchain for a target.
 *
 * Call this once at configure time. All tool paths are absolute.
 * Throws BuildError if any required tool is missing.
 *
 * zig/bun/esbuild are resolved separately (they come from cache/, not PATH)
 * so pass them in as placeholders for now; they'll be filled by downloaders.
 */
export function resolveLlvmToolchain(
  os: OS,
  arch: Arch,
): Pick<Toolchain, "cc" | "cxx" | "ar" | "ranlib" | "ld" | "strip" | "dsymutil" | "ccache" | "rc" | "mt"> {
  // Compute search paths ONCE. Contains a brew spawn on macOS (~100ms)
  // so calling it per-tool would burn ~600ms. Every tool below gets
  // the same paths; first-match-wins in findTool means whichever LLVM
  // install is highest-priority wins consistently.
  const paths = llvmSearchPaths(os, arch);

  // clang — version-checked. clang++ is the same binary (hardlink or
  // symlink) from the same install; a second version-check spawn would
  // just return the same answer. We still locate it separately so the
  // "not found" error names the right tool.
  const cc = findLlvmTool(os === "windows" ? "clang-cl" : "clang", paths, os, {
    checkVersion: true,
    required: true,
  });
  const cxx = findLlvmTool(os === "windows" ? "clang-cl" : "clang++", paths, os, {
    checkVersion: false,
    required: true,
  });

  // ar: llvm-ar (or llvm-lib on Windows)
  // No version check — ar doesn't always print a parseable version,
  // and any ar from the same LLVM install is fine.
  const ar = findLlvmTool(os === "windows" ? "llvm-lib" : "llvm-ar", paths, os, {
    checkVersion: false,
    required: true,
  });

  // ranlib: llvm-ranlib (unix only — Windows uses llvm-lib which doesn't need it)
  // Needed for nested cmake builds (CMAKE_RANLIB). llvm-ar's `s` flag does the
  // same thing for our direct archives, but deps may call ranlib explicitly.
  let ranlib: string | undefined;
  if (os !== "windows") {
    ranlib = findLlvmTool("llvm-ranlib", paths, os, {
      checkVersion: false,
      required: true,
    });
  }

  // ld: ld.lld on Linux (passed as --ld-path=), lld-link on Windows.
  // On Darwin clang drives the system linker directly.
  let ld: string;
  if (os === "windows") {
    const found = findLlvmTool("lld-link", paths, os, { checkVersion: false, required: true });
    ld = found ?? ""; // unreachable (required=true throws), but keeps types happy
  } else if (os === "linux") {
    const found = findLlvmTool("ld.lld", paths, os, { checkVersion: true, required: true });
    ld = found ?? "";
  } else {
    ld = ""; // darwin: unused
  }

  // strip: GNU strip on Linux (more features), llvm-strip elsewhere
  let strip: string;
  if (os === "linux") {
    const found = findTool({
      names: ["strip"],
      required: true,
      hint: "Install binutils for your distro",
    });
    strip = found ?? "";
  } else {
    const found = findLlvmTool("llvm-strip", paths, os, { checkVersion: false, required: true });
    strip = found ?? "";
  }

  // dsymutil: darwin only
  let dsymutil: string | undefined;
  if (os === "darwin") {
    dsymutil = findLlvmTool("dsymutil", paths, os, { checkVersion: false, required: true });
  }

  // rc/mt: windows only. Passed to nested cmake — when CMAKE_C_COMPILER
  // is an explicit path, cmake's find_program for these may not search
  // the compiler's directory, so we resolve them here and pass
  // explicitly. rc is required (cmake's try_compile on windows uses
  // it); mt is optional (not all LLVM distros ship it — source.ts sets
  // CMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY as fallback).
  let rc: string | undefined;
  let mt: string | undefined;
  if (os === "windows") {
    rc = findLlvmTool("llvm-rc", paths, os, { checkVersion: false, required: true });
    mt = findLlvmTool("llvm-mt", paths, os, { checkVersion: false, required: false });
  }

  // ccache: optional. If found, used as compiler launcher.
  const ccache = findTool({
    names: ["ccache"],
    required: false,
  });

  // These are definitely defined at this point (required=true throws otherwise),
  // but TS can't see through that, so assert.
  if (cc === undefined || cxx === undefined || ar === undefined) {
    throw new BuildError("unreachable: required tool undefined");
  }
  if (strip === "") {
    throw new BuildError("unreachable: strip undefined");
  }

  return { cc, cxx, ar, ranlib, ld, strip, dsymutil, ccache, rc, mt };
}

/**
 * Find an arbitrary system tool (not LLVM-specific).
 * Thin wrapper for convenience.
 */
export function findSystemTool(name: string, opts?: { required?: boolean; hint?: string }): string | undefined {
  const spec: ToolSpec = {
    names: [name],
    required: opts?.required ?? false,
  };
  if (opts?.hint !== undefined) spec.hint = opts.hint;
  return findTool(spec);
}

// ───────────────────────────────────────────────────────────────────────────
// Rust toolchain (cargo) — needed for lolhtml only
// ───────────────────────────────────────────────────────────────────────────

export interface CargoToolchain {
  cargo: string;
  cargoHome: string;
  rustupHome: string;
}

/**
 * Find cargo + its home directories. Returns undefined if cargo isn't
 * installed — caller decides whether to error (only needed when building
 * rust deps from source).
 */
export function findCargo(hostOs: OS): CargoToolchain | undefined {
  // Resolve CARGO_HOME and RUSTUP_HOME the same way rustup does:
  // explicit env var → platform default. We don't probe %PROGRAMFILES%
  // for MSI installs — rustup is overwhelmingly the common case.
  const home = homedir();
  const cargoHome = process.env.CARGO_HOME ?? join(home, ".cargo");
  const rustupHome = process.env.RUSTUP_HOME ?? join(home, ".rustup");

  // Search $CARGO_HOME/bin BEFORE $PATH. Some systems have an outdated
  // distro cargo in /usr/bin that shadows rustup's — we want rustup's.
  const cargo = findTool({
    names: ["cargo"],
    paths: [join(cargoHome, "bin")],
    required: false,
  });
  if (cargo === undefined) return undefined;

  // Suppress unused warning for hostOs — kept in signature for future
  // host-specific path resolution (e.g. %PROGRAMFILES% probing on win32).
  void hostOs;

  return { cargo, cargoHome, rustupHome };
}

/**
 * Find MSVC's link.exe. Windows only.
 *
 * Needed because on CI, Git Bash's `/usr/bin/link` (the GNU coreutils
 * hard-link utility) can appear in PATH before MSVC's link.exe. Cargo
 * invokes `link.exe` to link, and the wrong one silently fails.
 *
 * We probe the standard VS2022 install layout rather than trusting PATH.
 * If VS is installed somewhere non-standard, set the CARGO_TARGET_*_LINKER
 * env var yourself.
 */
export function findMsvcLinker(arch: Arch): string | undefined {
  // VS2022 standard layout:
  //   C:/Program Files/Microsoft Visual Studio/2022/<edition>/VC/Tools/MSVC/<ver>/bin/<host>/<target>/link.exe
  // Edition is Community|Professional|Enterprise|BuildTools.
  const vsBase = "C:/Program Files/Microsoft Visual Studio/2022";
  if (!existsSync(vsBase)) return undefined;

  // Pick the latest MSVC toolset version across all editions. Usually
  // there's only one edition installed, but BuildTools + Community can
  // coexist on CI.
  let latestVer: string | undefined;
  let latestToolset: string | undefined;
  for (const edition of readdirSync(vsBase)) {
    const msvcDir = join(vsBase, edition, "VC/Tools/MSVC");
    if (!existsSync(msvcDir)) continue;
    for (const ver of readdirSync(msvcDir)) {
      // Lexicographic comparison works for MSVC versions (14.xx.yyyyy).
      if (latestVer === undefined || ver > latestVer) {
        latestVer = ver;
        latestToolset = join(msvcDir, ver);
      }
    }
  }
  if (latestToolset === undefined) return undefined;

  // For arm64 targets, prefer the native arm64 host linker if available
  // (faster), else cross from x64. For x64 targets, use the x64 host.
  const candidates: string[] = [];
  if (arch === "aarch64") {
    candidates.push(join(latestToolset, "bin/HostARM64/arm64/link.exe"));
    candidates.push(join(latestToolset, "bin/Hostx64/arm64/link.exe"));
  } else {
    candidates.push(join(latestToolset, "bin/Hostx64/x64/link.exe"));
  }

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return undefined;
}
