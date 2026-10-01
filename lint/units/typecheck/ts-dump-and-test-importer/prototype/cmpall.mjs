// usage: node cmpall.mjs <outdir> <list-file> [--write]
import fs from "node:fs";
import { rawDump, serialize } from "./rawdump.mjs";
import { toGo, print, Stats } from "./togo.mjs";
const [outdir, listFile, ...flags] = process.argv.slice(2);
const write = flags.includes("--write");
const stats = new Stats();
let same = 0, diff = 0, failed = 0;
const buckets = new Map();
const diffFiles = [];
let rawBytes = 0, srcBytes = 0, nodeTotal = 0;
const strip = l => l.replace(/\[\d+,\d+\)/g, "[]").replace(/f=0x[0-9a-f]+/, "f=").replace(/Text="[^"]*"/g, 'Text=""').replace(/^\s+/, "");
for (const a of fs.readFileSync(listFile, "utf8").split("\n")) {
  if (!a) continue;
  const eq = a.indexOf("=");
  const name = a.slice(0, eq), path = a.slice(eq + 1);
  let text = fs.readFileSync(path, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let mine;
  try {
    const d = rawDump("/" + name, text);
    const ser = serialize(d);
    rawBytes += ser.length; srcBytes += text.length; nodeTotal += d.header.nodeCount;
    const parsed = JSON.parse(ser); parsed.header = parsed;
    const g = toGo(parsed, text, stats, { noJSDocFlags: false });
    mine = print(g, []).join("\n") + "\n";
  } catch (e) {
    failed++;
    const k = "EXC " + String(e.message).slice(0, 80);
    buckets.set(k, [...(buckets.get(k) ?? []), name]);
    continue;
  }
  const base = `${outdir}/${name.replaceAll("/", "__")}`;
  if (write) fs.writeFileSync(`${base}.ts.txt`, mine);
  const theirsAll = fs.readFileSync(`${base}.tsgo.txt`, "utf8");
  const at = theirsAll.indexOf("\nroot ");
  const theirs = theirsAll.slice(at + 1).split("\n").filter(l => !l.startsWith("jsdocDiagnostic ")).join("\n");
  if (mine === theirs) { same++; continue; }
  diff++;
  const A = theirs.split("\n"), B = mine.split("\n");
  let i = 0;
  while (i < A.length && i < B.length && A[i] === B[i]) i++;
  const hasErr = /\ndiagnostic /.test(theirsAll.slice(0, at + 1));
  const sa = strip(A[i] ?? "<eof>"), sb = strip(B[i] ?? "<eof>");
  const k = (hasErr ? "E " : "  ") + (sa === sb ? "POS/FLAGS/TEXT " + sa : `go: ${sa}  ||  ts: ${sb}`);
  buckets.set(k, [...(buckets.get(k) ?? []), `${name}:${i + 1}`]);
  diffFiles.push(name);
}
console.log(JSON.stringify({ same, diff, failed, rawBytes, srcBytes, nodeTotal }));
const top = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [k, v] of top.slice(0, Number(process.env.TOP ?? 70))) console.log(String(v.length).padStart(5), k, "  e.g.", v.slice(0, 2).join(" "));
console.log("--- unmapped properties");
for (const [k, v] of [...stats.unmapped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80)) console.log(String(v).padStart(7), k);
fs.writeFileSync("/tmp/tsdump/diff-files.txt", diffFiles.join("\n") + "\n");
