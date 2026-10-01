// What one bun binary does with every source of a corpus. The binary that runs this file is the binary under test.
//
//   <bun under test> bun-side.mjs <corpus.jsonl> <out.jsonl.gz> [--jobs=N] [--configs=ts,tsD,tsx,tsxD] [--keep-output]
//
// Corpus: JSON lines with "id" and "src". Configurations of Bun.Transpiler (transformSync):
//   ts    loader ts                     tsD   loader ts + experimentalDecorators + emitDecoratorMetadata
//   tsx   loader tsx                    tsxD  loader tsx + experimentalDecorators + emitDecoratorMetadata
//   js    loader js                     jsx   loader jsx
// Output, gzip, one JSON value per line:
//   line 1    {"header":1,"version","revision","execPath","count","configs":[...]}
//   line 2..  {"id","r":[index into v, one per configuration],"v":[value,...]}   or   {"id","crash":"<signal or exit code>"}
// A value is ["o", hash of the output in base 36, length] (with --keep-output: ["o", hash, length, text])
// or ["e", [[message, line, column, offset, length], ...]].
// A worker writes the index of the input it is about to read before it reads it, so when the binary dies on an
// input the parent records that input as a crash and starts a worker behind it.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const DECO = { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } };
const CONFIGS = {
  ts: { loader: "ts" },
  tsD: { loader: "ts", tsconfig: DECO },
  tsx: { loader: "tsx" },
  tsxD: { loader: "tsx", tsconfig: DECO },
  js: { loader: "js" },
  jsx: { loader: "jsx" },
};

const readInputs = path =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(l => {
      const r = JSON.parse(l);
      return { id: r.id, src: r.src };
    });

const errorsOf = e => {
  const list = e && Array.isArray(e.errors) && e.errors.length ? e.errors : [e];
  return list.map(x => {
    const p = x?.position;
    return [String(x?.message ?? x), p?.line ?? null, p?.column ?? null, p?.offset ?? null, p?.length ?? null];
  });
};

function worker(corpusPath, partPath, shard, shards, start, end, names, keep) {
  const inputs = readInputs(corpusPath);
  const transpilers = names.map(n => new Bun.Transpiler(CONFIGS[n]));
  let buffer = "";
  for (let i = start; i < Math.min(end, inputs.length); i++) {
    if (i % shards !== shard) continue;
    writeFileSync(partPath + ".mark", String(i));
    const input = inputs[i];
    const v = [];
    const keys = new Map();
    const r = [];
    for (let a = 0; a < names.length; a++) {
      let value;
      try {
        const out = transpilers[a].transformSync(input.src);
        value = ["o", Bun.hash(out).toString(36), out.length];
        if (keep) value.push(out);
      } catch (e) {
        value = ["e", errorsOf(e)];
      }
      const key = JSON.stringify(value);
      let at = keys.get(key);
      if (at === undefined) {
        at = v.length;
        v.push(value);
        keys.set(key, at);
      }
      r.push(at);
    }
    buffer += JSON.stringify({ i, id: input.id, r, v }) + "\n";
    if (buffer.length > 1 << 16) {
      appendFileSync(partPath, buffer);
      buffer = "";
    }
  }
  appendFileSync(partPath, buffer);
  writeFileSync(partPath + ".mark", "done");
}

const HANG_MS = 180000;
function runWorker(argv, partPath) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [import.meta.filename, "--worker", ...argv].map(String), {
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1", BUN_NO_CORE_DUMP: "1", BUN_ENABLE_CRASH_REPORTING: "0" },
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

async function shardLoop(corpusPath, outPath, inputs, shard, shards, names, keep) {
  const partPath = `${outPath}.part${shard}`;
  rmSync(partPath, { force: true });
  rmSync(partPath + ".mark", { force: true });
  writeFileSync(partPath, "");
  const tail = [names.join(","), keep ? "1" : "0"];
  let start = 0;
  let crashes = 0;
  for (;;) {
    const { code, signal, stderr } = await runWorker([corpusPath, partPath, shard, shards, start, inputs.length, ...tail], partPath);
    const mark = existsSync(partPath + ".mark") ? readFileSync(partPath + ".mark", "utf8") : "";
    if (code === 0 && mark === "done") return crashes;
    const at = Number(mark);
    if (!Number.isInteger(at) || mark === "") throw new Error(`worker ${shard} died before its first input: ${code} ${signal}\n${stderr}`);
    const done = new Set(
      readFileSync(partPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map(line => JSON.parse(line).i),
    );
    // Lines of the dead worker that were still in its buffer are lost: redo them one worker per input.
    for (let i = start; i < at; i++) {
      if (i % shards !== shard || done.has(i)) continue;
      const single = `${partPath}.single`;
      rmSync(single, { force: true });
      writeFileSync(single, "");
      const redo = await runWorker([corpusPath, single, 0, 1, i, i + 1, ...tail], single);
      const line = readFileSync(single, "utf8").split("\n").filter(Boolean)[0];
      if (redo.code !== 0 || !line) appendFileSync(partPath, JSON.stringify({ i, id: inputs[i].id, crash: redo.signal ?? `exit ${redo.code}` }) + "\n");
      else appendFileSync(partPath, line + "\n");
      rmSync(single, { force: true });
      rmSync(single + ".mark", { force: true });
    }
    appendFileSync(partPath, JSON.stringify({ i: at, id: inputs[at].id, crash: signal ?? `exit ${code}`, stderr: stderr.slice(0, 600) }) + "\n");
    crashes++;
    start = at + 1;
  }
}

if (process.argv[2] === "--worker") {
  const [corpusPath, partPath, shard, shards, start, end, names, keep] = process.argv.slice(3);
  worker(corpusPath, partPath, Number(shard), Number(shards), Number(start), Number(end), names.split(","), keep === "1");
} else if (import.meta.main) {
  const args = process.argv.slice(2);
  const jobs = Number(args.find(a => a.startsWith("--jobs="))?.slice(7) ?? 4);
  const names = (args.find(a => a.startsWith("--configs="))?.slice(10) ?? "ts,tsD,tsx,tsxD").split(",");
  const keep = args.includes("--keep-output");
  const [corpusPath, outPath] = args.filter(a => !a.startsWith("--"));
  if (!corpusPath || !outPath || names.some(n => !CONFIGS[n])) {
    console.error("usage: <bun under test> bun-side.mjs <corpus.jsonl> <out.jsonl.gz> [--jobs=N] [--configs=ts,tsD,tsx,tsxD] [--keep-output]");
    process.exit(1);
  }
  const inputs = readInputs(corpusPath);
  const started = performance.now();
  const crashes = await Promise.all(Array.from({ length: jobs }, (_, shard) => shardLoop(corpusPath, outPath, inputs, shard, jobs, names, keep)));
  const lines = [];
  for (let shard = 0; shard < jobs; shard++) {
    const partPath = `${outPath}.part${shard}`;
    for (const line of readFileSync(partPath, "utf8").split("\n")) {
      if (!line) continue;
      const { i, ...rest } = JSON.parse(line);
      lines.push([i, JSON.stringify(rest)]);
    }
    rmSync(partPath, { force: true });
    rmSync(partPath + ".mark", { force: true });
  }
  lines.sort((a, b) => a[0] - b[0]);
  if (lines.length !== inputs.length) throw new Error(`${lines.length} records for ${inputs.length} inputs`);
  const header = { header: 1, version: Bun.version, revision: Bun.revision, execPath: process.execPath, count: inputs.length, configs: names };
  writeFileSync(outPath, gzipSync(JSON.stringify(header) + "\n" + lines.map(l => l[1]).join("\n") + "\n"));
  const total = crashes.reduce((a, b) => a + b, 0);
  console.log(`${Bun.version} ${Bun.revision.slice(0, 9)}: ${inputs.length} inputs, ${names.length} configurations, ${total} crashes, ${Math.round(performance.now() - started)} ms`);
}
