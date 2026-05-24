#!/usr/bin/env bun
/**
 * rustc invoker for the direct-rustc ninja graph.
 *
 * Plays cargo's role for a single `build` unit: applies the consuming
 * crate's build-script directives (those aren't known until the script ran,
 * so they can't be baked into `build.ninja`), sets the `CARGO_*` env rustc
 * macros (`env!("CARGO_PKG_NAME")` etc.) read, then execs rustc.
 *
 * Everything that *is* known at configure time — `--crate-name`, `--edition`,
 * `--extern`, `-C metadata`, the profile flags, the target rustflags — is
 * already on the rustc argv ninja passes after `--`.
 *
 * Invoked as:
 *   rustc-runner.ts <json-spec> -- <rustc> <rustc-args...>
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

interface RustcSpec {
  pkgName: string;
  pkgVersion: string;
  manifestDir: string;
  /** Captured build-script stdout file (from buildscript-runner), if this crate has one. */
  buildScriptOutput: string | undefined;
  /** OUT_DIR — passed as env so `env!("OUT_DIR")` / `include!` resolve. */
  outDir: string | undefined;
  /** Extra env (BUN_CODEGEN_DIR, CARGO_HOME, RUSTUP_TOOLCHAIN, …). */
  extraEnv: Record<string, string>;
}

const sep = process.argv.indexOf("--");
if (sep < 3 || sep === process.argv.length - 1) {
  console.error("usage: rustc-runner.ts <json-spec> -- <rustc> <args...>");
  process.exit(2);
}
const spec: RustcSpec = JSON.parse(process.argv[2]!);
const rustc = process.argv[sep + 1]!;
const args = process.argv.slice(sep + 2);

// ─── Apply build-script directives ───
// Subset of cargo's `BuildOutput::parse` covering everything the bun_bin
// graph's scripts emit (libc/rustix/thiserror/crossbeam: rustc-cfg +
// rustc-check-cfg; selectors/generic-array/bun_install: OUT_DIR writes;
// proc-macro2/quote/paste/rustversion: rustc-cfg + rerun-if-*). `links`
// metadata propagation (`DEP_<links>_<key>`) is not implemented — the only
// `links` crate in our graph is lol_html_c_api whose build.rs is empty.
const scriptEnv: Record<string, string> = {};
if (spec.buildScriptOutput !== undefined) {
  const out = readFileSync(spec.buildScriptOutput, "utf8");
  for (const raw of out.split("\n")) {
    const m = raw.match(/^cargo::?([a-z_-]+)=(.*)$/);
    if (!m) continue;
    const [, key, val] = m as [string, string, string];
    switch (key) {
      case "rustc-cfg":
        args.push("--cfg", val);
        break;
      case "rustc-check-cfg":
        args.push("--check-cfg", val);
        break;
      case "rustc-env": {
        const eq = val.indexOf("=");
        if (eq > 0) scriptEnv[val.slice(0, eq)] = val.slice(eq + 1);
        break;
      }
      case "rustc-link-search":
        // `KIND=PATH` or bare `PATH`; rustc's `-L` accepts both forms.
        args.push("-L", val);
        break;
      case "rustc-link-lib":
        args.push("-l", val);
        break;
      case "rustc-link-arg":
        args.push("-C", `link-arg=${val}`);
        break;
      case "rustc-flags":
        // Space-separated `-l`/`-L` only (cargo enforces); split and forward.
        for (const f of val.split(/\s+/).filter(Boolean)) args.push(f);
        break;
      case "rerun-if-changed":
      case "rerun-if-env-changed":
      case "warning":
        break; // handled by buildscript-runner / ninja depfile
      default:
        // `cargo:KEY=VALUE` with no `rustc-` prefix is `links` metadata;
        // we have no consumer (see header). Ignore loudly so a new dep
        // that needs it surfaces.
        if (!raw.startsWith("cargo::metadata=")) {
          console.error(`rustc-runner: unhandled directive from ${spec.pkgName}: ${raw}`);
        }
    }
  }
}

// ─── CARGO_* env for `env!()` macros in the crate source ───
const ver = spec.pkgVersion.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?/);
const env: NodeJS.ProcessEnv = {
  ...process.env,
  ...spec.extraEnv,
  ...scriptEnv,
  CARGO_PKG_NAME: spec.pkgName,
  CARGO_PKG_VERSION: spec.pkgVersion,
  CARGO_PKG_VERSION_MAJOR: ver?.[1] ?? "0",
  CARGO_PKG_VERSION_MINOR: ver?.[2] ?? "0",
  CARGO_PKG_VERSION_PATCH: ver?.[3] ?? "0",
  CARGO_PKG_VERSION_PRE: ver?.[4] ?? "",
  CARGO_PKG_AUTHORS: "",
  CARGO_PKG_DESCRIPTION: "",
  CARGO_PKG_HOMEPAGE: "",
  CARGO_PKG_REPOSITORY: "",
  CARGO_PKG_LICENSE: "",
  CARGO_PKG_LICENSE_FILE: "",
  CARGO_PKG_RUST_VERSION: "",
  CARGO_PKG_README: "",
  CARGO_MANIFEST_DIR: spec.manifestDir,
  CARGO_MANIFEST_PATH: `${spec.manifestDir}/Cargo.toml`,
  CARGO_CRATE_NAME: spec.pkgName.replace(/-/g, "_"),
};
if (spec.outDir !== undefined) env.OUT_DIR = spec.outDir;

const r = spawnSync(rustc, args, { env, stdio: "inherit" });
if (r.error) {
  console.error(`rustc-runner: failed to spawn ${rustc}: ${r.error.message}`);
  process.exit(1);
}
process.exit(r.status ?? 1);
