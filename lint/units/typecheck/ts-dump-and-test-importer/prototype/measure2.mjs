// Research probe: load time of typescript.js, dump time and dump size for the lib closure and for 200 cases.
import fs from "node:fs";
import path from "node:path";
const t0 = process.cpuUsage();
const w0 = performance.now();
const { ts, dump } = await import("./dump-ast.mjs"); const CHECK = process.env.CHECK !== "0";
const t1 = process.cpuUsage(t0);
const w1 = performance.now();
const cpu = u => ((u.user + u.system) / 1e6).toFixed(2) + "s";
console.log(`runtime=${process.versions.bun ? "bun " + process.versions.bun : "node " + process.versions.node} load typescript ${ts.version}: cpu ${cpu(t1)} wall ${((w1 - w0) / 1000).toFixed(2)}s`);

function closure(libDir, root) {
  const seen = new Set(), order = [];
  (function add(name) {
    if (seen.has(name)) return;
    seen.add(name);
    const p = path.join(libDir, name);
    if (!fs.existsSync(p)) { console.log("missing lib", name); return; }
    const text = fs.readFileSync(p, "utf8");
    for (const m of text.matchAll(/^\/\/\/\s*<reference\s+lib="([^"]+)"\s*\/>/gm)) add(`lib.${m[1]}.d.ts`);
    order.push(p);
  })(root);
  return order;
}
function run(label, files, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const c0 = process.cpuUsage(), s0 = performance.now();
  let src = 0, out = 0, nodes = 0, parseCpu = 0;
  for (const [name, p] of files) {
    let text = fs.readFileSync(p, "utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const d = dump("/" + name, text, undefined, CHECK);
    const s = d.text;
    fs.writeFileSync(path.join(outDir, name.replaceAll("/", "__") + ".ast.json"), s);
    src += Buffer.byteLength(text); out += Buffer.byteLength(s); nodes += d.header.nodeCount;
  }
  const c1 = process.cpuUsage(c0), s1 = performance.now();
  console.log(`${label}: files ${files.length} source ${(src / 1e6).toFixed(2)}MB nodes ${nodes} dump ${(out / 1e6).toFixed(2)}MB (${(out / src).toFixed(1)}x source, ${(out / nodes).toFixed(1)} bytes per node) cpu ${cpu(c1)} wall ${((s1 - s0) / 1000).toFixed(2)}s`);
}
const mode = process.argv[2];
const outRoot = process.argv[3] ?? "/tmp/tsdump/measure-out";
if (mode === "libs" || mode === "all") {
  const libDir = "/workspace/ref/typescript-go/internal/bundled/libs";
  for (const root of ["lib.es5.d.ts", "lib.d.ts", "lib.esnext.full.d.ts"]) {
    const files = closure(libDir, root).map(p => [path.basename(p), p]);
    run(`lib closure of ${root}`, files, path.join(outRoot, "libs-" + root));
  }
}
if (mode === "cases" || mode === "all") {
  const lines = fs.readFileSync("/tmp/tsdump/corpus.list", "utf8").split("\n").filter(l => l && !l.startsWith("#"));
  const byCase = new Map();
  for (const l of lines) {
    const [nv] = l.split("\t");
    const eq = nv.indexOf("=");
    const name = nv.slice(0, eq), p = nv.slice(eq + 1);
    const c = name.slice(0, name.indexOf("_"));
    if (!byCase.has(c)) byCase.set(c, []);
    byCase.get(c).push([name, p]);
  }
  const cases = [...byCase.values()];
  const step = Math.floor(cases.length / 200);
  const picked = [];
  for (let i = 0; i < cases.length && picked.length < 200; i += step) picked.push(cases[i]);
  run(`200 cases (every ${step}th)`, picked.flat(), path.join(outRoot, "cases"));
}
