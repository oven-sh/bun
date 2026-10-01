import fs from "node:fs";
import { rawDump, ts } from "./rawdump.mjs";
import { makePositionMap } from "./convert.mjs";
const [outdir, listFile] = process.argv.slice(2);
let same = 0, diff = 0, n = 0;
const ex = [];
for (const a of fs.readFileSync(listFile, "utf8").split("\n")) {
  if (!a) continue;
  const eq = a.indexOf("=");
  const name = a.slice(0, eq), path = a.slice(eq + 1);
  let text = fs.readFileSync(path, "utf8");
  let d;
  try { d = rawDump("/" + name, text); } catch { continue; }
  const u8 = makePositionMap(text);
  const mine = d.header.commentDirectives.map(c => `commentDirective [${u8(c[0])},${u8(c[1])}) kind=${c[2]}`);
  const head = fs.readFileSync(`${outdir}/${name}.tsgo.txt`, "utf8").split("\nroot ")[0].split("\n");
  const theirs = head.filter(l => l.startsWith("commentDirective "));
  const h0 = head[0];
  const mineHead = `file /${name} scriptKind=${d.header.scriptKind} variant=${d.header.languageVariant} dts=${d.header.isDeclarationFile} textLen=${Buffer.byteLength(text)}`;
  if (mine.length) n++;
  if (mine.join("\n") === theirs.join("\n") && h0 === mineHead) same++;
  else { diff++; if (ex.length < 5) ex.push([name, h0, mineHead, theirs.slice(0, 2), mine.slice(0, 2)]); }
}
console.log(JSON.stringify({ same, diff, unitsWithDirectives: n }));
for (const e of ex) console.log(JSON.stringify(e));
