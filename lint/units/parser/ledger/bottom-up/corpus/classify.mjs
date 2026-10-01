// One classifier for the merged corpus: the bun binary that runs this file, tsc 6.0.2 and typescript-go.
//
// usage (the binary that runs the file is the binary under test; use the BASE build, not the installed bun):
//   <bun> classify.mjs stage1 <corpus.jsonl> <work dir> [--jobs N] [--tsgo <parsediag binary>] [--only bun]
//         --only bun: the bun side alone. Use it with a debug build (tsc under a debug build is about 100 times
//         slower) and compare with the saved table of the base: progress.mjs.
//   <bun> classify.mjs stage2 <corpus.jsonl> <work dir> [--jobs N]
//   then: bun report.mjs <corpus.jsonl> <work dir> <out dir>
//
// stage1, per row i (files <work dir>/bun.<shard>.jsonl, tsc.<shard>.jsonl, go.jsonl):
//   bun  {"i", "b": [ts, tsx, deco]}       each 1, or [first message, line, column, number of errors]
//                                          ts / tsx: Bun.Transpiler({loader}).transformSync, no tsconfig
//                                          deco: loader ts with experimentalDecorators + emitDecoratorMetadata
//   tsc  {"i", "t": {ts, tsx, dts}}        each [count, first message, [code, start, length], ... up to 6]
//                                          createSourceFile("/input.ts" | "/input.tsx" | "/input.d.ts").parseDiagnostics
//   go   {"i", "g": {ts, tsx, dts}}        the same shape from the parser of typescript-go (UTF-16 offsets), or
//                                          ["panic", text] / ["crash", text]
// stage2, only for rows of set A in some view (the bun side rejects, tsc parses without a diagnostic):
//   <work dir>/s2.<shard>.jsonl  {"i", "v": {<view>: {"c": [[code, start, length], ...], "m": {code: message},
//                                 "js": 1 | [message] | null, "threw"?}}}
//   views: ts (bun ts against input.ts), tsx (bun tsx against input.tsx), deco (bun deco against input.ts checked
//   with experimentalDecorators), dts (bun ts against input.d.ts).
//   "c": every diagnostic of a one-file program (getSyntacticDiagnostics + getSemanticDiagnostics, noLib).
//   "js": does the JavaScript that ts.transpileModule prints for the row parse with the js loader of the bun side
//   (jsx loader for the tsx view; null when transpileModule threw).
//
// A worker writes one line per row with a single write. When a worker dies, the parent finds the row behind the
// last line, records it as {"i", "crash": ...} and starts a worker behind it.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TS_PATH = process.env.PROBE_TYPESCRIPT ?? "/workspace/bun/node_modules/typescript/lib/typescript.js";
const SELF = fileURLToPath(import.meta.url);
const DECO = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });

const readCorpus = path =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(l => JSON.parse(l));

const lastLine = path => {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8").trimEnd();
  if (!text) return null;
  return JSON.parse(text.slice(text.lastIndexOf("\n") + 1));
};

const errOf = e => {
  const list = e && Array.isArray(e.errors) && e.errors.length ? e.errors : [e];
  const x = list[0];
  return [String(x?.message ?? x), x?.position?.line ?? null, x?.position?.column ?? null, list.length];
};

// ───────────────────────────── workers ─────────────────────────────

function bunWorker(rows, fd) {
  const t = [new Bun.Transpiler({ loader: "ts" }), new Bun.Transpiler({ loader: "tsx" }), new Bun.Transpiler({ loader: "ts", tsconfig: DECO })];
  for (const row of rows) {
    const b = t.map(x => {
      try {
        x.transformSync(row.src);
        return 1;
      } catch (e) {
        return errOf(e);
      }
    });
    writeSync(fd, JSON.stringify({ i: row.i, b }) + "\n");
  }
}

const DIALECT_FILES = { ts: "/input.ts", tsx: "/input.tsx", dts: "/input.d.ts" };

async function tscWorker(rows, fd) {
  const ts = (await import(TS_PATH)).default;
  const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, dts: ts.ScriptKind.TS };
  for (const row of rows) {
    const t = {};
    for (const d of ["ts", "tsx", "dts"]) {
      try {
        const pd = ts.createSourceFile(DIALECT_FILES[d], row.src, ts.ScriptTarget.ESNext, false, kinds[d]).parseDiagnostics;
        t[d] = [pd.length, pd.length ? ts.flattenDiagnosticMessageText(pd[0].messageText, " ") : "", ...pd.slice(0, 6).map(x => [x.code, x.start, x.length])];
      } catch (e) {
        t[d] = ["threw", String(e?.message ?? e).slice(0, 120)];
      }
    }
    writeSync(fd, JSON.stringify({ i: row.i, t }) + "\n");
  }
}

const VIEWS = {
  ts: { bun: 0, dialect: "ts", deco: false, jsLoader: "js" },
  tsx: { bun: 1, dialect: "tsx", deco: false, jsLoader: "jsx" },
  deco: { bun: 2, dialect: "ts", deco: true, jsLoader: "js" },
  dts: { bun: 0, dialect: "dts", deco: false, jsLoader: null },
};

async function stage2Worker(rows, fd, work) {
  const ts = (await import(TS_PATH)).default;
  const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, dts: ts.ScriptKind.TS };
  const js = { js: new Bun.Transpiler({ loader: "js" }), jsx: new Bun.Transpiler({ loader: "jsx" }) };
  const program = (src, dialect, deco) => {
    const fileName = DIALECT_FILES[dialect];
    const options = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.Preserve,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noLib: true,
      noResolve: true,
      types: [],
      jsx: ts.JsxEmit.Preserve,
      noEmit: true,
      experimentalDecorators: deco,
      emitDecoratorMetadata: deco,
    };
    const host = {
      getSourceFile: (name, o) => (name === fileName ? ts.createSourceFile(name, src, o, true, kinds[dialect]) : undefined),
      getDefaultLibFileName: () => "/lib.d.ts",
      writeFile() {},
      getCurrentDirectory: () => "/",
      getCanonicalFileName: f => f,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => "\n",
      fileExists: f => f === fileName,
      readFile: f => (f === fileName ? src : undefined),
      directoryExists: () => true,
      getDirectories: () => [],
    };
    const p = ts.createProgram({ rootNames: [fileName], options, host });
    const sf = p.getSourceFile(fileName);
    return [...p.getSyntacticDiagnostics(sf), ...p.getSemanticDiagnostics(sf)];
  };
  for (const row of rows) {
    const v = {};
    for (const view of row.views) {
      const spec = VIEWS[view];
      const one = { c: [], m: {} };
      try {
        for (const d of program(row.src, spec.dialect, spec.deco)) {
          one.c.push([d.code, d.start ?? -1, d.length ?? 0]);
          one.m[d.code] ??= ts.flattenDiagnosticMessageText(d.messageText, " ").slice(0, 160);
        }
      } catch (e) {
        one.threw = String(e?.message ?? e).slice(0, 160);
      }
      if (spec.jsLoader) {
        let text = null;
        try {
          text = ts.transpileModule(row.src, {
            fileName: DIALECT_FILES[spec.dialect].slice(1),
            reportDiagnostics: false,
            compilerOptions: {
              target: ts.ScriptTarget.ESNext,
              module: ts.ModuleKind.ESNext,
              jsx: ts.JsxEmit.Preserve,
              useDefineForClassFields: false,
              noEmitHelpers: true,
              experimentalDecorators: spec.deco,
              emitDecoratorMetadata: spec.deco,
            },
          }).outputText;
        } catch (e) {
          one.emitThrew = String(e?.message ?? e).slice(0, 160);
        }
        if (text === null) one.js = null;
        else {
          try {
            js[spec.jsLoader].transformSync(text);
            one.js = 1;
          } catch (e) {
            one.js = [errOf(e)[0]];
          }
        }
      }
      v[view] = one;
    }
    writeSync(fd, JSON.stringify({ i: row.i, v }) + "\n");
  }
}

async function worker(mode, corpusPath, work, shard, jobs, start) {
  let rows = readCorpus(corpusPath).filter(r => r.i % jobs === shard && r.i >= start);
  const fd = openSync(join(work, `${mode}.${shard}.jsonl`), "a");
  if (mode === "bun") bunWorker(rows, fd);
  else if (mode === "tsc") await tscWorker(rows, fd);
  else if (mode === "s2") {
    const todo = JSON.parse(readFileSync(join(work, "s2.todo.json"), "utf8"));
    rows = rows.filter(r => todo[r.i]).map(r => ({ ...r, views: todo[r.i] }));
    await stage2Worker(rows, fd, work);
  }
  writeSync(fd, JSON.stringify({ done: 1 }) + "\n");
  closeSync(fd);
}

// ───────────────────────────── parent ─────────────────────────────

async function runShard(mode, corpusPath, work, shard, jobs, indexes) {
  const out = join(work, `${mode}.${shard}.jsonl`);
  writeFileSync(out, "");
  let start = 0;
  let crashes = 0;
  for (;;) {
    const proc = Bun.spawn({
      cmd: [process.execPath, SELF, "--worker", mode, corpusPath, work, String(shard), String(jobs), String(start)],
      stdout: "inherit",
      stderr: "pipe",
      // Without BUN_ENABLE_CRASH_REPORTING=0 a worker that crashes tries to upload a report to bun.report.
      env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1", BUN_ENABLE_CRASH_REPORTING: "0" },
    });
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;
    const last = lastLine(out);
    if (last?.done) break;
    const lastI = last ? last.i : start - 1;
    const crashI = indexes.find(i => i > lastI && i >= start);
    if (crashI === undefined) break;
    crashes++;
    const fd = openSync(out, "a");
    writeSync(fd, JSON.stringify({ i: crashI, crash: { exitCode: proc.exitCode, signal: proc.signalCode ?? null, stderr: stderr.slice(-400) } }) + "\n");
    closeSync(fd);
    start = crashI + 1;
  }
  return crashes;
}

async function runGo(corpus, work, tsgo) {
  const out = join(work, "go.jsonl");
  writeFileSync(out, "");
  const names = { ts: "input.ts", tsx: "input.tsx", dts: "input.d.ts" };
  const dialects = ["ts", "tsx", "dts"];
  const total = corpus.length * 3;
  // task k: row floor(k / 3), dialect k % 3
  const got = new Array(total).fill(null);
  let k = 0;
  while (k < total) {
    const inPath = join(work, "go.in.jsonl");
    const parts = [];
    for (let j = k; j < total; j++) parts.push(JSON.stringify({ id: j, name: names[dialects[j % 3]], src: corpus[Math.floor(j / 3)].src }));
    writeFileSync(inPath, parts.join("\n") + "\n");
    const proc = Bun.spawn({ cmd: [tsgo], stdin: Bun.file(inPath), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    await proc.exited;
    let seen = k - 1;
    for (const line of stdout.split("\n")) {
      if (!line) continue;
      let r;
      try {
        r = JSON.parse(line);
      } catch {
        continue;
      }
      seen = r.id;
      got[r.id] = r.panic ? ["panic", r.panic.slice(0, 160)] : [r.n, r.n ? r.diags[0][5] : "", ...r.diags.slice(0, 6).map(d => [d[0], d[3], d[4]])];
    }
    if (seen + 1 < total) {
      got[seen + 1] = ["crash", stderr.slice(0, 200)];
      k = seen + 2;
    } else k = total;
  }
  const fd = openSync(out, "a");
  for (let i = 0; i < corpus.length; i++) {
    writeSync(fd, JSON.stringify({ i: corpus[i].i, g: { ts: got[i * 3], tsx: got[i * 3 + 1], dts: got[i * 3 + 2] } }) + "\n");
  }
  closeSync(fd);
}

function readShards(work, mode, jobs) {
  const out = new Map();
  for (let s = 0; s < jobs; s++) {
    const p = join(work, `${mode}.${s}.jsonl`);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      if (!line) continue;
      const r = JSON.parse(line);
      if (r.done) continue;
      out.set(r.i, r);
    }
  }
  return out;
}

async function parent(stage, corpusPath, work, jobs, tsgo, only) {
  mkdirSync(work, { recursive: true });
  const corpus = readCorpus(corpusPath);
  const info = {
    stage,
    bun: Bun.version + " " + Bun.revision,
    execPath: process.execPath,
    execSha256: createHash("sha256").update(readFileSync(process.execPath)).digest("hex"),
    typescript: JSON.parse(readFileSync(join(TS_PATH, "..", "..", "package.json"), "utf8")).version,
    corpus: corpusPath,
    rows: corpus.length,
    corpusSha256: createHash("sha256").update(readFileSync(corpusPath)).digest("hex"),
    jobs,
    started: new Date().toISOString(),
  };
  const shardIndexes = s => corpus.filter(r => r.i % jobs === s).map(r => r.i);
  if (stage === "stage1") {
    const t0 = performance.now();
    const tasks = [];
    for (const mode of only ? [only] : ["bun", "tsc"]) for (let s = 0; s < jobs; s++) tasks.push(runShard(mode, corpusPath, work, s, jobs, shardIndexes(s)));
    if (tsgo) {
      info.tsgo = tsgo;
      info.tsgoSha256 = createHash("sha256").update(readFileSync(tsgo)).digest("hex");
      tasks.push(runGo(corpus, work, tsgo));
    }
    const crashes = await Promise.all(tasks);
    info.crashes = crashes.filter(x => typeof x === "number").reduce((a, b) => a + b, 0);
    info.ms = Math.round(performance.now() - t0);
    writeFileSync(join(work, "stage1.info.json"), JSON.stringify(info, null, 2) + "\n");
    console.log(JSON.stringify(info));
  } else if (stage === "stage2") {
    const one = JSON.parse(readFileSync(join(work, "stage1.info.json"), "utf8"));
    const bun = readShards(work, "bun", one.jobs);
    const tsc = readShards(work, "tsc", one.jobs);
    const todo = {};
    let n = 0;
    for (const row of corpus) {
      const b = bun.get(row.i);
      const t = tsc.get(row.i);
      if (!b || b.crash || !t || t.crash) continue;
      const views = [];
      for (const [view, spec] of Object.entries(VIEWS)) {
        if (b.b[spec.bun] !== 1 && t.t[spec.dialect][0] === 0) views.push(view);
      }
      if (views.length) {
        todo[row.i] = views;
        n++;
      }
    }
    writeFileSync(join(work, "s2.todo.json"), JSON.stringify(todo));
    const t0 = performance.now();
    const crashes = await Promise.all(
      Array.from({ length: jobs }, (_, s) => runShard("s2", corpusPath, work, s, jobs, shardIndexes(s).filter(i => todo[i]))),
    );
    info.todo = n;
    info.crashes = crashes.reduce((a, b) => a + b, 0);
    info.ms = Math.round(performance.now() - t0);
    writeFileSync(join(work, "stage2.info.json"), JSON.stringify(info, null, 2) + "\n");
    console.log(JSON.stringify(info));
  }
}

const args = process.argv.slice(2);
if (args[0] === "--worker") {
  await worker(args[1], args[2], args[3], Number(args[4]), Number(args[5]), Number(args[6]));
} else {
  const flag = (name, dflt) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : dflt;
  };
  await parent(args[0], args[1], args[2], Number(flag("--jobs", "6")), flag("--tsgo", null), flag("--only", null));
}
