import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const go = "/workspace/ref/typescript-go";
const gen = readFileSync(join(go, "internal/diagnostics/diagnostics_generated.go"), "utf8");
const codeOf = new Map<string, number>();
for (const m of gen.matchAll(/^var (\w+) = &Message\{code: (\d+),/gm)) codeOf.set(m[1], Number(m[2]));
function codes(files: string[]) { const s = new Set<number>(); for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/diagnostics\.([A-Za-z0-9_]+)/g)) { const c = codeOf.get(m[1]); if (c !== undefined) s.add(c); } return s; }
const dir = (d: string) => readdirSync(join(go, d)).filter(f => f.endsWith(".go") && !f.endsWith("_test.go")).map(f => join(go, d, f));
const syn = codes([...dir("internal/parser"), ...dir("internal/scanner")]);
const sem = codes([...dir("internal/checker"), ...dir("internal/binder")]);
const synOnly = new Set([...syn].filter(c => !sem.has(c)));
const semOnly = new Set([...sem].filter(c => !syn.has(c)));
const base = join(go, "testdata/baselines/reference/submodule");
let total = 0, mixedStrict = 0, synOnlyMulti = 0, anySynOnly = 0, exactlyOne = 0, other = 0;
const otherCodes = new Map<number, number>();
for (const suite of ["compiler", "conformance"]) for (const n of readdirSync(join(base, suite))) {
  if (!n.endsWith(".errors.txt")) continue;
  total++;
  const top = readFileSync(join(base, suite, n), "utf8").split(/\r?\n\r?\n\r?\n/)[0];
  const cs = [...top.matchAll(/^(?:\S.*\(\d+,\d+\): )?(?:error|warning|suggestion|message) TS(\d+): /gm)].map(m => Number(m[1]));
  const hasSynOnly = cs.some(c => synOnly.has(c));
  if (!hasSynOnly) continue;
  anySynOnly++;
  const hasNonSyn = cs.some(c => !syn.has(c));
  if (hasNonSyn) mixedStrict++;
  else if (cs.length > 1) synOnlyMulti++;
  else exactlyOne++;
  for (const c of cs) if (!syn.has(c) && !sem.has(c)) otherCodes.set(c, (otherCodes.get(c) ?? 0) + 1);
}
console.log(JSON.stringify({ total, withParserOnlyCode: anySynOnly, ofThose_alsoACodeTheParserNeverEmits: mixedStrict, ofThose_severalDiagnosticsAllParserCodes: synOnlyMulti, ofThose_exactlyOneDiagnostic: exactlyOne }));
