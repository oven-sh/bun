// First diagnostic of the reference parser for every source that it rejects, beside what the base build says.
// This is the expectation table for the diagnostic codes of a lint parse.
//
//   bun first-codes.mjs <data dir> <out dir>
//
// Writes <out>/first-codes.tsv.gz   one row per (source, dialect) that typescript-go rejects, primary dialect only:
//            id, dialect, typescript-go code, start, length, message, number of diagnostics,
//            tsc 6.0.2 first code, start, length ("=" when equal to typescript-go, "parses" when tsc has none),
//            Bun verdict of the base build ("accepts" or the first message), offset of that message, source
//        <out>/first-codes.by-bun-message.tsv   per first message of Bun (names and literals replaced): rows,
//            rows where the offset of Bun equals the start of typescript-go, the typescript-go codes it meets
//        <out>/first-codes.by-code.tsv          per typescript-go first code: rows, Bun accepts, Bun rejects,
//            Bun rejects at the same offset, the Bun messages it meets
//        <out>/first-codes.summary.txt
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { readBunSide, readJsonl, readParseSide, tsv } from "./lib.mjs";

const [dataDir, outDir] = process.argv.slice(2);
if (!dataDir || !outDir) {
  console.error("usage: bun first-codes.mjs <data dir> <out dir>");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const corpus = readJsonl(join(dataDir, "corpus.jsonl.gz"));
const base = readBunSide(join(dataDir, "bun.base.jsonl.gz"));
const tsc = readParseSide(join(dataDir, "tsc.jsonl.gz"));
const tsgo = readParseSide(join(dataDir, "tsgo.jsonl.gz"));

const WORDS = new Set(
  "abstract accessor any as asserts assert async await bigint boolean break case catch class const constructor continue debugger declare default defer delete do else enum export extends false finally for from function get global if implements import in infer instanceof interface intrinsic is keyof let module namespace never new null number object of out override package private protected public readonly require return satisfies set static string super switch symbol this throw true try type typeof undefined unique unknown using var void while with yield".split(
    " ",
  ),
);
const normToken = t => {
  if (/^[A-Za-z_$][\w$]*$/.test(t)) return WORDS.has(t) ? t : "<name>";
  if (/^[0-9]/.test(t)) return "<number>";
  if (/^['"`]/.test(t) && t.length > 1) return "<string>";
  return t;
};
const normMessage = m =>
  m
    .replace(/but found "((?:[^"\\]|\\.)*)"/g, (_, t) => `but found "${normToken(t)}"`)
    .replace(/^Unexpected "((?:[^"\\]|\\.)*)"$/, (_, t) => `Unexpected "${normToken(t)}"`)
    .replace(/^Unexpected ([A-Za-z_$][\w$]*)$/, (_, t) => `Unexpected ${normToken(t)}`)
    .replace(/^"((?:[^"\\]|\\.)*)" has already been declared$/, '"<name>" has already been declared');

const lines = ["id\tdialect\ttypescript-go code\tstart\tlength\tmessage\tdiagnostics\ttsc code\ttsc start\ttsc length\tBun (base build)\tBun offset\tsource"];
const byMessage = new Map();
const byCode = new Map();
let rows = 0;
let bunAccepts = 0;
let sameOffset = 0;
let tscEqual = 0;
for (const rec of corpus) {
  const d = rec.tsxOnly ? "tsx" : "ts";
  const g = tsgo.out.get(rec.id)[d];
  if (g[0] <= 0) continue;
  const b = base.out.get(rec.id);
  if (b.crash !== undefined) continue;
  const v = b[d];
  const t = tsc.out.get(rec.id)[d];
  const first = g[1][0];
  const tscCols = t[0] === 0 ? ["parses", "", ""] : t[1][0][0] === first[0] && t[1][0][1] === first[1] && t[1][0][2] === first[2] ? ["=", "", ""] : [`TS${t[1][0][0]}`, t[1][0][1], t[1][0][2]];
  if (tscCols[0] === "=") tscEqual++;
  const bunText = v[0] === "o" ? "accepts" : v[1][0][0];
  const bunOffset = v[0] === "o" ? "" : v[1][0][3];
  rows++;
  lines.push([rec.id, d, `TS${first[0]}`, first[1], first[2], tsv(first[3]), g[0], ...tscCols, tsv(bunText), bunOffset, tsv(rec.src)].join("\t"));
  const code = `TS${first[0]} ${first[3].replace(/'[^']*'/g, m => (m.length > 12 ? "'...'" : m))}`;
  if (!byCode.has(code)) byCode.set(code, { rows: 0, accepts: 0, rejects: 0, same: 0, messages: new Map(), ex: null });
  const c = byCode.get(code);
  c.rows++;
  if (c.ex === null || rec.src.length < c.ex.length) c.ex = rec.src;
  if (v[0] === "o") {
    bunAccepts++;
    c.accepts++;
    continue;
  }
  c.rejects++;
  const msg = normMessage(bunText);
  c.messages.set(msg, (c.messages.get(msg) ?? 0) + 1);
  if (!byMessage.has(msg)) byMessage.set(msg, { rows: 0, same: 0, codes: new Map(), ex: null });
  const m = byMessage.get(msg);
  m.rows++;
  if (m.ex === null || rec.src.length < m.ex.length) m.ex = rec.src;
  m.codes.set(code, (m.codes.get(code) ?? 0) + 1);
  if (bunOffset === first[1]) {
    m.same++;
    c.same++;
    sameOffset++;
  }
}
writeFileSync(join(outDir, "first-codes.tsv.gz"), gzipSync(lines.join("\n") + "\n"));
const top = (map, n) =>
  [...map]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, c]) => `${k} (${c})`)
    .join("; ");
{
  const out = ["Bun message\trows\tBun offset equals the start of typescript-go\tdistinct typescript-go codes\ttypescript-go first codes\tshortest example"];
  for (const [k, m] of [...byMessage].sort((a, b) => b[1].rows - a[1].rows)) out.push(`${tsv(k)}\t${m.rows}\t${m.same}\t${m.codes.size}\t${top(m.codes, 6)}\t${tsv(m.ex)}`);
  writeFileSync(join(outDir, "first-codes.by-bun-message.tsv"), out.join("\n") + "\n");
}
{
  const out = ["typescript-go first code\trows\tBun accepts\tBun rejects\tBun rejects at the same offset\tBun messages\tshortest example"];
  for (const [k, c] of [...byCode].sort((a, b) => b[1].rows - a[1].rows)) out.push(`${k}\t${c.rows}\t${c.accepts}\t${c.rejects}\t${c.same}\t${top(c.messages, 5)}\t${tsv(c.ex)}`);
  writeFileSync(join(outDir, "first-codes.by-code.tsv"), out.join("\n") + "\n");
}
const summary = [
  `sources that typescript-go 89d5d5b rejects (primary dialect): ${rows}`,
  `  tsc 6.0.2 has the same first code and span: ${tscEqual}`,
  `  the base build accepts: ${bunAccepts}; rejects: ${rows - bunAccepts}; rejects with its first error at the start of the first diagnostic of typescript-go: ${sameOffset}`,
  `  distinct first codes (code and message, long quoted arguments cut): ${byCode.size}; distinct Bun messages (names and literals replaced): ${byMessage.size}`,
  `  Bun messages that meet exactly one typescript-go code: ${[...byMessage.values()].filter(m => m.codes.size === 1).length} (${[...byMessage.values()].filter(m => m.codes.size === 1).reduce((a, m) => a + m.rows, 0)} rows)`,
  `  most frequent first codes: ${top(new Map([...byCode].map(([k, c]) => [k, c.rows])), 12)}`,
];
writeFileSync(join(outDir, "first-codes.summary.txt"), summary.join("\n") + "\n");
console.log(summary.join("\n"));
