// Compares parse diagnostics and header facts of TypeScript 6.0.2 with the typescript-go dump.
import fs from "node:fs";
import { rawDump, ts } from "./rawdump.mjs";
import { makePositionMap } from "./convert.mjs";
const [outdir, listFile] = process.argv.slice(2);
let same = 0, diff = 0, withErrors = 0;
const buckets = new Map();
const note = (k, name) => buckets.set(k, [...(buckets.get(k) ?? []), name]);
const q = s => JSON.stringify(s);
for (const a of fs.readFileSync(listFile, "utf8").split("\n")) {
  if (!a) continue;
  const eq = a.indexOf("=");
  const name = a.slice(0, eq), path = a.slice(eq + 1);
  let text = fs.readFileSync(path, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let d;
  try { d = rawDump("/" + name, text); } catch (e) { continue; }
  const u8 = makePositionMap(text);
  const mine = d.header.parseDiagnostics.map(x => `[${u8(x[2])},${u8(x[2] + x[3])}) TS${x[0]} cat=${x[1]} ${d.strings[x[4]]}`);
  const theirsAll = fs.readFileSync(`${outdir}/${name}.tsgo.txt`, "utf8");
  const head = theirsAll.slice(0, theirsAll.indexOf("\nroot ") + 1).split("\n");
  const theirs = head.filter(l => l.startsWith("diagnostic ")).map(l => {
    const m = /^diagnostic (\[\d+,\d+\)) (TS\d+) cat=(\d) (".*")$/.exec(l);
    return `${m[1]} ${m[2]} cat=${m[3]} ${JSON.parse(m[4].replace(/\\x([0-9a-f]{2})/g, "\\u00$1").replace(/\\U([0-9a-f]{8})/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\a/g, "\\u0007").replace(/\\v/g, "\\u000b"))}`;
  });
  if (mine.length || theirs.length) withErrors++;
  if (mine.join("\n") === theirs.join("\n")) { same++; continue; }
  diff++;
  const A = new Set(theirs), B = new Set(mine);
  const onlyGo = theirs.filter(x => !B.has(x)), onlyTs = mine.filter(x => !A.has(x));
  const code = x => / (TS\d+) /.exec(x)[1];
  const k = `onlyGo=${[...new Set(onlyGo.map(code))].slice(0, 3).join(",")} onlyTs=${[...new Set(onlyTs.map(code))].slice(0, 3).join(",")}${onlyGo.length === 0 && onlyTs.length === 0 ? " (order or duplicates)" : ""}`;
  note(k, name);
}
console.log(JSON.stringify({ same, diff, withErrors }));
for (const [k, v] of [...buckets.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 50)) console.log(String(v.length).padStart(5), k, " e.g.", v.slice(0, 2).join(" "));
