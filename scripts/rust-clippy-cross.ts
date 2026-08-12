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
 * host) and counts the diagnostics per `<file> <lint>`.
 *
 * The JSON file is the budget: per target, the hits each (file, lint) pair
 * still has; anything not listed is allowed none, same shape as
 * test/internal/source-lints/dead-code-escape-limits.json. A pair over its
 * budget fails and prints exactly that pair's diagnostics, so the new hit is
 * what shows up (and what the workflow annotates); raising an entry for it
 * needs the same justification as an `#[allow]`. A pair under its budget fails
 * too, until `--update` rewrites the file from the current tree, so the file
 * tracks the real state and only shrinks otherwise. The counts depend on the
 * sources alone: CI's run on the merge commit reports the same numbers as a
 * local run on the same tree. To add a target, add its triple to the file as
 * `{}` and run `--update`; the workflow reads the triples to install from the
 * same file.
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

/** triple -> `<file> <lint>` -> allowed hits */
type Budgets = Record<string, Record<string, number>>;

/** One `cargo --message-format=json` line; only the fields used here. */
interface CargoMessage {
  reason: string;
  message?: {
    level: string;
    code: { code: string } | null;
    rendered: string;
    spans: { file_name: string; is_primary: boolean }[];
  };
}

/** Lints the workspace for `triple`; returns the rendered diagnostics per `<file> <lint>`, or null (after printing the compiler errors) if something did not compile. */
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
  const hits = new Map<string, string[]>();
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const line of proc.stdout.toString().split("\n")) {
    if (!line.startsWith("{")) continue;
    const msg: CargoMessage = JSON.parse(line);
    if (msg.reason !== "compiler-message" || !msg.message) continue;
    const { level, code, rendered, spans } = msg.message;
    if (level === "error") errors.push(rendered);
    // `code` is null on the per-crate "N warnings emitted" summary.
    if (level !== "warning" || code === null) continue;
    // A crate that proc-macros or build scripts also depend on is compiled for
    // the host as well as for the target (bun_output_tags: three times), and
    // every configuration reports the same hit again.
    if (seen.has(rendered)) continue;
    seen.add(rendered);
    // rustc prints paths relative to the workspace root; Windows hosts print
    // them with backslashes.
    const file = (spans.find(span => span.is_primary) ?? spans[0])?.file_name.replaceAll("\\", "/") ?? "(no span)";
    const key = `${file} ${code.code}`;
    let list = hits.get(key);
    if (!list) hits.set(key, (list = []));
    list.push(rendered);
  }
  if (proc.exitCode !== 0) {
    console.log(errors.join(""));
    console.error(`\x1b[31m[error]\x1b[0m cargo clippy failed for ${triple} (exit ${proc.exitCode})`);
    return null;
  }
  return hits;
}

/** Prints the diagnostics of every key over its budget; returns one line per key whose count differs from the budget. */
function checkBudget(budget: Record<string, number>, hits: Map<string, string[]>): string[] {
  const problems: string[] = [];
  for (const key of [...new Set([...Object.keys(budget), ...hits.keys()])].sort()) {
    const allowed = budget[key] ?? 0;
    const rendered = hits.get(key) ?? [];
    if (rendered.length > allowed) {
      console.log(rendered.join(""));
      problems.push(`${key}: ${rendered.length} hits, budget is ${allowed} (all ${rendered.length} are printed above)`);
    } else if (rendered.length < allowed) {
      problems.push(
        `${key}: ${rendered.length} hits, budget is ${allowed}; run \`bun run rust:clippy-cross --update\``,
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
    const hits = lint(triple);
    if (!hits) {
      failed = true;
      continue;
    }
    const total = [...hits.values()].reduce((n, list) => n + list.length, 0);
    if (update) {
      budgets[triple] = Object.fromEntries(
        [...hits].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, list]) => [key, list.length]),
      );
      console.log(`\x1b[36m[${triple}]\x1b[0m ${total} hits in ${hits.size} file/lint pairs`);
      continue;
    }
    const problems = checkBudget(budgets[triple], hits);
    for (const problem of problems) console.error(`\x1b[31m[${triple}]\x1b[0m ${problem}`);
    if (problems.length > 0) failed = true;
    else console.log(`\x1b[32m[${triple}]\x1b[0m within budget (${total} hits in ${hits.size} file/lint pairs)`);
  }

  if (update) {
    await Bun.write(budgetsPath, JSON.stringify(budgets, null, 2) + "\n");
    console.log(`wrote ${budgetsPath}`);
  }
  process.exit(failed ? 1 : 0);
}
