// Probe: one line of digests per unit, from the dumps of typescript-go's own tree (made once, while Go was at hand).
// digest = FNV-1a 64 over the bytes of the named lines, each line followed by "\n".
import fs from "node:fs";
import path from "node:path";
const [goOut, corpus, manifestFile, outFile] = process.argv.slice(2);
const HEADER = /^(file |externalModuleIndicator|commonJSModuleIndicator|usesUriStyleNodeCoreModules|counts |import |moduleAugmentation|ambientModuleName|pragma |referencedFile|typeReference|libReference|checkJs|commentDirective|diagnostic |jsDiagnostic |jsdocDiagnostic )/;
function fnv1a64(lines: string[]): string {
  let h = 0xcbf29ce484222325n;
  const buf = Buffer.from(lines.map(l => l + "\n").join(""), "utf8");
  for (let i = 0; i < buf.length; i++) {
    h ^= BigInt(buf[i]);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}
function fnvBytes(buf: Buffer): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < buf.length; i++) {
    h ^= BigInt(buf[i]);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}
function stripJsdoc(lines: string[]) {
  const out: string[] = [];
  let skip = -1;
  for (const l of lines) {
    const ind = l.length - l.trimStart().length;
    if (skip >= 0) { if (ind > skip) continue; skip = -1; }
    if (l.trimStart().startsWith(".jsdoc:")) { skip = ind; continue; }
    out.push(l);
  }
  return out;
}
const manifest: { vname: string; case?: string; unit?: string }[] = manifestFile === "-"
  ? fs.readdirSync(corpus).sort().map(f => ({ vname: f, case: "", unit: f }))
  : JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const rows = ["# case\tunit index\tunit name\tsource bytes\tsource\ttree without jsdoc\ttree\tfile data\tdiagnostics\tjs diagnostics\tnodes without jsdoc\tparse errors\tjsdoc hosts"];
const caseIndex = new Map<string, number>();
for (const m of manifest) {
  const all = fs.readFileSync(path.join(goOut, m.vname + ".tsgo.txt"), "utf8").split("\n").filter(l => l.length);
  const src = fs.readFileSync(path.join(corpus, m.vname));
  const text = src.length >= 3 && src[0] === 0xef && src[1] === 0xbb && src[2] === 0xbf ? src.subarray(3) : src;
  const tree = all.filter(l => !HEADER.test(l));
  const noJsdoc = stripJsdoc(tree);
  const fileData = all.filter(l => /^(externalModuleIndicator|usesUriStyleNodeCoreModules|import |moduleAugmentation|ambientModuleName|pragma |referencedFile|typeReference|libReference|checkJs|commentDirective)/.test(l));
  const diag = all.filter(l => l.startsWith("diagnostic "));
  const jsdiag = all.filter(l => l.startsWith("jsDiagnostic ") || l.startsWith("jsdocDiagnostic "));
  const key = m.case ?? "";
  const ui = caseIndex.get(key) ?? 0;
  caseIndex.set(key, ui + 1);
  rows.push([m.case ?? "", ui, m.unit ?? m.vname, text.length, fnvBytes(text), fnv1a64(noJsdoc), fnv1a64(tree), fnv1a64(fileData), fnv1a64(diag), fnv1a64(jsdiag),
    noJsdoc.filter(l => / Kind\w+ \[/.test(l)).length, diag.length, tree.filter(l => l.trimStart().startsWith(".jsdoc:")).length].join("\t"));
}
fs.writeFileSync(outFile, rows.join("\n") + "\n");
console.log(outFile, rows.length - 1, "rows", fs.statSync(outFile).size, "bytes");
