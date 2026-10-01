// The TypeScript files of the worktree under test/ and src/js as input of the probes, and what tsc says about each.
//   node realfiles.cjs <worktree> <out.hex> <out.go.jsonl> <out.tsc.jsonl>
// A file is read as its extension says: .tsx as tsx, .d.ts / .d.mts / .d.cts as dts, the others as ts. A byte order mark is dropped, as `bun --lint` drops it.
const fs = require("fs");
const cp = require("child_process");
const path = require("path");
const ts = require(process.env.ORACLE_TYPESCRIPT ?? "/workspace/wt/parser/node_modules/typescript/lib/typescript.js");
const [root, hexPath, goPath, tscPath] = process.argv.slice(2);
const files = cp.execFileSync("git", ["-C", root, "ls-files", "-z", "test", "src/js"], { maxBuffer: 1 << 28 }).toString("utf8").split("\0").filter(f => /\.(ts|tsx|mts|cts)$/.test(f));
const hex = fs.createWriteStream(hexPath), go = fs.createWriteStream(goPath), tsc = fs.createWriteStream(tscPath);
let n = 0, bytes = 0, skipped = 0;
for (const f of files) {
  let buf;
  try { buf = fs.readFileSync(path.join(root, f)); } catch { skipped++; continue; }
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3);
  const src = buf.toString("utf8");
  if (Buffer.compare(Buffer.from(src, "utf8"), buf) !== 0) { skipped++; continue; }
  const kind = /\.d\.(ts|mts|cts)$/.test(f) ? "dts" : f.endsWith(".tsx") ? "tsx" : "ts";
  const name = kind === "dts" ? "input.d.ts" : kind === "tsx" ? "input.tsx" : "input.ts";
  hex.write(`${n} ${kind} ${buf.toString("hex")}\n`);
  go.write(JSON.stringify({ id: n, name, src }) + "\n");
  const diags = ts.createSourceFile("/" + name, src, ts.ScriptTarget.ESNext, false, kind === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS).parseDiagnostics;
  tsc.write(JSON.stringify({ id: n, file: f, kind, bytes: buf.length, tsc: diags.slice(0, 3).map(d => [d.code, Buffer.byteLength(src.slice(0, d.start), "utf8"), d.length, ts.flattenDiagnosticMessageText(d.messageText, " ")]) }) + "\n");
  n++; bytes += buf.length;
}
hex.end(); go.end(); tsc.end(() => console.log(n, "files", bytes, "bytes", skipped, "skipped (unreadable or not UTF-8)"));
