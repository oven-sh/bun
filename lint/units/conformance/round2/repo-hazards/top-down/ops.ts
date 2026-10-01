// usage: <bun> ops.ts <file with one path per line>
// Times single operations of the runner's rule over every path, to see what a debug build pays for.
import { readFileSync } from "node:fs";
import { basename, dirname, sep } from "node:path";

const paths = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean).map(p => p.slice("test/".length));
const time = (label: string, f: () => unknown) => {
  const t = performance.now();
  const r = f();
  console.log(`${(performance.now() - t).toFixed(0).padStart(7)} ms  ${label}  -> ${r}`);
};
let n = 0;
time("empty loop with a closure call", () => { n = 0; for (const p of paths) n += (q => q.length)(p) > 0 ? 1 : 0; return n; });
time("basename(p)", () => { n = 0; for (const p of paths) n += basename(p).length > 0 ? 1 : 0; return n; });
time("dirname(p)", () => { n = 0; for (const p of paths) n += dirname(p).length > 0 ? 1 : 0; return n; });
time("p.slice(p.lastIndexOf('/') + 1)", () => { n = 0; for (const p of paths) n += p.slice(p.lastIndexOf("/") + 1).length > 0 ? 1 : 0; return n; });
time("/\\.(c|m)?(j|t)sx?$/.test(p)", () => { n = 0; for (const p of paths) n += /\.(c|m)?(j|t)sx?$/.test(p) ? 1 : 0; return n; });
time("/\\.test|spec\\./.test(p)", () => { n = 0; for (const p of paths) n += /\.test|spec\./.test(p) ? 1 : 0; return n; });
time("p.replaceAll(sep, '/')", () => { n = 0; for (const p of paths) n += p.replaceAll(sep, "/").length > 0 ? 1 : 0; return n; });
time("p.includes('js/node/test/parallel/')", () => { n = 0; for (const p of paths) n += p.includes("js/node/test/parallel/") ? 1 : 0; return n; });
time("p.endsWith('.ts')", () => { n = 0; for (const p of paths) n += p.endsWith(".ts") ? 1 : 0; return n; });
const text = "\n" + paths.join("\n") + "\n";
time("text.includes x4", () => ["js/node/test/parallel/", "js/node/test/sequential/", "js/bun/test/parallel/", "js/node/cluster/test-"].filter(m => text.includes(m)).length);
time("one regex: base names with .test or spec.", () => (text.match(/^.*(?:\.test|spec\.)[^/\n]*$/gm) ?? []).length);
time("one regex: javascript names", () => (text.match(/^.*\.(?:c|m)?(?:j|t)sx?$/gm) ?? []).length);
time("one regex: hidden", () => (text.match(/^(?:.*(?:node_modules|node.js).*\/[^/\n]*|(?:.*\/)?\.[^/\n]*)$/gm) ?? []).length);
time("split into lines again", () => text.split("\n").length);
