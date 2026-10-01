import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const go = "/workspace/ref/typescript-go";
const gen = readFileSync(join(go, "internal/diagnostics/diagnostics_generated.go"), "utf8");
const codeOf = new Map<string, number>();
for (const m of gen.matchAll(/^var (\w+) = &Message\{code: (\d+),/gm)) codeOf.set(m[1], Number(m[2]));
function goFiles(d: string): string[] { const out: string[] = []; const walk = (p: string) => { for (const e of readdirSync(p, { withFileTypes: true })) { const q = join(p, e.name); if (e.isDirectory()) { if (e.name !== "testdata") walk(q); } else if (e.name.endsWith(".go") && !e.name.endsWith("_test.go")) out.push(q); } }; walk(join(go, d)); return out; }
function codes(dirs: string[]) { const s = new Set<number>(); for (const d of dirs) for (const f of goFiles(d)) for (const m of readFileSync(f, "utf8").matchAll(/diagnostics\.([A-Za-z0-9_]+)/g)) { const c = codeOf.get(m[1]); if (c !== undefined) s.add(c); } return s; }
const internal = readdirSync(join(go, "internal"), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
const perPkg = new Map<string, Set<number>>();
for (const p of internal) if (!["diagnostics", "testutil", "testrunner", "fourslash", "ls", "lsp", "project", "api"].includes(p)) perPkg.set(p, codes(["internal/" + p]));
const typecheckPk = ["checker", "binder", "ast", "core", "evaluator", "jsnum", "scanner"];
const parserPk = ["parser"];
const owned = new Set<number>(); for (const p of [...typecheckPk, ...parserPk]) for (const c of perPkg.get(p) ?? []) owned.add(c);
const base = join(go, "testdata/baselines/reference/submodule");
let total = 0, withUnowned = 0, withFileLess = 0; const unownedCodes = new Map<number, number>(); const pkgOf = (c: number) => [...perPkg].filter(([p, s]) => s.has(c)).map(([p]) => p).join("+") || "?";
const byPkg = new Map<string, number>();
for (const suite of ["compiler", "conformance"]) for (const n of readdirSync(join(base, suite))) {
  if (!n.endsWith(".errors.txt")) continue; total++;
  const top = readFileSync(join(base, suite, n), "utf8").split(/\r?\n\r?\n\r?\n/)[0];
  const heads = [...top.matchAll(/^(\S.*\(\d+,\d+\): |\S.*\(--,--\): )?(?:error|warning|suggestion|message) TS(\d+): /gm)];
  const cs = heads.map(m => Number(m[2]));
  if (heads.some(m => m[1] === undefined)) withFileLess++;
  const un = [...new Set(cs.filter(c => !owned.has(c)))];
  if (un.length) { withUnowned++; const pk = new Set(un.map(pkgOf)); for (const p of pk) byPkg.set(p, (byPkg.get(p) ?? 0) + 1); for (const c of un) unownedCodes.set(c, (unownedCodes.get(c) ?? 0) + 1); }
}
console.log(JSON.stringify({ errorBaselines: total, withADiagnosticWithoutFile: withFileLess, withACodeNoCheckerBinderParserScannerEmits: withUnowned }));
console.log("by emitting package(s):", [...byPkg].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([p, n]) => `${p} ${n}`).join("; "));
console.log("top codes:", [...unownedCodes].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([c, n]) => `TS${c}(${pkgOf(c)}) ${n}`).join("; "));
