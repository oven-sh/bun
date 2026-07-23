#!/usr/bin/env bun
// Reads workflow output JSON on stdin: [{file, approved, patch}], applies each
// approved patch with `git apply` (strict, then `--recount` fallback). Never
// uses `--unidiff-zero` or `-C1` — both silently corrupt by joining adjacent
// source lines when the agent's @@ header counts are off.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const input = readFileSync(0, "utf8");
const results: Array<{ file: string; approved: boolean; patch: string; reviewNotes?: string }> = JSON.parse(input);

const dir = mkdtempSync(join(tmpdir(), "clippy-patches-"));
let applied = 0;
let rejected = 0;
let failed = 0;

for (const r of results) {
  if (!r.approved || !r.patch?.trim()) {
    rejected++;
    if (r.reviewNotes) console.error(`[skip] ${r.file}: ${r.reviewNotes}`);
    continue;
  }
  const patchFile = join(dir, r.file.replace(/[\\/]/g, "_") + ".patch");
  // ensure trailing newline; git apply is picky
  writeFileSync(patchFile, r.patch.endsWith("\n") ? r.patch : r.patch + "\n");
  // Strict first; fall back to --recount only (recomputes @@ counts from body).
  // NEVER use --unidiff-zero or -C1: both silently corrupt by joining adjacent
  // source lines when the agent's @@ counts are off.
  let res = spawnSync("git", ["apply", "--whitespace=nowarn", patchFile], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (res.status !== 0) {
    res = spawnSync("git", ["apply", "--recount", "--whitespace=nowarn", patchFile], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
  if (res.status === 0) {
    applied++;
    console.error(`[ok]   ${r.file}`);
  } else {
    failed++;
    const errText = res.stderr
      ? res.stderr.toString().trim().split("\n")[0]
      : (res.error?.message ?? `git apply exited with status ${res.status}`);
    console.error(`[fail] ${r.file}: ${errText}`);
    console.error(`       patch saved at ${patchFile}`);
  }
}

console.error(`\napplied=${applied} rejected=${rejected} apply-failed=${failed}`);
process.stdout.write(JSON.stringify({ applied, rejected, failed }) + "\n");
process.exit(failed > 0 ? 1 : 0);
