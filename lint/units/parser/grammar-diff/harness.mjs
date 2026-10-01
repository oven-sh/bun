// Differential harness: what one bun binary does with every input of a corpus.
//
//   <bun under test> harness.mjs <corpus.json> <out.jsonl.gz> [--jobs=N]
//
// The binary that runs this file is the binary under test. The parent starts N workers of the same
// binary. A worker writes the index of the input it is about to read before it reads it, so when the
// binary dies on an input the parent records that input as a crash and starts a worker behind it.
//
// Output, gzip, one JSON value per line:
//   line 1     {"header":1,"version","revision","corpus","count","apis":[...]}
//   line 2...  {"i","src","ctx","t","prod","mut","res":[index into vals, one per api],"vals":[...]}
//              or {"i","src",...,"crash":"<signal or exit code>"}
// A value is ["o", output text] | ["e", [[message, line, column], ...]] | ["s", scan result] | ["i", imports].
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const EXP = { compilerOptions: { experimentalDecorators: true } };
const DECO = { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } };
const DEFINE = { "process.env.NODE_ENV": '"development"' };
// name, method, options of Bun.Transpiler
export const APIS = [
  ["t.ts.plain", "transformSync", { loader: "ts" }],
  ["t.ts.exp", "transformSync", { loader: "ts", tsconfig: EXP }],
  ["t.ts.deco", "transformSync", { loader: "ts", tsconfig: DECO }],
  ["t.tsx.plain", "transformSync", { loader: "tsx" }],
  ["t.tsx.exp", "transformSync", { loader: "tsx", tsconfig: EXP }],
  ["t.tsx.deco", "transformSync", { loader: "tsx", tsconfig: DECO }],
  ["t.ts.deco.keep", "transformSync", { loader: "ts", tsconfig: DECO, deadCodeElimination: false, trimUnusedImports: false }],
  ["t.ts.deco.trim", "transformSync", { loader: "ts", tsconfig: DECO, trimUnusedImports: true }],
  ["t.ts.plain.min", "transformSync", { loader: "ts", minify: { whitespace: true, syntax: true } }],
  ["t.ts.plain.node", "transformSync", { loader: "ts", target: "node" }],
  ["s.ts.plain", "scan", { loader: "ts" }],
  ["s.ts.deco", "scan", { loader: "ts", tsconfig: DECO }],
  ["s.tsx.plain", "scan", { loader: "tsx" }],
  ["i.ts.plain", "scanImports", { loader: "ts" }],
  ["i.tsx.plain", "scanImports", { loader: "tsx" }],
];

export function expand(corpus) {
  const out = [];
  for (const f of corpus.forms) {
    for (const [ctx, template] of Object.entries(corpus.contexts)) {
      out.push({ src: template.replace("%T%", () => f.t), ctx, t: f.t, prod: f.prod, mut: f.mut });
    }
  }
  for (const s of corpus.sources) out.push({ src: s.src, ctx: null, t: null, prod: s.prod, mut: null });
  return out;
}

const errorsOf = e => {
  const list = e && Array.isArray(e.errors) && e.errors.length ? e.errors : [e];
  return list.map(x => [String(x?.message ?? x), x?.position?.line ?? null, x?.position?.column ?? null]);
};

function worker(corpusPath, partPath, shard, shards, start, end) {
  const inputs = expand(JSON.parse(readFileSync(corpusPath, "utf8")));
  const transpilers = APIS.map(([, , options]) => new Bun.Transpiler({ define: DEFINE, ...options }));
  const tag = { transformSync: "o", scan: "s", scanImports: "i" };
  let buffer = "";
  for (let i = start; i < Math.min(end, inputs.length); i++) {
    if (i % shards !== shard) continue;
    writeFileSync(partPath + ".mark", String(i));
    const input = inputs[i];
    const vals = [];
    const keys = new Map();
    const res = [];
    for (let a = 0; a < APIS.length; a++) {
      let value;
      try {
        value = [tag[APIS[a][1]], transpilers[a][APIS[a][1]](input.src)];
      } catch (e) {
        value = ["e", errorsOf(e)];
      }
      const key = JSON.stringify(value);
      let at = keys.get(key);
      if (at === undefined) {
        at = vals.length;
        vals.push(value);
        keys.set(key, at);
      }
      res.push(at);
    }
    buffer += JSON.stringify({ i, ...input, res, vals }) + "\n";
    if (buffer.length > 1 << 16) {
      appendFileSync(partPath, buffer);
      buffer = "";
    }
  }
  appendFileSync(partPath, buffer);
  writeFileSync(partPath + ".mark", "done");
}

const HANG_MS = 120000;
function runWorker(corpusPath, partPath, shard, shards, start, end) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [import.meta.filename, "--worker", corpusPath, partPath, shard, shards, start, end].map(String), {
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1", BUN_NO_CORE_DUMP: "1" },
    });
    let stderr = "";
    let hung = false;
    let seen = "";
    let since = Date.now();
    const watch = setInterval(() => {
      const mark = existsSync(partPath + ".mark") ? readFileSync(partPath + ".mark", "utf8") : "";
      if (mark !== seen) {
        seen = mark;
        since = Date.now();
      } else if (Date.now() - since > HANG_MS) {
        hung = true;
        child.kill("SIGKILL");
      }
    }, 5000);
    child.stderr.on("data", chunk => {
      if (stderr.length < 4000) stderr += chunk;
    });
    child.on("close", (code, signal) => {
      clearInterval(watch);
      resolve({ code, signal: hung ? "hang" : signal, stderr });
    });
  });
}

async function shardLoop(corpusPath, outPath, inputs, shard, shards) {
  const partPath = `${outPath}.part${shard}`;
  rmSync(partPath, { force: true });
  rmSync(partPath + ".mark", { force: true });
  writeFileSync(partPath, "");
  let start = 0;
  let crashes = 0;
  for (;;) {
    const { code, signal, stderr } = await runWorker(corpusPath, partPath, shard, shards, start, inputs.length);
    const mark = existsSync(partPath + ".mark") ? readFileSync(partPath + ".mark", "utf8") : "";
    if (code === 0 && mark === "done") return crashes;
    const at = Number(mark);
    if (!Number.isInteger(at) || mark === "") throw new Error(`worker ${shard} died before its first input: ${code} ${signal}\n${stderr}`);
    // Lines of the dead worker that were still in its buffer are lost: redo them in the next worker.
    const done = new Set(
      readFileSync(partPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map(line => JSON.parse(line).i),
    );
    let first = at;
    for (let i = start; i < at; i++) if (i % shards === shard && !done.has(i)) first = Math.min(first, i);
    if (first < at) {
      const redo = await runRange(corpusPath, partPath, shard, shards, first, at);
      if (!redo) throw new Error(`worker ${shard} died again on inputs that it passed before`);
    }
    appendFileSync(partPath, JSON.stringify({ i: at, ...inputs[at], crash: signal ?? `exit ${code}`, stderr: stderr.slice(0, 600) }) + "\n");
    crashes++;
    start = at + 1;
  }
}

// Reruns [first, at) with one worker per input, so that nothing stays in a buffer.
async function runRange(corpusPath, partPath, shard, shards, first, at) {
  for (let i = first; i < at; i++) {
    if (i % shards !== shard) continue;
    const single = `${partPath}.single`;
    rmSync(single, { force: true });
    writeFileSync(single, "");
    const { code } = await runWorker(corpusPath, single, 0, 1, i, i + 1);
    if (code !== 0) return false;
    const line = readFileSync(single, "utf8").split("\n").filter(Boolean)[0];
    if (line) appendFileSync(partPath, line + "\n");
    rmSync(single, { force: true });
    rmSync(single + ".mark", { force: true });
  }
  return true;
}

if (process.argv[2] === "--worker") {
  const [corpusPath, partPath, shard, shards, start, end] = process.argv.slice(3);
  worker(corpusPath, partPath, Number(shard), Number(shards), Number(start), Number(end));
} else if (import.meta.main) {
  const args = process.argv.slice(2);
  const jobs = Number(args.find(a => a.startsWith("--jobs="))?.slice(7) ?? 8);
  const [corpusPath, outPath] = args.filter(a => !a.startsWith("--"));
  if (!corpusPath || !outPath) {
    console.error("usage: <bun under test> harness.mjs <corpus.json> <out.jsonl.gz> [--jobs=N]");
    process.exit(1);
  }
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
  const inputs = expand(corpus);
  const started = performance.now();
  const crashes = await Promise.all(Array.from({ length: jobs }, (_, shard) => shardLoop(corpusPath, outPath, inputs, shard, jobs)));
  const lines = [];
  for (let shard = 0; shard < jobs; shard++) {
    const partPath = `${outPath}.part${shard}`;
    for (const line of readFileSync(partPath, "utf8").split("\n")) {
      if (line) lines.push([JSON.parse(line).i, line]);
    }
    rmSync(partPath, { force: true });
    rmSync(partPath + ".mark", { force: true });
  }
  lines.sort((a, b) => a[0] - b[0]);
  if (lines.length !== inputs.length) throw new Error(`${lines.length} records for ${inputs.length} inputs`);
  const header = { header: 1, version: Bun.version, revision: Bun.revision, corpus: corpus.name, count: inputs.length, apis: APIS.map(a => a[0]) };
  writeFileSync(outPath, gzipSync(JSON.stringify(header) + "\n" + lines.map(l => l[1]).join("\n") + "\n"));
  const crashed = crashes.reduce((a, b) => a + b, 0);
  console.log(`${outPath}: ${inputs.length} inputs x ${APIS.length} apis, ${crashed} crashes, ${((performance.now() - started) / 1000).toFixed(1)} s, bun ${Bun.version} ${Bun.revision}`);
}
