// Survey of the first section and of the file headers: names without a section, repeated names, order of names.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TS = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/baselines/reference";
const GO = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";

function list(dir: string): string[] {
  return readdirSync(dir)
    .filter(f => f.endsWith(".errors.txt"))
    .sort()
    .map(f => join(dir, f));
}
const sets: Record<string, string[]> = {
  ts: list(TS),
  go: [...list(join(GO, "compiler")), ...list(join(GO, "conformance"))],
};

const headRe = /^(?:(.+?)\((\d+|--),(\d+|--)\): )?(error|warning|suggestion|message) TS(-?\d+): /;
const sectionRe = /^==== (.*) \((\d+) errors\) ====$/;

for (const [setName, files] of Object.entries(sets)) {
  const c: Record<string, number> = {};
  const ex: Record<string, string[]> = {};
  const bump = (k: string, f: string) => {
    c[k] = (c[k] ?? 0) + 1;
    (ex[k] ??= []).length < 12 && ex[k].push(f.split("/").pop()!.replace(".errors.txt", ""));
  };
  const noSectionNames: Record<string, number> = {};
  for (const f of files) {
    const s = readFileSync(f).toString("latin1");
    if (s.includes("\x1b")) continue;
    const idx = s.indexOf("\r\n\r\n\r\n");
    if (idx < 0) {
      bump("no triple newline", f);
      continue;
    }
    const top = s.slice(0, idx + 2);
    const body = s.slice(idx + 6);
    if (body.indexOf("\r\n\r\n\r\n") >= 0 && false) bump("second triple newline", f);
    if (!(body.startsWith("!!! ") || body.startsWith("==== ") || body === "")) bump("body starts oddly", f);
    const topLines = top.split("\r\n");
    topLines.pop();
    const names: string[] = [];
    let continuation0 = false;
    let sawGlobal = false;
    for (const line of topLines) {
      const m = headRe.exec(line);
      if (!m) {
        if (!line.startsWith("  ")) continuation0 = true;
        continue;
      }
      if (m[1] === undefined) sawGlobal = true;
      else names.push(m[1]);
    }
    if (continuation0) bump("continuation line without indent", f);
    if (sawGlobal) bump("has global diagnostic", f);
    const sections: string[] = [];
    for (const line of body.split("\r\n")) {
      const m = sectionRe.exec(line);
      if (m && line.startsWith("==== ")) sections.push(m[1]);
    }
    const distinct = [...new Set(names)];
    for (const n of distinct) {
      if (!sections.includes(n)) {
        bump("diagnostic in a file without section", f);
        noSectionNames[n] = (noSectionNames[n] ?? 0) + 1;
      }
    }
    const lower = sections.map(x => x.toLowerCase());
    if (new Set(sections).size !== sections.length) bump("repeated section name (exact)", f);
    else if (new Set(lower).size !== lower.length) bump("repeated section name (case)", f);
    // order of names in the first section: runs of one name
    const runs: string[] = [];
    for (const n of names) if (runs[runs.length - 1] !== n) runs.push(n);
    if (new Set(runs).size !== runs.length) bump("a file name appears in two runs", f);
    const sortedPrinted = [...runs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (runs.join("\n") !== sortedPrinted.join("\n")) bump("order differs from printed-name order", f);
    const real = (n: string, lib: string) =>
      n.startsWith("/") || n.includes("://") ? n : /^lib\..*\.d\.ts$/.test(n) && !sections.includes(n) ? lib + n : "/.src/" + n;
    for (const [tag, lib] of [["go", "bundled:///libs/"], ["ts", "/.ts/"]] as const) {
      const sortedReal = [...runs].sort((a, b) => (real(a, lib) < real(b, lib) ? -1 : real(a, lib) > real(b, lib) ? 1 : 0));
      if (runs.join("\n") !== sortedReal.join("\n")) bump(`order differs from real-name order (${tag} lib root)`, f);
    }
    const lowerReal = (n: string) => real(n, "/.ts/").toLowerCase();
    const sortedLower = [...runs].sort((a, b) => (lowerReal(a) < lowerReal(b) ? -1 : lowerReal(a) > lowerReal(b) ? 1 : 0));
    if (runs.join("\n") !== sortedLower.join("\n")) bump("order differs from lower-cased real-name order (ts lib root)", f);
  }
  console.log(`== ${setName}: ${files.length} files`);
  for (const k of Object.keys(c).sort()) console.log(`  ${k}: ${c[k]}  e.g. ${ex[k].join(", ")}`);
  console.log("  names without section:", JSON.stringify(noSectionNames));
}
