#!/usr/bin/env bun
/**
 * Extract WebKit DirectBuild data from a cmake-generated build.ninja.
 *
 * Run after `ninja -C build/<profile> configure-WebKit` (with --webkit=local).
 * Prints JSON tables that webkit-direct.ts consumes:
 *   - sources per layer (bmalloc, WTF, JSC, derived)
 *   - codegen edges (outputs, command argv, inputs)
 *   - include dirs and defines per layer
 *
 * The output is checked in as scripts/build/deps/webkit-direct-data.json so
 * the normal build doesn't need cmake. Regenerate when bumping WEBKIT_VERSION.
 *
 * Usage: bun scripts/build/extract-webkit.ts <webkit-build-dir> > <out.json>
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const buildDir = process.argv[2];
if (!buildDir) {
  console.error("usage: extract-webkit.ts <webkit-build-dir>");
  process.exit(1);
}

const ninja = readFileSync(resolve(buildDir, "build.ninja"), "utf8");
const cc = JSON.parse(readFileSync(resolve(buildDir, "compile_commands.json"), "utf8")) as Array<{
  file: string;
  command: string;
  output: string;
}>;

// Absolute paths in cmake's output → repo-relative tokens. The build dir is
// arbitrary (depends on where you ran cmake), so normalize both directions.
const absBuildDir = resolve(buildDir);
const repoRoot = resolve(absBuildDir, "../../../..");
const srcRoot = resolve(repoRoot, "vendor/WebKit");
function rel(p: string): string {
  if (p.startsWith(srcRoot + "/")) return "$SRC/" + p.slice(srcRoot.length + 1);
  if (p.startsWith(absBuildDir + "/")) return "$BUILD/" + p.slice(absBuildDir.length + 1);
  return p;
}

// ───────────────────────────────────────────────────────────────────────────
// Sources + flags per layer (from compile_commands.json)
// ───────────────────────────────────────────────────────────────────────────

interface Layer {
  sources: string[];
  includes: string[];
  defines: string[];
}

function extractLayer(dirMatch: string): Layer {
  const entries = cc.filter(e => e.output.includes(dirMatch));
  const sources = entries.map(e => rel(e.file));
  // Flags are uniform per layer; sample the first.
  const cmd = entries[0]?.command ?? "";
  const includes = [...new Set((cmd.match(/-I\S+/g) ?? []).map(f => rel(f.slice(2))))];
  const defines = [...new Set(cmd.match(/-D\S+/g) ?? [])].map(f => f.slice(2));
  return { sources, includes, defines };
}

const layers = {
  bmalloc: extractLayer("/bmalloc.dir/"),
  WTF: extractLayer("/WTF.dir/"),
  JavaScriptCore: extractLayer("/JavaScriptCore.dir/"),
  LowLevelInterpreterLib: extractLayer("/LowLevelInterpreterLib.dir/"),
};

// ───────────────────────────────────────────────────────────────────────────
// Codegen edges (CUSTOM_COMMAND with a script interpreter)
// ───────────────────────────────────────────────────────────────────────────

interface Codegen {
  outputs: string[];
  inputs: string[];
  argv: string[]; // [interpreter, script, ...args] with $SRC/$BUILD tokens
  cwd: string;
}

const codegen: Codegen[] = [];

// ninja format: `build <outs>: CUSTOM_COMMAND <ins>` then indented vars.
// Multi-output edges list outputs space-separated; cmake duplicates them
// after `| ${cmake_ninja_workdir}` which we drop.
const lines = ninja.split("\n");
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^build (.+): CUSTOM_COMMAND (.*)$/);
  if (!m) continue;
  // cmake also emits CUSTOM_COMMAND for `cmake -E copy` (forwarding headers)
  // and phony stamps; only keep edges whose COMMAND runs a script.
  let cmdLine = "";
  for (let j = i + 1; j < lines.length && lines[j].startsWith("  "); j++) {
    const c = lines[j].match(/^  COMMAND = (.+)$/);
    if (c) cmdLine = c[1];
  }
  // Only script-driven generators — skip cmake -E copy/touch and the
  // compile_commands rewriter (dev-tooling, not a build input).
  const interp = cmdLine.match(/\b(?:\/usr\/bin\/)?(ruby|python3[.\d]*|perl)\b\s+(\S+)/);
  if (!interp) continue;
  if (interp[2].includes("rewrite-compile-commands")) continue;

  // Outputs: drop the `| ${cmake_ninja_workdir}...` echo half.
  const outs = m[1].split(" | ")[0].trim().split(/\s+/).map(o => rel(resolve(buildDir, o)));
  // Inputs: everything after CUSTOM_COMMAND up to `||` (order-only).
  const insRaw = m[2].split(" || ")[0].trim();
  const ins = insRaw ? insRaw.split(/\s+/).map(p => rel(resolve(buildDir, p))) : [];

  // COMMAND: `cd <dir> && <interpreter> <script> <args...>`
  const cd = cmdLine.match(/^cd (\S+) && (.+)$/);
  const cwd = cd ? rel(cd[1]) : "$BUILD";
  const argv = (cd ? cd[2] : cmdLine)
    .split(/\s+/)
    .map(a => rel(a))
    // Normalize the host's specific interpreter path to a bare name so the
    // extracted data is portable across machines.
    .map(a => a.replace(/^\/usr\/bin\/(ruby|perl|python3)[.\d]*$/, "$1"));

  codegen.push({ outputs: outs, inputs: ins, argv, cwd });
}

// ───────────────────────────────────────────────────────────────────────────
// .lut.h table — 105 create_hash_table calls collapse to one pattern.
// ───────────────────────────────────────────────────────────────────────────

const lutTables = codegen
  .filter(c => c.argv[1]?.endsWith("create_hash_table"))
  .map(c => ({ out: c.outputs[0], in: c.argv[2] }));

const otherCodegen = codegen.filter(c => !c.argv[1]?.endsWith("create_hash_table"));

console.log(
  JSON.stringify(
    {
      layers,
      lutTables,
      codegen: otherCodegen,
      // For diffing on bumps.
      counts: {
        bmalloc: layers.bmalloc.sources.length,
        WTF: layers.WTF.sources.length,
        JavaScriptCore: layers.JavaScriptCore.sources.length,
        lutTables: lutTables.length,
        codegen: otherCodegen.length,
      },
    },
    null,
    2,
  ),
);
