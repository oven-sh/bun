import fs from "node:fs";
import { ts } from "./dump-ast.mjs";
import { makePositionMap } from "./convert.mjs";
const [outdir, listFile] = process.argv.slice(2);
let same = 0, diff = 0, withRelated = 0; const ex = [];
for (const a of fs.readFileSync(listFile, "utf8").split("\n")) {
  if (!a) continue;
  const eq = a.indexOf("=");
  const name = a.slice(0, eq), path = a.slice(eq + 1);
  const text = fs.readFileSync(path, "utf8");
  const sf = ts.createSourceFile("/" + name, text, { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone }, false);
  const u8 = makePositionMap(text);
  const mine = [];
  for (const d of sf.parseDiagnostics) for (const r of d.relatedInformation ?? []) mine.push(`[${u8(r.start)},${u8(r.start + r.length)}) TS${r.code} cat=${r.category} ${JSON.stringify(ts.flattenDiagnosticMessageText(r.messageText, "\n"))}`);
  const head = fs.readFileSync(`${outdir}/${name}.tsgo.txt`, "utf8").split("\nroot ")[0].split("\n");
  const theirs = head.filter(l => l.startsWith("diagnostic.related ")).map(l => l.slice("diagnostic.related ".length));
  if (mine.length || theirs.length) withRelated++;
  if (mine.join("\n") === theirs.join("\n")) same++; else { diff++; if (ex.length < 4) ex.push([name, theirs, mine]); }
}
console.log(JSON.stringify({ same, diff, withRelated }));
for (const e of ex) console.log(JSON.stringify(e));
