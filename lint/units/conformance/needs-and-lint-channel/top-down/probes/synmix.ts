// Baselines that hold a code only the parser or scanner reports together with a code that neither of them reports.
import { existsSync, readFileSync } from "node:fs";
const gen = readFileSync("/workspace/ref/typescript-go/internal/diagnostics/diagnostics_generated.go", "utf8");
const codeOf = new Map<string, number>();
for (const m of gen.matchAll(/^var (\w+) = &Message\{code: (\d+),/gm)) codeOf.set(m[1], Number(m[2]));
const use = new Map<number, Set<string>>();
for (const l of readFileSync("msguse.tsv", "utf8").split("\n").filter(Boolean)) {
  const [pkg, key] = l.split("\t"); const code = codeOf.get(key); if (code === undefined) continue;
  if (!use.has(code)) use.set(code, new Set()); use.get(code)!.add(pkg);
}
const syn = new Set<number>(), synOnly = new Set<number>();
for (const [code, pk] of use) { if (pk.has("parser") || pk.has("scanner")) { syn.add(code); if ([...pk].every(p => p === "parser" || p === "scanner")) synOnly.add(code); } }
const lines = readFileSync("inst.tsv", "utf8").split("\n").filter(Boolean);
const head = lines[0].split("\t");
const rows = lines.slice(1).map(l => Object.fromEntries(l.split("\t").map((v, i) => [head[i], v]))).filter(r => r.status === "run" && r.kind === "E");
const baselines = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
let mixed = 0, moreThanOneAllSyn = 0;
for (const r of rows) {
  const oracle = baselines + "/" + r.suite + "/" + r.name.replace(/\.tsx?$/, ".errors.txt");
  if (!existsSync(oracle)) continue;
  const text = readFileSync(oracle).toString("latin1");
  if (text.startsWith("\x1b[")) continue;
  const top = text.slice(0, text.indexOf("\r\n\r\n\r\n") + 2);
  const codes = [...top.matchAll(/^(?:\S.*?\(\d+,\d+\): |\S.*?\(--,--\): )?(?:error|message|suggestion|warning) TS(\d+): /gm)].map(m => Number(m[1]));
  if (codes.some(c => synOnly.has(c)) && codes.some(c => !syn.has(c))) mixed++;
  if (codes.length > 1 && codes.every(c => syn.has(c))) moreThanOneAllSyn++;
}
console.log(JSON.stringify({ parserOnlyCodeTogetherWithACodeTheParserNeverReports: mixed, moreThanOneDiagnosticAllFromParserCodes: moreThanOneAllSyn }));
