// Probe: compares the file-level data that a dump can carry with typescript-go's.
import fs from "node:fs";
import path from "node:path";
import { dumpFiles } from "./dump-ast.ts";
import { importDump, quoteToASCII } from "./convert.mjs";
const manifest = JSON.parse(fs.readFileSync("/tmp/tsimp/corpus.manifest.json", "utf8"));
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const stats = {};
const ex = {};
function cmp(name, a, b, vname) {
  stats[name] ??= { same: 0, differ: 0, nonEmpty: 0 };
  if (a.length || b.length) stats[name].nonEmpty++;
  if (a.join("\n") === b.join("\n")) stats[name].same++;
  else { stats[name].differ++; (ex[name] ??= []).push({ vname, go: a.slice(0, 3), ts: b.slice(0, 3) }); }
}
const ref = g => (g ? `Kind${g.kind}[${g.pos},${g.end})` : "<nil>");
let n = 0;
for (const m of manifest) {
  if (filter && !filter.test(m.vname)) continue;
  n++;
  const raw = fs.readFileSync(path.join("/tmp/tsimp/corpus", m.vname), "utf8");
  const bundle = JSON.parse(JSON.stringify(dumpFiles([{ name: "/" + m.vname, text: raw }])));
  const d = bundle.files[0];
  const root = importDump(bundle);
  const go = fs.readFileSync(path.join("/tmp/tsimp/go-out", m.vname + ".tsgo.txt"), "utf8").split("\n");
  const pick = p => go.filter(l => l.startsWith(p));
  cmp("file", pick("file "), [`file /${m.vname} scriptKind=${d.scriptKind} variant=${d.languageVariant} dts=${d.isDeclarationFile} textLen=${d.textLen}`], m.vname);
  cmp("externalModuleIndicator", pick("externalModuleIndicator"), [`externalModuleIndicator ${ref(root.externalModuleIndicator)}`], m.vname);
  const fr = (label, arr) => arr.map(r => `${label} [${r[0]},${r[1]}) ${quoteToASCII(r[2])} mode=${r[3]} preserve=${r[4] ? "true" : "false"}`);
  cmp("referencedFile", pick("referencedFile "), fr("referencedFile", d.referencedFiles), m.vname);
  cmp("typeReference", pick("typeReference "), fr("typeReference", d.typeReferenceDirectives), m.vname);
  cmp("libReference", pick("libReference "), fr("libReference", d.libReferenceDirectives), m.vname);
  cmp("checkJs", pick("checkJs "), d.checkJs ? [`checkJs enabled=${d.checkJs[0] ? "true" : "false"} [${d.checkJs[1]},${d.checkJs[2]})`] : [], m.vname);
  cmp("commentDirective", pick("commentDirective "), d.commentDirectives.map(c => `commentDirective [${c[0]},${c[1]}) kind=${c[2] + 1}`), m.vname);
  const goDiag = pick("diagnostic ");
  const tsDiag = d.diagnostics.map(x => `diagnostic [${x[0]},${x[0] + x[1]}) TS${x[2]} cat=${x[3] === 1 ? 1 : x[3] === 0 ? 0 : x[3]} ${quoteToASCII(x[4])}`);
  cmp("diagnostics(all fields)", goDiag, tsDiag, m.vname);
  cmp("diagnostics(code+pos)", goDiag.map(l => l.split(" ").slice(0, 3).join(" ")), tsDiag.map(l => l.split(" ").slice(0, 3).join(" ")), m.vname);
  cmp("diagnostics(count)", [String(goDiag.length)], [String(tsDiag.length)], m.vname);
}
console.log("units", n);
for (const [k, v] of Object.entries(stats)) console.log(k.padEnd(28), JSON.stringify(v));
for (const [k, v] of Object.entries(ex)) { console.log("== " + k); for (const e of v.slice(0, Number(process.env.EX ?? 4))) console.log("  ", e.vname, "\n      GO", JSON.stringify(e.go).slice(0, 300), "\n      TS", JSON.stringify(e.ts).slice(0, 300)); }
fs.writeFileSync("/tmp/tsimp/head-examples.json", JSON.stringify(ex, null, 1));
