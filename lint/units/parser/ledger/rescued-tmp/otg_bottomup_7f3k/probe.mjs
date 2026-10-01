// Spot probe: installed bun against tsc 6.0.2. One input per line of the input file.
// A line "# text" is a heading. The two characters \n in an input become a newline.
// Prefix "tsx: " probes with the tsx loader and as input.tsx. Prefix "deco: " turns experimentalDecorators on.
// usage: bun probe.mjs <inputs.txt> [--emit]
import { readFileSync } from "node:fs";
const ts = (await import("/workspace/bun/node_modules/typescript/lib/typescript.js")).default;

// Codes that come from unresolved names and from types in small snippets, not from the syntax.
const NOISE = new Set([
  2304, 2552, 2307, 2792, 2580, 2581, 2582, 2583, 2584, 2585, 2591, 2592, 2593, 2318, 2339, 2322, 2345, 2554, 2693, 2749,
  2362, 2363, 2365, 2367, 2695, 2454, 2448, 2872, 2873, 2531, 2532, 2533, 18046, 18047, 18048, 18049, 18050, 2349, 2351,
  2769, 2741, 2740, 2739, 2355, 2503, 2833, 2694, 2305, 2306, 2314, 2315, 2344, 2558, 2538, 2352,
  7006, 7005, 7008, 7010, 7011, 7015, 7016, 7017, 7018, 7019, 7022, 7023, 7024, 7031, 7034, 7053, 2347, 2564,
]);
const isNoise = code => NOISE.has(code);

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith("--"));
const wantEmit = args.includes("--emit");
const lines = readFileSync(file, "utf8").split("\n");

const DECO = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const T = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
  tsdeco: new Bun.Transpiler({ loader: "ts", tsconfig: DECO }),
  tsxdeco: new Bun.Transpiler({ loader: "tsx", tsconfig: DECO }),
};

function bun(src, loader) {
  try {
    const out = T[loader].transformSync(src);
    return { ok: true, out };
  } catch (e) {
    const list = e && Array.isArray(e.errors) && e.errors.length ? e.errors : [e];
    return { ok: false, err: list.map(x => `${x?.message ?? x} @${x?.position?.offset ?? "?"}`).join(" | ") };
  }
}

function tsc(src, tsx, deco) {
  const fileName = tsx ? "/input.tsx" : "/input.ts";
  const kind = tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.ESNext, true, kind);
  const fmt = d => `TS${d.code}@${d.start}+${d.length} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
  const parse = sf.parseDiagnostics.map(fmt);
  let sem = [];
  let noise = [];
  if (parse.length === 0) {
    const options = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.Preserve,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noLib: true,
      noResolve: true,
      types: [],
      jsx: ts.JsxEmit.Preserve,
      noEmit: true,
      strict: false,
      experimentalDecorators: deco,
      emitDecoratorMetadata: deco,
    };
    const host = {
      getSourceFile: (name, o) => (name === fileName ? ts.createSourceFile(name, src, o, true, kind) : undefined),
      getDefaultLibFileName: () => "/lib.d.ts",
      writeFile() {},
      getCurrentDirectory: () => "/",
      getCanonicalFileName: f => f,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => "\n",
      fileExists: f => f === fileName,
      readFile: f => (f === fileName ? src : undefined),
      directoryExists: () => true,
      getDirectories: () => [],
    };
    try {
      const program = ts.createProgram({ rootNames: [fileName], options, host });
      const f = program.getSourceFile(fileName);
      const all = [...program.getSyntacticDiagnostics(f), ...program.getSemanticDiagnostics(f)];
      for (const d of all) {
        if (isNoise(d.code)) noise.push(d.code);
        else sem.push(fmt(d));
      }
    } catch (e) {
      sem.push("CHECKER THREW " + String(e?.message ?? e).slice(0, 120));
    }
  }
  let emit;
  if (wantEmit && parse.length === 0) {
    emit = ts.transpileModule(src, {
      fileName,
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.Preserve,
        useDefineForClassFields: true,
        noEmitHelpers: true,
        verbatimModuleSyntax: false,
        experimentalDecorators: deco,
        emitDecoratorMetadata: deco,
      },
    }).outputText;
  }
  return { parse, sem, noise, emit };
}

const one = s => JSON.stringify(s);
for (let line of lines) {
  if (!line.trim()) continue;
  if (line.startsWith("#")) {
    console.log("\n" + line);
    continue;
  }
  let tsx = false;
  let deco = false;
  for (;;) {
    if (line.startsWith("tsx: ")) {
      tsx = true;
      line = line.slice(5);
    } else if (line.startsWith("deco: ")) {
      deco = true;
      line = line.slice(6);
    } else break;
  }
  const src = line.replaceAll("\\n", "\n");
  const loader = (tsx ? "tsx" : "ts") + (deco ? "deco" : "");
  const b = bun(src, loader);
  const t = tsc(src, tsx, deco);
  const tscOk = t.parse.length === 0;
  let cls;
  if (b.ok) cls = tscOk ? (t.sem.length ? "AAg" : "AA") : "B";
  else cls = tscOk ? (t.sem.length ? "A2" : "A1") : "RR";
  console.log(`[${cls}] ${tsx ? "(tsx) " : ""}${deco ? "(deco) " : ""}${one(src)}`);
  console.log(`     bun: ${b.ok ? "ok " + one(b.out) : b.err}`);
  if (!tscOk) console.log(`     tsc parse: ${t.parse.join(" | ")}`);
  else {
    console.log(`     tsc: parse ok${t.sem.length ? "; checker: " + t.sem.join(" | ") : ""}${t.noise.length ? "  (noise " + [...new Set(t.noise)].join(",") + ")" : ""}`);
    if (wantEmit) console.log(`     tsc emit: ${one(t.emit)}`);
  }
}
