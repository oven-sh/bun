import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
function* walk(d: string): Generator<string> {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}
const TS = "/workspace/ref/typescript-go/_submodules/TypeScript/";
const files = [...walk(TS + "tests/cases/conformance"), ...walk(TS + "tests/cases/compiler")];
type V = { name: string; decode: (b: Buffer) => string; split: RegExp; isC: (l: string) => boolean };
const utf8 = (b: Buffer) => b.toString("utf8");
const utf8NoBom = (b: Buffer) => { const s = b.toString("utf8"); return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s; };
const latin1 = (b: Buffer) => b.toString("latin1");
const utf16aware = (b: Buffer) => {
  if (b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString("utf16le");
  if (b[0] === 0xfe && b[1] === 0xff) { const c = Buffer.from(b.subarray(2)); c.swap16(); return c.toString("utf16le"); }
  return utf8NoBom(b);
};
const cop = (line: string) => { const t = line.trimStart(); return t.startsWith("//") || t.startsWith("/*") || t === "*" || t === "*/" || t.startsWith("* "); };
const variants: V[] = [
  { name: "latin1, \\n, trimStart //", decode: latin1, split: /\n/, isC: l => l.trimStart().startsWith("//") },
  { name: "latin1, \\n, col0 //", decode: latin1, split: /\n/, isC: l => l.startsWith("//") },
  { name: "latin1, \\n, [ \\t]* //", decode: latin1, split: /\n/, isC: l => /^[ \t]*\/\//.test(l) },
  { name: "latin1, \\n, comment-cop", decode: latin1, split: /\n/, isC: cop },
  { name: "utf8 (BOM kept), \\n, trimStart //", decode: utf8, split: /\n/, isC: l => l.trimStart().startsWith("//") },
  { name: "utf8 (BOM kept), \\n, col0 //", decode: utf8, split: /\n/, isC: l => l.startsWith("//") },
  { name: "utf8 (BOM kept), \\n, [ \\t]* //", decode: utf8, split: /\n/, isC: l => /^[ \t]*\/\//.test(l) },
  { name: "utf8 (BOM kept), \\n, comment-cop", decode: utf8, split: /\n/, isC: cop },
  { name: "utf8 no BOM, \\r?\\n|\\r, col0 //", decode: utf8NoBom, split: /\r\n|\r|\n/, isC: l => l.startsWith("//") },
  { name: "utf8 no BOM, \\r?\\n|\\r, [ \\t]* //", decode: utf8NoBom, split: /\r\n|\r|\n/, isC: l => /^[ \t]*\/\//.test(l) },
  { name: "utf16 aware, \\r?\\n|\\r, trimStart //", decode: utf16aware, split: /\r\n|\r|\n/, isC: l => l.trimStart().startsWith("//") },
  { name: "utf16 aware, \\r?\\n|\\r, comment-cop", decode: utf16aware, split: /\r\n|\r|\n/, isC: cop },
];
const counts = variants.map(() => 0);
const threes = variants.map(() => 0);
for (const f of files) {
  const b = readFileSync(f);
  variants.forEach((v, i) => {
    const lines = v.decode(b).split(v.split);
    let run = 0, best = 0;
    for (const l of lines) { if (v.isC(l)) { run++; if (run > best) best = run; } else run = 0; }
    if (best >= 2) counts[i]++;
    if (best >= 3) threes[i]++;
  });
}
console.log("files", files.length);
variants.forEach((v, i) => console.log(String(counts[i]).padStart(6), String(threes[i]).padStart(6), v.name));
