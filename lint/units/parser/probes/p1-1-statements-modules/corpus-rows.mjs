// Lists the corpus rows of the statements area with the verdict of the base build (ts configuration).
import { readBunSide, readJsonl } from "/workspace/notes/lint/units/parser/ledger/top-down/corpus/lib.mjs";
import { writeFileSync } from "node:fs";
const HERE = "/workspace/notes/lint/units/parser/ledger/top-down/corpus";
const corpus = readJsonl(HERE + "/data/corpus.jsonl.gz");
const classes = new Map(readJsonl(HERE + "/out/classes.jsonl.gz").map(r => [r.id, r]));
const base = readBunSide(HERE + "/data/bun.base.jsonl.gz");
console.error("configs", base.header.configs, "rows", corpus.length);
const re = /(^|[\s;{}])(type|interface|namespace|module)[ \t]+(\/\*.*?\*\/[ \t]*)?(as|satisfies)\b|abstract[ \t]+declare|enum[^{]*\{[^}]*\[|import[ \t]*[(.]|\bwith[ \t]*\{|\bdeclare[ \t]*($|\}|as\b)/;
const out = [];
for (const r of corpus) {
  if (!re.test(r.src)) continue;
  const c = classes.get(r.id);
  const b = base.out.get(r.id);
  const v = b.crash !== undefined ? "CRASH" : (b.ts ?? Object.values(b)[0]);
  out.push(JSON.stringify({ id: r.id, src: r.src, cls: c?.ts, base: v }));
}
writeFileSync("/tmp/p11sm/corpus-area.jsonl", out.join("\n") + "\n");
console.error("matched", out.length);
