/**
 * check-features.ts <nm> <manifest> <stamp>
 *
 * Nothing may name what can be gone while it stays (src/bun_core/feature.rs). rustc sees to that between crates. Nothing
 * does for a symbol that is declared by hand: in C and C++, and in `extern` blocks.
 *
 * The manifest has a line for each input of the link: the features that need it, "2,3", or "-", and its path.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const [nm, manifest, stamp] = process.argv.slice(2);
if (nm === undefined || manifest === undefined || stamp === undefined)
  throw new Error("usage: <nm> <manifest> <stamp>");

const neededBy = new Map<string, Set<string> | undefined>();
for (const line of readFileSync(manifest, "utf8").split("\n").filter(Boolean)) {
  const [features, path] = [line.slice(0, line.indexOf(" ")), line.slice(line.indexOf(" ") + 1)];
  neededBy.set(path, features === "-" ? undefined : new Set(features.split(",")));
}

// `<input>[:<member>]: <value> <type> <name>`, the same for ELF, COFF, Mach-O and bitcode, where the value is dashes. It is
// blank for what is not defined. See fetch-cli.ts.
const line = /^(.*): +(?:[0-9a-f-]+ +)?([A-Za-z]) +(\S+)\s*$/;
const definedBy = new Map<string, string>();
const uses: [symbol: string, by: string][] = [];
const paths = [...neededBy.keys()];
for (let start = 0; start < paths.length; start += 100) {
  const { status, stdout, stderr, error } = spawnSync(nm, ["-A", ...paths.slice(start, start + 100)], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  if (error || status !== 0) throw new Error(`${nm} failed: ${error ?? stderr}`);
  for (const text of stdout.split("\n")) {
    const match = line.exec(text);
    if (match === null) continue;
    const [, where, type, symbol] = match as unknown as [string, string, string, string];
    const path = neededBy.has(where) ? where : where.slice(0, where.lastIndexOf(":"));
    if (type === "U") uses.push([symbol, path]);
    // What the linker may replace by another's copy stays where it is (feature-pass.cpp), so not W, V or C.
    else if ("TDRBS".includes(type) && neededBy.get(path) !== undefined) definedBy.set(symbol, path);
  }
}
// Else the output is not what is parsed above, and nothing would be checked.
const hasFeatures = [...neededBy.values()].some(features => features !== undefined);
if (uses.length === 0 || (hasFeatures && definedBy.size === 0))
  throw new Error(`nothing parsed from the output of ${nm}`);

const offenders = new Set<string>();
for (const [symbol, by] of uses) {
  const definer = definedBy.get(symbol);
  // What is behind a door.
  if (definer === undefined || /^_?bun_feature_/.test(symbol)) continue;
  const [user, used] = [neededBy.get(by), neededBy.get(definer)!];
  if (user === undefined || ![...user].every(feature => used.has(feature))) {
    offenders.add(
      `  ${symbol}\n    of ${definer} (${[...used]})\n    named by ${by} (${user ? [...user] : "all of Bun"})`,
    );
  }
}
if (offenders.size > 0) {
  console.error(
    `error: ${offenders.size} symbols of a feature are named by what can stay without it. ` +
      `Go through a door (src/runtime/features.rs), or move one of the two.\n${[...offenders].slice(0, 20).join("\n")}`,
  );
  process.exit(1);
}
writeFileSync(stamp, "");
