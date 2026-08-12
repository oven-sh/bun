#!/usr/bin/env bun
/**
 * `cargo clippy` for targets other than the host.
 *
 * `bun run rust:clippy` (the CI Clippy job, ubuntu) only sees the code that is
 * compiled for x86_64-unknown-linux-gnu; everything behind `#[cfg(windows)]`,
 * `#[cfg(target_os = "freebsd")]`, `#[cfg(target_arch = "aarch64")]`, ... is
 * linted only if somebody runs clippy on such a machine. This lints the whole
 * workspace with `--target` for every triple in rust-clippy-cross-budgets.json
 * (clippy needs the triple's `rust-std` and nothing else, so it works from any
 * host) and counts the diagnostics per crate.
 *
 * The JSON file is the budget: the number of hits each crate still has on that
 * target (unlisted crate = 0). A crate over its budget is a regression in the
 * change that added the hit; a crate under it must have its entry lowered
 * (`--update` rewrites the file from the current tree) so the budget only ever
 * goes down. Adding a target is adding its triple to the file with `{}` and
 * running `--update`; the Clippy workflow installs the std of every listed
 * triple.
 *
 * Lints are capped to warnings for the run (`--cap-lints=warn`), which is what
 * makes one `--workspace` invocation lint every crate: under the workspace's
 * deny-level lints the first failing crate would stop its dependents from
 * being checked at all. Always linting the whole workspace also keeps the
 * counts trustworthy: with `--no-deps`, a crate that was compiled as a
 * dependency of some `-p` selection is not linted, and cargo happily reuses
 * that artifact when the crate is selected later.
 *
 * Usage:
 *   bun run rust:clippy-cross                          # every target in the budget file
 *   bun run rust:clippy-cross x86_64-pc-windows-msvc   # just these targets
 *   bun run rust:clippy-cross --update                 # rewrite the budget file
 *
 * Needs the configure step first (`bun run build --configure-only` and
 * `ninja -C build/debug clone-lolhtml`), plus `rustup target add <triple>`.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const budgetsPath = resolve(import.meta.dirname, "rust-clippy-cross-budgets.json");

type Budgets = Record<string, Record<string, number>>;

/** One `cargo --message-format=json` line; only the fields used here. */
interface CargoMessage {
  reason: string;
  package_id?: string;
  message?: { level: string; code: unknown; rendered: string };
}

/** Package name from a cargo package id: `path+file:///x/src/sys#bun_sys@0.0.0` or, when the directory is named like the package, `path+file:///x/src/bun_core#0.0.0`. */
function packageName(packageId: string): string {
  const [location, fragment = ""] = packageId.split("#");
  const at = fragment.indexOf("@");
  return at !== -1 ? fragment.slice(0, at) : location.slice(location.lastIndexOf("/") + 1);
}

/** Lints the workspace for `triple`; returns the rendered lint diagnostics per crate, or null (after printing the compiler errors) if something did not compile. */
function lint(triple: string): Map<string, string[]> | null {
  const cmd = [
    "cargo",
    "clippy",
    "--workspace",
    "--no-deps",
    "--keep-going",
    "--target",
    triple,
    "--message-format=json",
    "--",
    "--cap-lints=warn",
  ];
  console.log(`\x1b[36m[clippy]\x1b[0m ${cmd.join(" ")}`);
  const proc = Bun.spawnSync({ cmd, cwd: repo, stdout: "pipe", stderr: "inherit" });

  // With --cap-lints=warn every lint arrives as a warning; an error is a real
  // compile failure (the target is broken, which `rust:check-all` would show too).
  const byCrate = new Map<string, string[]>();
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const line of proc.stdout.toString().split("\n")) {
    if (!line.startsWith("{")) continue;
    const msg: CargoMessage = JSON.parse(line);
    if (msg.reason !== "compiler-message" || !msg.package_id || !msg.message) continue;
    const { level, code, rendered } = msg.message;
    if (level === "error") errors.push(rendered);
    // `code` is null on the per-crate "N warnings emitted" summary.
    if (level !== "warning" || code === null) continue;
    const crate = packageName(msg.package_id);
    // cargo emits a diagnostic once per configuration a crate is built in
    // (e.g. for the target and again for the host when a build script needs it).
    if (!seen.add(`${crate}\0${rendered}`)) continue;
    let list = byCrate.get(crate);
    if (!list) byCrate.set(crate, (list = []));
    list.push(rendered);
  }
  if (proc.exitCode !== 0) {
    console.log(errors.join(""));
    console.error(`\x1b[31m[error]\x1b[0m cargo clippy failed for ${triple} (exit ${proc.exitCode})`);
    return null;
  }
  return byCrate;
}

/** Compares one target's counts with its budget; returns the problems, each already formatted for the user. */
function checkBudget(budget: Record<string, number>, counts: Map<string, number>): string[] {
  const problems: string[] = [];
  for (const crate of [...new Set([...Object.keys(budget), ...counts.keys()])].sort()) {
    const allowed = budget[crate] ?? 0;
    const actual = counts.get(crate) ?? 0;
    if (actual > allowed) {
      problems.push(`${crate}: ${actual} clippy hits, budget is ${allowed}; fix the new ones (printed above)`);
    } else if (actual < allowed) {
      problems.push(
        `${crate}: ${actual} clippy hits, budget is ${allowed}; run \`bun run rust:clippy-cross --update\``,
      );
    }
  }
  return problems;
}

if (import.meta.main) {
  const codegenDir = process.env.BUN_CODEGEN_DIR ?? resolve(repo, "build/debug/codegen");
  for (const [path, hint] of [
    [resolve(codegenDir, "build_options.rs"), "bun run build --configure-only"],
    [resolve(repo, "vendor/lolhtml/Cargo.toml"), "ninja -C build/debug clone-lolhtml"],
  ] as const) {
    if (!existsSync(path)) {
      console.error(`\x1b[31m[error]\x1b[0m ${path} is missing; run: ${hint}`);
      process.exit(1);
    }
  }

  const budgets: Budgets = await Bun.file(budgetsPath).json();
  const args = process.argv.slice(2);
  const update = args.includes("--update");
  const triples = args.filter(a => a !== "--update");
  for (const triple of triples) {
    if (!(triple in budgets)) {
      console.error(`\x1b[31m[error]\x1b[0m ${triple} is not in ${budgetsPath} (add it as {} to start linting it)`);
      process.exit(1);
    }
  }

  let failed = false;
  for (const triple of triples.length > 0 ? triples : Object.keys(budgets)) {
    const diagnostics = lint(triple);
    if (!diagnostics) {
      failed = true;
      continue;
    }
    const counts = new Map([...diagnostics].map(([crate, list]) => [crate, list.length]));
    if (update) {
      budgets[triple] = Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : 1)));
      continue;
    }
    const budget = budgets[triple];
    for (const [crate, rendered] of diagnostics) {
      if (rendered.length > (budget[crate] ?? 0)) console.log(rendered.join(""));
    }
    const problems = checkBudget(budget, counts);
    for (const problem of problems) console.error(`\x1b[31m[${triple}]\x1b[0m ${problem}`);
    if (problems.length > 0) failed = true;
    else
      console.log(`\x1b[32m[${triple}]\x1b[0m within budget (${[...counts.values()].reduce((a, b) => a + b, 0)} hits)`);
  }

  if (update) {
    await Bun.write(budgetsPath, JSON.stringify(budgets, null, 2) + "\n");
    console.log(`wrote ${budgetsPath}`);
  }
  process.exit(failed ? 1 : 0);
}
