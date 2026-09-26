// Compiles and runs windows_layout.c and writes what it prints. To be run on Windows, where the
// headers of the Windows SDK are, with clang (or clang-cl) on the PATH:
//
//   bun verify.ts --libuv <checkout of libuv> [--cc clang] [--out windows_layout.headers.json]
//
// On a machine that has the headers of Windows and does not run its programs (../tools/windows-sdk.ts):
//
//   bun verify.ts --libuv <checkout of libuv> --table --cc "clang --config=<directory>/windows-x64.cfg"
//
// compiles windows_layout.c to an object file that holds the facts as a table, and reads the table.
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
const cc = option("--cc", "clang")!.split(/\s+/).filter(Boolean);
const table = args.includes("--table");
const out = option("--out", join(here, "windows_layout.headers.json"))!;
const source = join(here, "windows_layout.c");
const lines = readFileSync(source, "utf8").split("\n");
const work = mkdtempSync(join(tmpdir(), "bun-layout-"));
const exe = join(work, table ? "windows_layout.obj" : process.platform === "win32" ? "windows_layout.exe" : "windows_layout");

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
  const command = [...cc, "-ferror-limit=0", "-w", `-I${join(libuv, "include")}`, ...[...skipped].map(m => `-D${m}`), ...(table ? ["-DBUN_LAYOUT_TABLE", "-c"] : []), "-o", exe, source];
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
/** The table `bun_layout_facts` of an object file for Windows (COFF), as the program would have printed it. */
function factsOfTable(path: string) {
  const file = readFileSync(path);
  const sectionCount = file.readUInt16LE(2);
  const symbolTable = file.readUInt32LE(8);
  const symbolCount = file.readUInt32LE(12);
  const sections = 20 + file.readUInt16LE(16);
  const strings = symbolTable + 18 * symbolCount;
  let data = -1;
  for (let i = 0; i < symbolCount; i++) {
    const at = symbolTable + 18 * i;
    const name =
      file.readUInt32LE(at) === 0
        ? file.toString("latin1", strings + file.readUInt32LE(at + 4), file.indexOf(0, strings + file.readUInt32LE(at + 4)))
        : file.toString("latin1", at, at + 8).replace(/\0+$/, "");
    const section = file.readInt16LE(at + 12);
    if (name === "bun_layout_facts" && section > 0 && section <= sectionCount) {
      data = file.readUInt32LE(sections + 40 * (section - 1) + 20) + file.readUInt32LE(at + 8);
      break;
    }
    i += file.readUInt8(at + 17);
  }
  if (data < 0) throw new Error(`${path} has no bun_layout_facts`);
  const length = (name: string) => Number(new RegExp(`#define ${name} (\\d+)`).exec(lines.join("\n"))![1]);
  const typeLength = length("BUN_LAYOUT_TYPE_LENGTH");
  const fieldLength = length("BUN_LAYOUT_FIELD_LENGTH");
  const text = (at: number, size: number) => file.toString("latin1", at, at + size).replace(/\0.*$/s, "");
  const facts: { pointer_bits: number; types: Record<string, any>; constants: Record<string, string> } = { pointer_bits: 0, types: {}, constants: {} };
  for (let at = data; ; at += 1 + typeLength + fieldLength + 16) {
    const kind = String.fromCharCode(file.readUInt8(at));
    const type = text(at + 1, typeLength);
    const field = text(at + 1 + typeLength, fieldLength);
    const first = file.readBigUInt64LE(at + 1 + typeLength + fieldLength);
    const second = file.readBigUInt64LE(at + 1 + typeLength + fieldLength + 8);
    if (kind === "E") {
      facts.pointer_bits = Number(first);
      break;
    } else if (kind === "T") facts.types[type] = { size: Number(first), align: Number(second), fields: {} };
    else if (kind === "F") facts.types[type].fields[field] = { offset: Number(first), size: Number(second) };
    else if (kind === "S") facts.constants[type] = BigInt.asIntN(64, first).toString();
    else if (kind === "U") facts.constants[type] = first.toString();
    else throw new Error(`${path}: the table has a fact of the kind ${JSON.stringify(kind)} at ${at}`);
  }
  return { source: "headers", ...facts };
}

let facts: any;
if (table) facts = factsOfTable(exe);
else {
  const run = Bun.spawnSync([exe], { stdout: "pipe", stderr: "inherit" });
  if (run.exitCode !== 0) throw new Error(`${exe}: exit code ${run.exitCode}`);
  facts = JSON.parse(run.stdout.toString());
}
const types = [...skipped].filter(m => m.startsWith("SKIP_TYPE_")).map(m => m.slice("SKIP_TYPE_".length));
// The system whose headers these are: the one the compiler compiled for.
const target = Bun.spawnSync([...cc, "-dumpmachine"], { stdout: "pipe" }).stdout.toString().trim();
facts.system = /windows/.test(target) ? "win32" : process.platform;
facts.architecture = /^(aarch64|arm64)/.test(target) ? "arm64" : /^x86_64/.test(target) ? "x64" : process.arch;
facts.target = target;
facts.read_from = table ? "the table of the object file, which was not run" : "the output of the program";
facts.compiler = Bun.spawnSync([...cc, "--version"], { stdout: "pipe" }).stdout.toString().split("\n")[0];
facts.left_out = {
  types,
  fields: [...skipped].filter(m => m.startsWith("SKIP_FIELD_") && !types.some(t => m.startsWith(`SKIP_FIELD_${t}_`))).map(m => m.slice("SKIP_FIELD_".length)),
  constants: [...skipped].filter(m => m.startsWith("SKIP_CONSTANT_")).map(m => m.slice("SKIP_CONSTANT_".length)),
};
writeFileSync(out, JSON.stringify(facts, null, 1) + "\n");
console.log(`${out}: ${Object.keys(facts.types).length} types, ${Object.keys(facts.constants).length} constants; left out: ${facts.left_out.types.length} types, ${facts.left_out.fields.length} fields, ${facts.left_out.constants.length} constants`);
