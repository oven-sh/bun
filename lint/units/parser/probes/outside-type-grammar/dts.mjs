import { readFileSync } from "node:fs";
const ts = (await import("/workspace/bun/node_modules/typescript/lib/typescript.js")).default;
const lines = readFileSync(process.argv[2], "utf8").split("\n").filter(l => l.length && !l.startsWith("#"));
const t = new Bun.Transpiler({ loader: "ts" });
const NOISE = new Set([2304, 2552, 2503, 2307, 2318, 2792, 2583, 2591, 2580, 2584, 2868, 2867, 2882, 2686, 2879, 17004, 6142, 7026, 2875, 2874]);
for (const line of lines) {
  const src = line.replaceAll("\\n", "\n");
  let bun; try { t.transformSync(src); bun = "ok"; } catch (e) { const list = e?.errors?.length ? e.errors : [e]; bun = list.map(x => x.message).join(" | "); }
  const fileName = "/input.d.ts";
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const parse = sf.parseDiagnostics.map(d => `TS${d.code}@${d.start} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  let prog = [];
  if (!parse.length) {
    const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler, noLib: true, noResolve: true, types: [], noEmit: true, strict: false, skipLibCheck: false };
    const host = { getSourceFile: f => (f === fileName ? sf : undefined), getDefaultLibFileName: () => "lib.d.ts", writeFile() {}, getCurrentDirectory: () => "/", getCanonicalFileName: f => f, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n", fileExists: f => f === fileName, readFile: () => undefined };
    const program = ts.createProgram([fileName], options, host);
    prog = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)].filter(d => !NOISE.has(d.code)).map(d => `TS${d.code}@${d.start} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  }
  const cls = parse.length ? "dts-parse-error" : prog.length ? "dts-check-error" : "dts-clean";
  console.log(`${cls.padEnd(16)} bun(ts)=${bun === "ok" ? "ok" : "ERR"}  ${JSON.stringify(src)}`);
  if (parse.length) console.log("      " + parse.join(" ; "));
  if (prog.length) console.log("      " + prog.join(" ; "));
  if (bun !== "ok") console.log("      bun: " + bun);
}
