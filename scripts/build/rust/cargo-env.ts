/**
 * cargo conventions shared by configure (units.ts) and the build-time driver (run.ts): the shape of a
 * parsed build-script output and cargo's environment-variable naming.
 */

/** What `run.ts build-script` writes to `output.json` (cargo: `BuildOutput`), read back by the package's rustc edges and dependents' scripts. */
export interface BuildScriptOutput {
  /** `rustc-link-lib` → `-l` on the package's lib */
  linkLibs: string[];
  /** `rustc-link-search` → `-L` on the package's units and every dependent (transitively) */
  linkSearch: string[];
  /** `rustc-link-arg*` → `-C link-arg=` (kept with their target selector) */
  linkArgs: [selector: string, arg: string][];
  cfgs: string[];
  checkCfgs: string[];
  env: [string, string][];
  /** `cargo::metadata=K=V` / old-syntax `cargo:K=V` → `DEP_<LINKS>_<K>` in dependents' build scripts */
  metadata: [string, string][];
  rerunIfChanged: string[];
  rerunIfEnvChanged: string[];
  warnings: string[];
  /** `cargo::error=` — the script reports failure this way even when it exits 0 */
  errors: string[];
  /**
   * `OUT_DIR` after the run: relative path → content hash. Part of the output so that a script generating
   * *different* code changes output.json (defeating restat) and the package recompiles in the same build; files
   * regenerated with identical content get their previous mtime back and disturb nothing.
   */
  outDirFiles: [string, string][];
}

/** cargo `envify`: upper-case, `-` → `_` (feature names, `links` names, cfg names in environment variables). */
export function envify(s: string): string {
  return s.toUpperCase().replace(/-/g, "_");
}

/** The dynamic-library search path variable for the machine running the build (cargo `paths::dylib_path_envvar`). */
export function dylibPathVar(hostOs: string): string {
  return hostOs === "windows" ? "PATH" : hostOs === "darwin" ? "DYLD_FALLBACK_LIBRARY_PATH" : "LD_LIBRARY_PATH";
}
