// Probe: time and size of the dump. usage: bun measure.ts <list of files> [bundle|single] [out dir]
import fs from "node:fs";
import path from "node:path";
const t0 = performance.now();
const { dumpFiles } = await import("./dump-ast.ts");
const tLoad = performance.now() - t0;
const [listFile, mode = "bundle", outDir] = process.argv.slice(2);
const files = fs.readFileSync(listFile, "utf8").split("\n").filter(Boolean);
const groups = new Map<string, string[]>();
for (const f of files) {
  const base = path.basename(f);
  const key = mode === "single" ? base : mode === "bundle" ? "all" : (/^c\d+/.exec(base)?.[0] ?? base);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key)!.push(f);
}
let src = 0, json = 0, jsonNoText = 0, nodes = 0, tDump = 0, tStr = 0;
for (const [key, list] of groups) {
  const inputs = list.map(f => ({ name: "/" + path.basename(f), text: fs.readFileSync(f, "utf8") }));
  for (const i of inputs) src += Buffer.byteLength(i.text);
  let t = performance.now();
  const d = dumpFiles(inputs);
  tDump += performance.now() - t; t = performance.now();
  const s = JSON.stringify(d);
  tStr += performance.now() - t;
  json += Buffer.byteLength(s);
  for (const f of d.files) { nodes += f.nodes.length / 8; jsonNoText -= Buffer.byteLength(JSON.stringify(f.text)); }
  if (outDir) fs.writeFileSync(path.join(outDir, key + ".ast.json"), s);
}
jsonNoText += json;
console.log(JSON.stringify({ mode, files: files.length, bundles: groups.size, srcBytes: src, jsonBytes: json, jsonBytesWithoutText: jsonNoText, nodes,
  ms: { loadTypeScript: Math.round(tLoad), parseAndDump: Math.round(tDump), stringify: Math.round(tStr), total: Math.round(performance.now() - t0) } }));
