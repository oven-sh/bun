// Probe: splits TypeScript's test cases into units (port of ParseTestFilesAndSymlinks) and writes them out.
import fs from "node:fs";
import path from "node:path";
const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const out = "/tmp/tsimp/corpus";
const optionRegex = /^\/{2}\s*@(\w+)\s*:\s*([^\r\n]*)/;
const linkRegex = /^\/{2}\s*@link\s*:\s*([^\r\n]*)\s*->\s*([^\r\n]*)/;
function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}
function decode(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) { const b = Buffer.from(buf.subarray(2)); b.swap16(); return new TextDecoder("utf-16le").decode(b); }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString("utf8");
  return buf.toString("utf8");
}
function split(code, fileName) {
  const units = [];
  const lines = code.split(/\r?\n/);
  let cur = null, name = "";
  const push = () => units.push({ name, content: cur ?? "" });
  for (const line of lines) {
    if (linkRegex.test(line)) continue;
    const m = optionRegex.exec(line);
    if (m) {
      const key = m[1].toLowerCase();
      if (key !== "filename") continue;
      if (name !== "") push();
      cur = null;
      name = m[2].trim();
    } else {
      cur = cur === null || cur.length === 0 ? line : cur + "\n" + line;
      if (cur === null) cur = line;
    }
  }
  if (units.length === 0 && name === "") name = path.basename(fileName);
  push();
  return units;
}
const exts = [".d.ts", ".d.mts", ".d.cts", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const manifest = [];
let idx = 0;
for (const suite of ["conformance", "compiler"]) {
  for (const file of walk(path.join(root, suite))) {
    const code = decode(fs.readFileSync(file));
    const units = split(code, file);
    const ci = idx++;
    let ui = 0;
    for (const u of units) {
      const ext = exts.find(e => u.name.toLowerCase().endsWith(e));
      if (!ext) continue;
      const base = path.basename(u.name).replace(/[^A-Za-z0-9_.\-]/g, "_");
      const vname = `c${String(ci).padStart(5, "0")}u${ui++}_${base}`;
      fs.writeFileSync(path.join(out, vname), u.content);
      manifest.push({ vname, case: path.relative(root, file), unit: u.name, bytes: Buffer.byteLength(u.content) });
    }
  }
}
fs.writeFileSync("/tmp/tsimp/corpus.manifest.json", JSON.stringify(manifest));
const byExt = {};
for (const m of manifest) { const e = exts.find(e => m.vname.toLowerCase().endsWith(e)); byExt[e] = (byExt[e] ?? 0) + 1; }
console.log("cases", idx, "units", manifest.length, byExt, "bytes", manifest.reduce((a, m) => a + m.bytes, 0));
