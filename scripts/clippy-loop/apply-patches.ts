#!/usr/bin/env bun
// Reads workflow output JSON on stdin: [{file, approved, patch}], applies each
// approved patch with `git apply --unidiff-zero`, logs results.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
  const patchFile = join(dir, r.file.replace(/[\/]/g, "_") + ".patch");
  // ensure trailing newline; git apply is picky
  writeFileSync(patchFile, r.patch.endsWith("\n") ? r.patch : r.patch + "\n");
  // Fixers reliably produce correct hunk bodies but miscount @@ headers, so
  // --recount (recompute counts from body) is the primary mode. --unidiff-zero
  // tolerates 0-context hunks; --inaccurate-eof tolerates trailing-LF drift.
  let res = spawnSync(
    "git",
    ["apply", "--recount", "--unidiff-zero", "--inaccurate-eof", "--whitespace=nowarn", patchFile],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  if (res.status !== 0) {
    // context drift from a previously-applied multi-file diff: retry with fuzz
    res = spawnSync(
      "git",
      ["apply", "--recount", "-C1", "--unidiff-zero", "--inaccurate-eof", "--whitespace=nowarn", patchFile],
      { cwd: process.cwd(), encoding: "utf8" },
    );
  }
  if (res.status === 0) {
    applied++;
    console.error(`[ok]   ${r.file}`);
  } else {
    failed++;
    console.error(`[fail] ${r.file}: ${res.stderr.trim().split("\n")[0]}`);
    console.error(`       patch saved at ${patchFile}`);
  }
}

console.error(`\napplied=${applied} rejected=${rejected} apply-failed=${failed}`);
process.stdout.write(JSON.stringify({ applied, rejected, failed }) + "\n");
process.exit(failed > 0 ? 1 : 0);
