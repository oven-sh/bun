// Oracle baselines that hold a diagnostic which only the parser or the scanner of the reference reports.
import { existsSync, readFileSync } from "node:fs";
const gen = readFileSync("/workspace/ref/typescript-go/internal/diagnostics/diagnostics_generated.go", "utf8");
const codeOf = new Map<string, number>();
for (const m of gen.matchAll(/^var (\w+) = &Message\{code: (\d+),/gm)) codeOf.set(m[1], Number(m[2]));
const use = new Map<number, Set<string>>();
for (const l of readFileSync("msguse.tsv", "utf8").split("\n").filter(Boolean)) {
  const [pkg, key] = l.split("\t");
  const code = codeOf.get(key);
  if (code === undefined) continue;
  if (!use.has(code)) use.set(code, new Set());
  use.get(code)!.add(pkg);
}
const parserOnly = new Set<number>(), parserAlso = new Set<number>();
for (const [code, pk] of use) {
  const syn = pk.has("parser") || pk.has("scanner");
  const others = [...pk].filter(p => p !== "parser" && p !== "scanner");
  if (syn && others.length === 0) parserOnly.add(code);
  else if (syn) parserAlso.add(code);
}
console.log("codes only the parser or scanner reports:", parserOnly.size, "; codes they share with another package:", parserAlso.size, [...parserAlso].sort((a, b) => a - b).join(","));
const P = "/workspace/notes/lint/units/conformance/enumerator/prototype/";
const { enumerateInstances } = await import(P + "compiler_runner.ts");
const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const baselines = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
const e = enumerateInstances({ casesRoot });
let E = 0, withParserOnly = 0, withShared = 0, onlySyntactic = 0;
const byCode = new Map<number, number>();
for (const i of e.instances) {
  if (i.status !== "run") continue;
  const oracle = baselines + "/" + i.suite + "/" + i.name.replace(/\.tsx?$/, ".errors.txt");
  if (!existsSync(oracle)) continue;
  E++;
  const text = readFileSync(oracle).toString("latin1");
  const end = text.indexOf("\r\n\r\n\r\n");
  const top = text.startsWith("\x1b[") ? text : text.slice(0, end + 2);
  const codes = [...top.matchAll(/(?:error|message|suggestion|warning)(?:\x1b\[0m\x1b\[90m)? TS(\d+): /g)].map(m => Number(m[1]));
  const a = codes.some(c => parserOnly.has(c)), b = codes.some(c => parserAlso.has(c));
  if (a) { withParserOnly++; for (const c of new Set(codes.filter(c => parserOnly.has(c)))) byCode.set(c, (byCode.get(c) ?? 0) + 1); }
  if (!a && b) withShared++;
  if (codes.length > 0 && codes.every(c => parserOnly.has(c))) onlySyntactic++;
}
console.log(JSON.stringify({ E, withParserOnlyCode: withParserOnly, withSharedCodeOnly: withShared, everyCodeParserOnly: onlySyntactic }));
console.log("top parser-only codes by baselines:", [...byCode].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([c, n]) => `TS${c}=${n}`).join(" "));
