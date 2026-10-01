// Checks that every binder diagnostic of a bind dump is in the .errors.txt baseline of the reference.
// usage: bun check-errors-from-dump.mjs <SELECTION.tsv> <units dir> <dumps dir>
import fs from "node:fs";
import path from "node:path";
import { Positions } from "./check-symbols-from-dump.mjs";
const BASE = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
function unquote(q) {
  return q.slice(1, -1).replace(/\\x([0-9A-F]{2})|\\(.)/g, (_, h, c) => (h ? String.fromCharCode(parseInt(h, 16)) : c));
}
const [selection, unitsDir, dumpsDir] = process.argv.slice(2);
let files = 0, diagnostics = 0, found = 0, noBaseline = 0, skippedJs = 0;
const missing = [];
for (const row of fs.readFileSync(selection, "utf8").split("\n").filter(Boolean)) {
  const f = row.split("\t");
  const [id, , suite, stem, , unit, , lang] = f;
  const virtual = f[12];
  const dump = fs.readFileSync(path.join(dumpsDir, virtual.replaceAll("/", "__") + ".bind.txt"), "utf8");
  const lines = dump.split("\n").filter(l => l.startsWith("bindDiagnostic "));
  if (lines.length === 0) continue;
  files++;
  const errorsPath = path.join(BASE, suite, stem + ".errors.txt");
  const errors = fs.existsSync(errorsPath) ? fs.readFileSync(errorsPath, "utf8") : "";
  const source = fs.readFileSync(path.join(unitsDir, virtual), "utf8");
  const positions = new Positions(source);
  for (const l of lines) {
    const m = /^bindDiagnostic \[(\d+),(\d+)\) TS(\d+) cat=(\d+) (".*")$/.exec(l);
    diagnostics++;
    if (lang === "js" || lang === "jsx") { skippedJs++; continue; }
    if (errors === "") { noBaseline++; missing.push(`${id}: no .errors.txt, dump has ${l}`); continue; }
    const [line, character] = positions.lineAndCharacter(Number(m[1]));
    const bytes = Buffer.from(unquote(m[5]), "latin1").toString("utf8");
    const want = `${unit.replace(/^\//, "")}(${line + 1},${character + 1}): error TS${m[3]}: ${bytes}`;
    if (errors.includes(want)) found++; else missing.push(`${id}: ${want}`);
  }
}
console.log(JSON.stringify({ filesWithBinderDiagnostics: files, diagnostics, found, skippedJs, noBaseline, missing: missing.length }));
for (const m of missing.slice(0, 20)) console.log("  " + m);
