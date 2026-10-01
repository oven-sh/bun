// Approximates "ambient top-level options" with today's parser: the file body inside `declare module "m" { ... }`.
// Lists inputs that tsc accepts as input.d.ts without any diagnostic and that Bun still rejects inside the wrapper.
const ts = (await import("/workspace/bun/node_modules/typescript/lib/typescript.js")).default;
const mod = (await import("/workspace/notes/lint/units/parser/probes/inputs/10-declaration-files.mjs")).default;
const t = new Bun.Transpiler({ loader: "ts" });
const NOISE = new Set([2304, 2552, 2503, 2307, 2318, 2792, 2583, 2591, 2580, 2584, 2868, 2867, 2882, 2686, 2879, 17004, 6142, 7026, 2875, 2874, 2300, 2451, 7005, 7006, 7010, 7008, 7031, 2391, 2384, 2394, 2371, 2393, 2528, 2309, 2306, 2664, 2665, 2436, 5061, 2497]);
function bun(src) { try { t.transformSync(src); return "ok"; } catch (e) { const l = e?.errors?.length ? e.errors : [e]; return l.map(x => x.message).join(" | "); } }
function tsc(src) {
  const fileName = "/input.d.ts";
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.ESNext, true);
  if (sf.parseDiagnostics.length) return "parse:" + sf.parseDiagnostics.map(d => "TS" + d.code).join(",");
  const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler, noLib: true, noResolve: true, types: [], noEmit: true, strict: false, experimentalDecorators: true };
  const host = { getSourceFile: f => (f === fileName ? sf : undefined), getDefaultLibFileName: () => "lib.d.ts", writeFile() {}, getCurrentDirectory: () => "/", getCanonicalFileName: f => f, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n", fileExists: f => f === fileName, readFile: () => undefined };
  const program = ts.createProgram([fileName], options, host);
  const d = program.getSemanticDiagnostics(sf).filter(d => !NOISE.has(d.code));
  return d.length ? "check:" + d.map(d => "TS" + d.code).join(",") : "clean";
}
let n = 0, clean = 0, plainRejects = 0, wrappedRejects = 0;
const seen = new Set();
for (const c of mod.cases) {
  const src = c.src; if (seen.has(src)) continue; seen.add(src); n++;
  const verdict = tsc(src);
  if (verdict !== "clean") continue;
  clean++;
  const plain = bun(src);
  if (plain === "ok") continue;
  plainRejects++;
  const wrapped = bun(`declare module "m" {\n${src}\n}`);
  if (wrapped !== "ok") { wrappedRejects++; console.log("STILL  ", JSON.stringify(src), "\n        plain:", plain, "\n        wrapped:", wrapped); }
}
console.log({ inputs: n, tscClean: clean, bunRejectsPlain: plainRejects, bunRejectsWrapped: wrappedRejects });
