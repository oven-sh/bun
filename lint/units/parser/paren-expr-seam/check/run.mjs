// usage: [BUN_LINT_SEAM_OUT=<dump>] <bun binary> run.mjs <corpus.json> <out.jsonl>
// One line per file: path, sha1 of the transpiled text or the first error, and (with the dump) the records of that parse.
import { readFileSync, writeFileSync, statSync, openSync, readSync, closeSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
const root = "/workspace/wt/parser/";
const files = JSON.parse(readFileSync(process.argv[2], "utf8"));
const dump = process.env.BUN_LINT_SEAM_OUT;
const transpilers = { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }) };
const out = [];
let offset = dump && existsSync(dump) ? statSync(dump).size : 0;
for (const path of files) {
  const text = readFileSync(root + path, "utf8");
  const rec = { path };
  try { rec.sha = createHash("sha1").update(transpilers[path.endsWith(".tsx") ? "tsx" : "ts"].transformSync(text)).digest("hex"); }
  catch (e) { rec.err = String(e.errors?.[0]?.message ?? e.message).split("\n")[0]; }
  if (dump) {
    const size = existsSync(dump) ? statSync(dump).size : 0;
    if (size > offset) {
      const fd = openSync(dump, "r"); const buf = Buffer.alloc(size - offset); readSync(fd, buf, 0, size - offset, offset); closeSync(fd);
      rec.dump = buf.toString("utf8").trim().split("\n");
    } else rec.dump = [];
    offset = size;
  }
  out.push(JSON.stringify(rec));
}
writeFileSync(process.argv[3], out.join("\n") + "\n");
console.log(files.length, "files");
