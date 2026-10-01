// What tsc 6.0.2 says about every input of a corpus. Independent of the bun binary under test.
//
//   bun oracle.mjs <corpus.json> <oracle.jsonl.gz>
//
// Per source:
//   ts, tsx     parse diagnostics as input.ts and input.tsx ([code, start, length, text])
//   meta        for a source with a decorator that parses as .ts: the `__metadata(...)` calls tsc emits with
//               experimentalDecorators + emitDecoratorMetadata, as [key, value] pairs in emit order
//   metaLoose   the same with strictNullChecks: false, when it differs
//   chk         the grammar errors of the checker, for each dialect whose parse is clean: { ts?, tsx?, tsL?, tsxL? },
//               each a list of [code, start, length, text]. One program per source and dialect, noLib.
//               tsL and tsxL are the lists with experimentalDecorators, present for a source with "@" when
//               they differ from ts and tsx.
//   oth         the other codes of the same semantic diagnostics, distinct and sorted: { ts?, tsx? }
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
import { expand } from "./harness.mjs";

const TS_PATH = process.env.ORACLE_TYPESCRIPT ?? "/workspace/wt/parser/node_modules/typescript/lib/typescript.js";
const ts = createRequire(import.meta.url)(TS_PATH);

// A grammar error of the checker is a semantic diagnostic with one of these codes.
// prettier-ignore
export const GRAMMAR_CODES = new Set([
  // every diagnostic that typescript-go names in internal/checker/grammarchecks.go, without 2300 (Duplicate identifier)
  1005, 1009, 1013, 1014, 1015, 1016, 1017, 1018, 1019, 1020, 1021, 1022, 1024, 1025, 1028, 1029, 1030, 1031,
  1036, 1038, 1039, 1040, 1042, 1044, 1046, 1047, 1048, 1049, 1051, 1052, 1053, 1054, 1070, 1071, 1079, 1089,
  1090, 1091, 1092, 1093, 1094, 1095, 1096, 1097, 1098, 1099, 1103, 1104, 1105, 1106, 1107, 1115, 1116, 1117,
  1118, 1119, 1123, 1155, 1156, 1162, 1163, 1165, 1166, 1168, 1169, 1170, 1171, 1172, 1173, 1174, 1175, 1176,
  1182, 1183, 1184, 1186, 1187, 1188, 1189, 1190, 1200, 1206, 1207, 1216, 1221, 1222, 1242, 1243, 1244, 1246,
  1247, 1248, 1249, 1253, 1254, 1255, 1263, 1264, 1268, 1273, 1274, 1275, 1276, 1277, 1287, 1308, 1309, 1312,
  1317, 1318, 1319, 1323, 1324, 1325, 1326, 1330, 1331, 1332, 1333, 1334, 1335, 1337, 1346, 1347, 1348, 1349,
  1354, 1356, 1358, 1363, 1375, 1378, 1431, 1432, 1433, 1450, 1451, 1486, 1491, 1492, 1493, 1494, 1495, 1497,
  1498, 1539, 1545, 1546, 1547, 1548, 2206, 2207, 2304, 2404, 2462, 2480, 2483, 2501, 2523, 2524, 2566, 2633,
  2639, 2737, 2852, 2853, 2854, 6204, 7060, 7061, 8038, 17000, 17001, 17012, 18006, 18007, 18010, 18016,
  18019, 18037, 18054, 18058, 18059, 18060, 18061, 80008,
  // what typescript-go passes to a grammarError* or checkGrammar* call elsewhere in internal/checker
  1003, 1035, 1108, 1110, 1111, 1113, 1114, 1120, 1142, 1191, 1193, 1196, 1197, 1202, 1203, 1211, 1218, 1257,
  1265, 1266, 1300, 1338, 1392, 1453, 1454, 1463, 1464, 2410, 2492, 2666, 2667, 2714, 2803, 2823, 2856, 2857,
  5076, 5085, 5086, 5087, 7059, 8020, 17019, 17020, 18036, 18038, 18041, 18057,
  // the messages of checkGrammarModuleElementContext, and the import assertions of tsc 6.0.2
  1231, 1232, 1233, 1234, 1235, 1258, 2822, 2880,
]);

const textOf = d => ts.flattenDiagnosticMessageText(d.messageText, "\n");
// TS2304 is in the set for one use only: a private name that nothing declares (`typeof #a`).
const isGrammarError = d => GRAMMAR_CODES.has(d.code) && (d.code !== 2304 || /^Cannot find name '#/.test(textOf(d)));
const fmt = d => [d.code, d.start ?? null, d.length ?? null, textOf(d)];
const kindOf = dialect => (dialect === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
// The parse diagnostics of a source as input.ts or input.tsx.
export const parseAs = (src, dialect) => ts.createSourceFile(`/input.${dialect}`, src, ts.ScriptTarget.ESNext, false, kindOf(dialect)).parseDiagnostics.map(fmt);

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

// The options of a tsconfig for Bun. No lib: a grammar error does not depend on one.
const CHECK_OPTIONS = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.Preserve,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  moduleDetection: ts.ModuleDetectionKind.Force,
  jsx: ts.JsxEmit.Preserve,
  noLib: true,
  noResolve: true,
  types: [],
};
const LEGACY_OPTIONS = { ...CHECK_OPTIONS, experimentalDecorators: true, emitDecoratorMetadata: true };

// The semantic diagnostics of a program whose one file is the source.
function semanticDiagnostics(src, fileName, kind, options) {
  let file;
  const host = {
    getSourceFile: (name, languageVersionOrOptions) => (name === fileName ? (file ??= ts.createSourceFile(name, src, languageVersionOrOptions, true, kind)) : undefined),
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
  const program = ts.createProgram({ rootNames: [fileName], options, host });
  return program.getSemanticDiagnostics(program.getSourceFile(fileName));
}

// { grammar: [[code, start, length, text]], other: [codes] } of a source that parses, as .ts or as .tsx.
export function check(src, dialect, legacy) {
  const all = semanticDiagnostics(src, `/input.${dialect}`, kindOf(dialect), legacy ? LEGACY_OPTIONS : CHECK_OPTIONS);
  return { grammar: all.filter(isGrammarError).map(fmt), other: [...new Set(all.filter(d => !isGrammarError(d)).map(d => d.code))].sort((a, b) => a - b) };
}

function checkInto(record, src, dialect) {
  const plain = check(src, dialect, false);
  record.chk[dialect] = plain.grammar;
  if (plain.other.length > 0) record.oth[dialect] = plain.other;
  if (!src.includes("@")) return;
  const legacy = check(src, dialect, true).grammar;
  if (JSON.stringify(legacy) !== JSON.stringify(plain.grammar)) record.chk[dialect + "L"] = legacy;
}

export function recordOf(src) {
  const record = { src, ts: parseAs(src, "ts"), tsx: parseAs(src, "tsx") };
  if (record.ts.length === 0 && src.includes("@")) {
    try {
      record.meta = metadataOf(emit(src, {}));
      const loose = metadataOf(emit(src, { strictNullChecks: false }));
      if (JSON.stringify(loose) !== JSON.stringify(record.meta)) record.metaLoose = loose;
    } catch (e) {
      record.metaThrew = String(e?.message ?? e).slice(0, 200);
    }
  }
  record.chk = {};
  record.oth = {};
  try {
    if (record.ts.length === 0) checkInto(record, src, "ts");
    if (record.tsx.length === 0) checkInto(record, src, "tsx");
  } catch (e) {
    record.chkThrew = String(e?.message ?? e).slice(0, 200);
  }
  return record;
}

if (import.meta.main) {
  const [corpusPath, outPath] = process.argv.slice(2);
  if (!corpusPath || !outPath) {
    console.error("usage: bun oracle.mjs <corpus.json> <oracle.jsonl.gz>");
    process.exit(1);
  }
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
  const inputs = expand(corpus);
  const lines = [JSON.stringify({ header: 1, version: ts.version, revision: "tsc", corpus: corpus.name, count: inputs.length, apis: [], grammarCodes: GRAMMAR_CODES.size })];
  let clean = 0;
  let valid = 0;
  let threw = 0;
  for (const input of inputs) {
    const record = recordOf(input.src);
    if (record.ts.length === 0) clean++;
    if (record.chk.ts?.length === 0) valid++;
    if (record.chkThrew !== undefined) threw++;
    lines.push(JSON.stringify(record));
  }
  writeFileSync(outPath, gzipSync(lines.join("\n") + "\n"));
  console.log(`${outPath}: ${inputs.length} sources, ${clean} parse as .ts without a diagnostic, ${valid} of them without a grammar error of the checker, ${threw} where the checker threw, typescript ${ts.version}`);
}
