#!/usr/bin/env bun
/**
 * Cross-crate dead-code analysis with hawk (see tools/hawk/README.md).
 *
 * `bun run rust:hawk [cargo hawk check args...]` scaffolds the throwaway
 * analysis root in src/bun_bin, runs `cargo hawk check` (the 11 shipped
 * targets unioned, per hawk.toml), then reverts the scaffolding.
 * e.g. `bun run rust:hawk --only dead-public`.
 *
 * `bun run rust:hawk install` builds cargo-hawk from the pinned fork rev
 * against the active toolchain (installs the `rustc-dev` component if needed).
 *
 * `bun run rust:hawk diff <base.json> <head.json>` compares two
 * `--output-format=json` reports and fails on findings present only in head.
 * main is not hawk-clean, so CI (.github/workflows/hawk.yml) runs the
 * analysis on the PR's base and head and reports only what the PR adds.
 *
 * Operates on the checkout in the current directory (`bun run` sets it to the
 * repo root) rather than the one containing this file: CI runs the PR's copy
 * of this script against the base checkout too.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// oven-sh/hawk `bun` branch: upstream hawk (astral-sh/hawk) plus multi-target
// analysis (astral-sh/hawk#150), per-profile cargo-profile/rustflags,
// [[root-marker]] for codegen-scraped exports, and driver support for bun's
// pinned nightly. The driver links rustc internals, so it must be BUILT with
// the same toolchain that later compiles the workspace: after a
// rust-toolchain.toml channel bump, `bun run rust:hawk install` again (and
// bump this rev if the branch needed fixes for the new nightly).
const HAWK_GIT = "https://github.com/oven-sh/hawk";
const HAWK_REV = "c9ca301a72a99e089598af515af5f31f8ff610c3";

const repoRoot = process.cwd();
const cargoTomlPath = join(repoRoot, "src", "bun_bin", "Cargo.toml");
const rootRsPath = join(repoRoot, "src", "bun_bin", "hawk_root.rs");
const scaffoldPatch = join("tools", "hawk", "analysis-root.patch");

function run(cmd: string[], opts: { env?: Record<string, string | undefined> } = {}): number {
  const r = spawnSync(cmd[0], cmd.slice(1), {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, ...opts.env },
  });
  return r.status ?? 1;
}

interface Diagnostic {
  category: "finding" | "configuration";
  code: string;
  identity?: { crate: string; item: string; kind: string };
  location?: { file: string; line: number; column: number };
  reason?: string;
  test_only?: boolean;
}

interface Report {
  schema_version: number;
  diagnostics: Diagnostic[];
}

function readReport(path: string): Report {
  const report = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(report?.diagnostics)) throw new Error(`${path} is not a hawk JSON report`);
  return report;
}

// Keyed on what the finding is about rather than hawk's `identity.id`, which
// embeds file:line and so would report every finding in a file as new
// whenever unrelated lines above it shift. An item compiled from several
// cfg alternatives yields one entry per alternative, hence counting.
function diagnosticKey(d: Diagnostic): string {
  const subject = d.identity
    ? `${d.identity.crate}|${d.identity.item}|${d.identity.kind}`
    : `${d.location?.file ?? ""}|${d.reason ?? ""}`;
  return `${d.code}|${subject}`;
}

const descriptions: Record<string, string> = {
  "hawk::dead_public": "is pub but nothing reachable from the shipped binary uses it, on any target",
  "hawk::unnecessary_public": "is pub but only used inside its own crate",
  "hawk::unnecessary_restricted_visibility": "has a restricted visibility it does not need",
};

function describe(d: Diagnostic): string {
  if (!d.identity) return d.reason ?? "configuration diagnostic";
  const item = `\`${d.identity.crate}::${d.identity.item}\` (${d.identity.kind.replaceAll("_", " ")})`;
  if (d.category === "configuration") return `hawk.toml entry for ${item}: ${d.code.replace("hawk::", "")}`;
  const what = descriptions[d.code] ?? d.code.replace("hawk::", "").replaceAll("_", " ");
  const testOnly = d.test_only ? " (used only by tests)" : "";
  return `${item} ${what}${testOnly}`;
}

function diffReports(base: Report, head: Report): number {
  if (base.schema_version !== head.schema_version) {
    console.error(`[hawk] report schema mismatch: base ${base.schema_version}, head ${head.schema_version}`);
    return 2;
  }

  const baseCounts = new Map<string, number>();
  for (const d of base.diagnostics) {
    const key = diagnosticKey(d);
    baseCounts.set(key, (baseCounts.get(key) ?? 0) + 1);
  }

  const headByKey = new Map<string, Diagnostic[]>();
  for (const d of head.diagnostics) {
    const key = diagnosticKey(d);
    const entries = headByKey.get(key);
    if (entries) entries.push(d);
    else headByKey.set(key, [d]);
  }

  const introduced: Diagnostic[] = [];
  let fixed = 0;
  for (const [key, count] of baseCounts) {
    const remaining = headByKey.get(key)?.length ?? 0;
    if (remaining < count) fixed += count - remaining;
  }
  for (const [key, entries] of headByKey) {
    if (entries.length > (baseCounts.get(key) ?? 0)) introduced.push(...entries);
  }
  introduced.sort((a, b) => {
    const fileOrder = (a.location?.file ?? "").localeCompare(b.location?.file ?? "");
    return fileOrder || (a.location?.line ?? 0) - (b.location?.line ?? 0);
  });

  // rustc-style so .github/rust-matcher.json turns each one into an inline
  // PR annotation.
  for (const d of introduced) {
    console.log(`error[${d.code}]: ${describe(d)}`);
    if (d.location) console.log(`  --> ${d.location.file}:${d.location.line}:${d.location.column}\n`);
  }
  console.log(
    `hawk: ${introduced.length} finding(s) introduced, ${fixed} fixed ` +
      `(base ${base.diagnostics.length}, head ${head.diagnostics.length})`,
  );

  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [`### hawk: ${introduced.length} finding(s) introduced, ${fixed} fixed`, ""];
    if (introduced.length > 0) {
      lines.push(
        "Items this PR makes dead or leaves more visible than needed (see tools/hawk/README.md).",
        "",
        ...introduced.map(d => {
          const where = d.location ? ` at \`${d.location.file}:${d.location.line}\`` : "";
          return `- \`${d.code}\`: ${describe(d)}${where}`;
        }),
      );
    }
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  }

  return introduced.length > 0 ? 1 : 0;
}

const args = process.argv.slice(2);

if (args[0] === "install") {
  const components = spawnSync("rustup", ["component", "list", "--installed"], { encoding: "utf8" });
  if (components.status === 0 && !components.stdout.includes("rustc-dev")) {
    console.log("[hawk] installing rustc-dev component (needed to build cargo-hawk)");
    if (run(["rustup", "component", "add", "rustc-dev"]) !== 0) process.exit(1);
  }
  process.exit(
    run(["cargo", "install", "--locked", "--force", "--git", HAWK_GIT, "--rev", HAWK_REV, "cargo-hawk"], {
      // Required because `cargo install` ignores the hawk repo's own cargo
      // config that normally enables rustc_private.
      env: { RUSTC_BOOTSTRAP: "1" },
    }),
  );
}

if (args[0] === "diff") {
  if (args.length !== 3) {
    console.error("usage: bun run rust:hawk diff <base.json> <head.json>");
    process.exit(2);
  }
  process.exit(diffReports(readReport(args[1]), readReport(args[2])));
}

if (!existsSync(join(repoRoot, "hawk.toml"))) {
  console.error(`[hawk] ${repoRoot} is not the repo root (no hawk.toml); run from the repo root`);
  process.exit(1);
}

if (spawnSync("cargo-hawk", ["--version"], { stdio: "ignore" }).error) {
  console.error("[hawk] cargo-hawk is not installed; run `bun run rust:hawk install` first");
  process.exit(1);
}

// The workspace can't compile without the `include!`d codegen output and the
// vendored lol_html path dependency.
const codegenDir = resolve(process.env.BUN_CODEGEN_DIR ?? join(repoRoot, "build", "debug", "codegen"));
if (
  !existsSync(join(codegenDir, "generated_classes.rs")) ||
  !existsSync(join(repoRoot, "vendor", "lolhtml", "Cargo.toml"))
) {
  console.error(`[hawk] missing codegen output or vendor/lolhtml; run:
  bun scripts/build.ts --configure-only && ninja -C build/debug codegen clone-lolhtml`);
  process.exit(1);
}

// Scaffold the analysis root (an rlib + throwaway [[bin]] in src/bun_bin;
// kept out of the tree permanently because the extra crate-type would disable
// fat LTO on the shipped staticlib). Revert only what this run applied, so a
// manually scaffolded tree is left alone.
const alreadyScaffolded = readFileSync(cargoTomlPath, "utf8").includes("bun_hawk_root");
const createdRootRs = !existsSync(rootRsPath);
if (!alreadyScaffolded && run(["git", "apply", scaffoldPatch]) !== 0) {
  console.error(`[hawk] failed to apply ${scaffoldPatch}`);
  process.exit(1);
}
if (createdRootRs) writeFileSync(rootRsPath, "fn main() {}\n");

// Ctrl-C goes to cargo too; let it die and fall through to the revert below.
process.on("SIGINT", () => {});
let status = 1;
try {
  status = run(["cargo", "hawk", "check", ...args], { env: { BUN_CODEGEN_DIR: codegenDir } });
} finally {
  if (!alreadyScaffolded) run(["git", "apply", "--reverse", scaffoldPatch]);
  if (createdRootRs) rmSync(rootRsPath, { force: true });
}
process.exit(status);
