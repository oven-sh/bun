/**
 * check-features.ts <nm> <readobj> <manifest> <executable> <stamp>
 *
 * That the islands of what was linked are islands (src/bun_core/feature.rs), so that one can be left out and the rest works:
 *
 * 1. Every function that only inputs of an island define is in that island.
 * 2. Everything in an island was defined by an input of it. What the linker folds keeps its names, so a function of Bun's that
 *    was folded into one of an island shows here.
 * 3. Nothing names what can be gone while it stays. rustc sees to that between crates. Nothing does for a symbol that is
 *    declared by hand: in C and C++, and in `extern` blocks.
 *
 * The manifest has the features that need each island, "1;1,2,3;2,3", and then a line for each input of the link: its island, or
 * 0, and its path.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseSymbolMap, symbolMapFor } from "../orderfile/windows-symbols.ts";

const [nm, readobj, manifest, executable, stamp] = process.argv.slice(2);
if (
  nm === undefined ||
  readobj === undefined ||
  manifest === undefined ||
  executable === undefined ||
  stamp === undefined
)
  throw new Error("usage: <nm> <readobj> <manifest> <executable> <stamp>");

function run(tool: string, args: string[]): string[] {
  const { status, stdout, stderr, error } = spawnSync(tool, args, { encoding: "utf8", maxBuffer: 1 << 30 });
  if (error || status !== 0) throw new Error(`${tool} failed: ${error ?? stderr}`);
  return stdout.split("\n");
}

function fail(count: number, what: string, offenders: Iterable<string>): never {
  console.error(`error: ${count} ${what}\n${[...offenders].slice(0, 20).join("\n")}`);
  process.exit(1);
}

const [table, ...lines] = readFileSync(manifest, "utf8").split("\n").filter(Boolean);
/** The features that need each island. Bun, which is island 0 here, is needed by all there is. */
const neededBy = [undefined, ...table!.split(";").map(features => new Set(features.split(",")))];
const islandOf = new Map(
  lines.map(line => [line.slice(line.indexOf(" ") + 1), Number(line.slice(0, line.indexOf(" ")))]),
);

// ---- what the link took

// `<input>[:<member>]: <value> <type> <name>`, the same for ELF, COFF, Mach-O and bitcode, where the value is dashes. It is
// blank for what is not defined. See fetch-cli.ts.
const line = /^(.*): +(?:[0-9a-f-]+ +)?([A-Za-z]) +(\S+)\s*$/;
/** The islands whose inputs define a name, in whatever way. */
const definers = new Map<string, Set<number>>();
/** The input of an island that has the one definition of a name that others can use. */
const definedBy = new Map<string, string>();
/** What the linker keeps one copy of for all that define it. feature-pass.cpp gives what is an island's of those a name of its own, `f.bun7`. */
const shared = new Set<string>();
const uses: [symbol: string, by: string][] = [];
const paths = [...islandOf.keys()];
for (let start = 0; start < paths.length; start += 100) {
  for (const text of run(nm, ["-A", ...paths.slice(start, start + 100)])) {
    const match = line.exec(text);
    if (match === null) continue;
    const [, where, type, symbol] = match as unknown as [string, string, string, string];
    const path = islandOf.has(where) ? where : where.slice(0, where.lastIndexOf(":"));
    if (type === "U") {
      uses.push([symbol, path]);
      continue;
    }
    const island = islandOf.get(path)!;
    const islands = definers.get(symbol);
    if (islands === undefined) definers.set(symbol, new Set([island]));
    else islands.add(island);
    if ("WwVv".includes(type)) shared.add(symbol);
    if (island === 0) continue;
    if ("TDRBS".includes(type)) definedBy.set(symbol, path);
  }
}
// nm says "W" of what is in ELF or in bitcode. Of what is in a COFF or Mach-O object it says "T", and readobj says how the linker
// is to treat it: a section of COFF that it keeps one of says so (`Selection`), and a symbol of Mach-O does (`WeakDef`).
const ofIslands = paths.filter(path => islandOf.get(path) !== 0);
for (let start = 0; start < ofIslands.length; start += 100) {
  let name = "";
  let section = "";
  /** Of one COFF object. */
  let [inSection, keptOnce] = [new Map<string, string>(), new Set<string>()];
  for (const text of [...run(readobj, ["--symbols", ...ofIslands.slice(start, start + 100)]), "File:"]) {
    const [, field, value] = /^ *(\w+):? ?(.*?)(?: \((?:0x)?[0-9A-Fa-f]+\))?$/.exec(text) ?? [];
    if (field === "File") {
      for (const [symbol, itsSection] of inSection) if (keptOnce.has(itsSection)) shared.add(symbol);
      [inSection, keptOnce] = [new Map(), new Set()];
    } else if (field === "Name") name = value!;
    else if (field === "Section") section = text;
    else if (field === "StorageClass" && value === "External") inSection.set(name, section);
    else if (field === "Selection" && ["Any", "SameSize", "ExactMatch", "Largest", "Newest"].includes(value!))
      keptOnce.add(section);
    else if (field === "WeakDef") shared.add(name);
  }
}
for (const symbol of shared) if (/\.bun\d+$/.test(symbol)) shared.delete(symbol);

// Else the output is not what is parsed above, and nothing would be checked.
if (uses.length === 0 || definedBy.size === 0) throw new Error(`nothing parsed from the output of ${nm}`);

/** LLVM makes `f.cold.1` and `f.llvm.123` of `f`. */
function definersOf(symbol: string): Set<number> | undefined {
  for (let name = symbol; ; name = name.slice(0, name.lastIndexOf("."))) {
    const islands = definers.get(name);
    if (islands !== undefined || !name.includes(".")) return islands;
  }
}

// ---- 3

const named = new Set<string>();
for (const [symbol, by] of uses) {
  const definer = definedBy.get(symbol);
  // What is behind a door.
  if (definer === undefined || /^_?bun_feature_/.test(symbol)) continue;
  const [user, used] = [neededBy[islandOf.get(by)!], neededBy[islandOf.get(definer)!]!];
  if (user === undefined || ![...user].every(feature => used.has(feature))) {
    named.add(`  ${symbol}\n    of ${definer} (${[...used]})\n    named by ${by} (${user ? [...user] : "all of Bun"})`);
  }
}
if (named.size > 0) {
  const what = "symbols of a feature are named by what can stay without it.";
  fail(named.size, `${what} Go through a door (src/runtime/features.rs), or move one of the two.`, named);
}

// ---- what was linked

interface Stretch {
  island: number;
  isCode: boolean;
  start: number;
  end: number;
}
const stretches: Stretch[] = [];
/** What is in `executable`. For Mach-O, nm says "t" only of what is in `__text`. */
const symbols: [address: number, isCode: boolean, name: string][] = [];
const sections = run(readobj, ["--sections", executable]);
if (!sections.some(text => text.startsWith("Format: COFF"))) {
  for (const [index, text] of sections.entries()) {
    const match = /^ +Name: (?:\.bun_island_|__bun_)([xr])\.?(\d+) /.exec(text);
    if (match === null) continue;
    const field = (name: string) =>
      Number(
        sections
          .slice(index, index + 12)
          .find(it => it.trimStart().startsWith(`${name}: `))!
          .split(": ")[1],
      );
    const start = field("Address");
    stretches.push({ island: Number(match[2]), isCode: match[1] === "x", start, end: start + field("Size") });
  }
  for (const text of run(nm, [executable])) {
    const match = /^([0-9a-f]+) +([A-Za-z]) +(\S+)$/.exec(text);
    if (match !== null && !"aAU".includes(match[2]!)) {
      symbols.push([parseInt(match[1]!, 16), "tT".includes(match[2]!), match[3]!]);
    }
  }
} else if (existsSync(symbolMapFor(executable))) {
  // A PE has no symbols, and its islands are not sections. The link lists what is in its code, where it writes maps at all.
  const edges = new Map<string, number>();
  for (const [address, name] of parseSymbolMap(readFileSync(symbolMapFor(executable), "utf8")).symbols) {
    if (/^bun_island_\d+_code_/.test(name)) edges.set(name, address);
    else symbols.push([address, true, name]);
  }
  for (const island of neededBy.keys()) {
    const [start, end] = [edges.get(`bun_island_${island}_code_start`), edges.get(`bun_island_${island}_code_end`)];
    if (start !== undefined && end !== undefined) stretches.push({ island, isCode: true, start, end });
  }
}

let [functionsSeen, symbolsSeen] = [0, 0];
const [outside, foreign] = [new Set<string>(), new Set<string>()];
const stretchAt = (address: number) => stretches.find(it => it.start <= address && address < it.end);
for (const [address, isCode, symbol] of symbols) {
  // lld moves an instruction that a Cortex-A53 gets wrong where it is (--fix-cortex-a53-843419) to a patch nearby, which it
  // names by the address of the instruction. It is of what the instruction is of.
  const patched = /^__CortexA53843419_([0-9A-F]+)$/.exec(symbol);
  const islands = patched ? new Set([stretchAt(parseInt(patched[1]!, 16))?.island ?? 0]) : definersOf(symbol);
  const stretch = stretchAt(address);

  // What several define, an inline variable of a header for one, is where the linker put the copy it kept.
  const [island] = islands?.size === 1 ? islands : [0];
  if (island !== 0 && (isCode || stretch?.isCode) && !shared.has(symbol.split(".llvm.")[0]!)) {
    functionsSeen++;
    if (stretch === undefined || stretch.island !== island || !stretch.isCode) {
      outside.add(`  ${symbol}\n    of island ${island}, is in ${stretch ? `island ${stretch.island}` : "none"}`);
    }
  }
  if (stretch !== undefined) {
    symbolsSeen++;
    if (!islands?.has(stretch.island)) {
      foreign.add(
        `  ${symbol}\n    in island ${stretch.island}, is of ${islands ? [...islands] : "nothing that was linked"}`,
      );
    }
  }
}
if (symbols.length > 0 && (functionsSeen === 0 || symbolsSeen === 0))
  throw new Error(`${executable} has no islands, or nothing in them`);
if (outside.size > 0)
  fail(outside.size, "functions of an island are not in it, and would stay without the features.", outside);
if (foreign.size > 0)
  fail(foreign.size, "symbols in an island are not of it, and would go with the features.", foreign);

writeFileSync(
  stamp,
  `${functionsSeen} functions are in their island\n${symbolsSeen} symbols in islands are of them\n${uses.length} uses\n`,
);
