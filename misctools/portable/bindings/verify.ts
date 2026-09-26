// Compiles and runs windows_layout.c and writes what it prints. To be run on Windows, where the
// headers of the Windows SDK are, with clang (or clang-cl) on the PATH:
//
//   bun verify.ts --libuv <checkout of libuv> [--cc clang] [--out windows_layout.headers.json]
//
// A structure, a field or a constant that the headers do not have stops the compiler. Its line in
// windows_layout.c is behind an `#ifndef SKIP_..`, so this script defines that macro and compiles
// again, until the program compiles. What was left out is in the output, under "left_out".
//
// On another system it compiles the program too, without the headers of Windows: that checks this
// script, and the output says so ("system").
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(import.meta.path);
const args = process.argv.slice(2);
const option = (name: string, fallback?: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const libuv = option("--libuv");
if (!libuv) throw new Error("usage: bun verify.ts --libuv <checkout of libuv> [--cc clang] [--out file]");
const cc = option("--cc", "clang")!;
const out = option("--out", join(here, "windows_layout.headers.json"))!;
const source = join(here, "windows_layout.c");
const lines = readFileSync(source, "utf8").split("\n");
const work = mkdtempSync(join(tmpdir(), "bun-layout-"));
const exe = join(work, process.platform === "win32" ? "windows_layout.exe" : "windows_layout");

/** The macro that leaves out the fact on this line (1-based): the innermost open `#ifndef SKIP_`. */
function macroOf(line: number): string | undefined {
  const open: string[] = [];
  for (let i = 0; i < line && i < lines.length; i++) {
    const start = /^#ifndef (SKIP_[A-Za-z_0-9]+)$/.exec(lines[i]);
    if (start) open.push(start[1]);
    else if (lines[i] === "#endif" && i < line - 1) open.pop();
  }
  return open[open.length - 1];
}

const skipped = new Set<string>();
let compiled = false;
let lastErrors = "";
for (let round = 0; round < 40 && !compiled; round++) {
  const command = [
    cc,
    "-ferror-limit=0",
    "-w",
    `-I${join(libuv, "include")}`,
    ...[...skipped].map(m => `-D${m}`),
    "-o",
    exe,
    source,
  ];
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode === 0) {
    compiled = true;
    break;
  }
  lastErrors = result.stderr.toString();
  const before = skipped.size;
  for (const match of lastErrors.matchAll(/windows_layout\.c[:(](\d+)[:,)][^\n]*?(?:error|fatal error)/g)) {
    const macro = macroOf(Number(match[1]));
    if (macro) skipped.add(macro);
  }
  console.log(`round ${round + 1}: ${skipped.size} facts left out`);
  if (skipped.size === before) break;
}
if (!compiled) {
  console.error(lastErrors.split("\n").slice(0, 40).join("\n"));
  throw new Error("windows_layout.c does not compile, and no line that can be left out is the reason");
}
const run = Bun.spawnSync([exe], { stdout: "pipe", stderr: "inherit" });
if (run.exitCode !== 0) throw new Error(`${exe}: exit code ${run.exitCode}`);
const facts = JSON.parse(run.stdout.toString());
const types = [...skipped].filter(m => m.startsWith("SKIP_TYPE_")).map(m => m.slice("SKIP_TYPE_".length));
facts.system = process.platform;
facts.architecture = process.arch;
facts.compiler = Bun.spawnSync([cc, "--version"], { stdout: "pipe" }).stdout.toString().split("\n")[0];
facts.left_out = {
  types,
  fields: [...skipped]
    .filter(m => m.startsWith("SKIP_FIELD_") && !types.some(t => m.startsWith(`SKIP_FIELD_${t}_`)))
    .map(m => m.slice("SKIP_FIELD_".length)),
  constants: [...skipped].filter(m => m.startsWith("SKIP_CONSTANT_")).map(m => m.slice("SKIP_CONSTANT_".length)),
};
writeFileSync(out, JSON.stringify(facts, null, 1) + "\n");
console.log(
  `${out}: ${Object.keys(facts.types).length} types, ${Object.keys(facts.constants).length} constants; left out: ${facts.left_out.types.length} types, ${facts.left_out.fields.length} fields, ${facts.left_out.constants.length} constants`,
);
