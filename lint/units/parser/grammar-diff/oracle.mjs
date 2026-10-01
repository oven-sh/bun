// What tsc 6.0.2 says about every input of a corpus. Independent of the bun binary under test.
//
//   bun oracle.mjs <corpus.json> <oracle.jsonl.gz>
//
// Per source: parse diagnostics as input.ts and input.tsx ([code, start, length, text]) and, for a
// source with a decorator that parses as .ts, the `__metadata(...)` calls tsc emits with
// experimentalDecorators + emitDecoratorMetadata, as [key, value] pairs in emit order.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
import { expand } from "./harness.mjs";

const TS_PATH = process.env.ORACLE_TYPESCRIPT ?? "/workspace/wt/parser/node_modules/typescript/lib/typescript.js";
const ts = createRequire(import.meta.url)(TS_PATH);

const [corpusPath, outPath] = process.argv.slice(2);
if (!corpusPath || !outPath) {
  console.error("usage: bun oracle.mjs <corpus.json> <oracle.jsonl.gz>");
  process.exit(1);
}
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const inputs = expand(corpus);
const fmt = d => [d.code, d.start ?? null, d.length ?? null, ts.flattenDiagnosticMessageText(d.messageText, "\n")];
const parse = (src, name, kind) => ts.createSourceFile(name, src, ts.ScriptTarget.ESNext, false, kind).parseDiagnostics.map(fmt);

export function metadataOf(text) {
  const out = [];
  const re = /__metadata\("(design:\w+)", /g;
  for (let m; (m = re.exec(text)); ) {
    let depth = 0;
    let i = re.lastIndex;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        if (depth === 0) break;
        depth--;
      }
    }
    out.push([m[1], text.slice(re.lastIndex, i).replace(/\s+/g, " ").trim()]);
  }
  return out;
}

// `meta` is under the defaults of tsc 6 (strict), `metaLoose` under strictNullChecks: false when it differs.
function emit(src, extra) {
  return ts.transpileModule(src, {
    fileName: "/input.ts",
    reportDiagnostics: false,
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      useDefineForClassFields: false,
      verbatimModuleSyntax: false,
      ...extra,
    },
  }).outputText;
}

const lines = [JSON.stringify({ header: 1, version: ts.version, revision: "tsc", corpus: corpus.name, count: inputs.length, apis: [] })];
for (const input of inputs) {
  const record = { src: input.src, ts: parse(input.src, "/input.ts", ts.ScriptKind.TS), tsx: parse(input.src, "/input.tsx", ts.ScriptKind.TSX) };
  if (record.ts.length === 0 && input.src.includes("@")) {
    try {
      record.meta = metadataOf(emit(input.src, {}));
      const loose = metadataOf(emit(input.src, { strictNullChecks: false }));
      if (JSON.stringify(loose) !== JSON.stringify(record.meta)) record.metaLoose = loose;
    } catch (e) {
      record.metaThrew = String(e?.message ?? e).slice(0, 200);
    }
  }
  lines.push(JSON.stringify(record));
}
writeFileSync(outPath, gzipSync(lines.join("\n") + "\n"));
const clean = lines.slice(1).filter(l => l.includes('"ts":[]')).length;
console.log(`${outPath}: ${inputs.length} sources, ${clean} parse as .ts without a diagnostic, typescript ${ts.version}`);
