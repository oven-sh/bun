// In-process micro benchmark suite. Run with the bun binary under test:
//   <bun> /tmp/bench/suite.mjs [filter]
// Prints one JSON line per benchmark: {name, median, min, max} in ns/op.
import { Database } from "bun:sqlite";
import { $ } from "bun";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";

const ROOT = process.env.BENCH_ROOT ?? "/tmp/bench";
const SRC = process.env.BUN_SRC_ROOT ?? "/workspace/bun";
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const out = [];

function report(name, times) {
  times.sort((a, b) => a - b);
  const r = { name, median: times[(times.length - 1) >> 1], min: times[0], max: times[times.length - 1] };
  out.push(r);
  process.stderr.write(`${name.padEnd(34)} ${(r.median / 1e3).toFixed(3).padStart(12)} us/op\n`);
}

function bench(name, fn, { iters = 1000, batches = 11, warmupMs = 200 } = {}) {
  if (filter && !filter.test(name)) return;
  const wEnd = Bun.nanoseconds() + warmupMs * 1e6;
  while (Bun.nanoseconds() < wEnd) fn();
  const times = [];
  for (let b = 0; b < batches; b++) {
    const t0 = Bun.nanoseconds();
    for (let i = 0; i < iters; i++) fn();
    times.push((Bun.nanoseconds() - t0) / iters);
  }
  report(name, times);
}

async function benchAsync(name, fn, { iters = 200, batches = 11, warmupMs = 200 } = {}) {
  if (filter && !filter.test(name)) return;
  const wEnd = Bun.nanoseconds() + warmupMs * 1e6;
  while (Bun.nanoseconds() < wEnd) await fn();
  const times = [];
  for (let b = 0; b < batches; b++) {
    const t0 = Bun.nanoseconds();
    for (let i = 0; i < iters; i++) await fn();
    times.push((Bun.nanoseconds() - t0) / iters);
  }
  report(name, times);
}

// ───────────────────────── fixtures ─────────────────────────
const bigObj = {
  users: Array.from({ length: 200 }, (_, i) => ({
    id: i,
    name: `user-${i}`,
    email: `user${i}@example.com`,
    tags: ["a", "b", "c"],
    nested: { x: i * 1.5, y: [1, 2, 3], z: { w: "hello world", flag: i % 2 === 0 } },
  })),
};
const bigJson = JSON.stringify(bigObj);
const str1k = "The quick brown fox jumps over the lazy dog. ".repeat(23);
const strHtml = '<div class="a">Tom & Jerry\'s "show" <b>bold</b></div> '.repeat(20);
const buf64k = Buffer.alloc(65536, 97);
const b64 = buf64k.toString("base64");
const utf8Mixed = Buffer.from("héllo wörld ✓ 日本語 🎉 ".repeat(200));
const tsSource = fs.readFileSync(ROOT + "/fixtures/transpile-input.ts", "utf8");
const smallFile = ROOT + "/fixtures/small.txt";
const medFile = ROOT + "/fixtures/medium.bin";
const semverRanges = ["^1.2.3", "~2.0.0", ">=3.0.0 <4.0.0", "1.x", "*", "^0.0.1"];
const semverVersions = ["1.2.4", "2.0.5", "3.5.1", "1.9.9", "4.0.0", "0.0.1"];
const gzInput = Buffer.from(bigJson.repeat(4));
const gzipped = zlib.gzipSync(gzInput);

// ───────────────────────── JSC / C++ runtime ─────────────────────────
bench("jsc: JSON.parse(40KB)", () => JSON.parse(bigJson), { iters: 200 });
bench("jsc: JSON.stringify(40KB)", () => JSON.stringify(bigObj), { iters: 200 });
bench("jsc: structuredClone(40KB)", () => structuredClone(bigObj), { iters: 100 });
bench(
  "jsc: Array.sort 2k numbers",
  (() => {
    const arr = Array.from({ length: 2000 }, (_, i) => (i * 7919) % 2003);
    return () => arr.slice().sort((a, b) => a - b);
  })(),
  { iters: 200 },
);
bench(
  "jsc: Map set/get 10k",
  () => {
    const m = new Map();
    for (let i = 0; i < 10000; i++) m.set("k" + i, i);
    let s = 0;
    for (let i = 0; i < 10000; i++) s += m.get("k" + i);
    return s;
  },
  { iters: 20 },
);
bench(
  "jsc: alloc 100k small objects (gc)",
  () => {
    let arr = [];
    for (let i = 0; i < 100000; i++) arr.push({ a: i, b: [i], c: "x" + i });
    return arr.length;
  },
  { iters: 5 },
);
bench("jsc: String split/join 1KB", () => str1k.split(" ").join("_"), { iters: 2000 });
{
  // distinct inputs: JSC caches replace() results for an identical string + regexp
  const inputs = Array.from({ length: 64 }, (_, i) => str1k.replace("quick", "quick" + i));
  let k = 0;
  bench("jsc: RegExp replace 1KB", () => inputs[k++ & 63].replace(/o(\w)/g, "0$1"), { iters: 2000 });
}

// ───────────────────────── Bun natives ─────────────────────────
bench("bun: Bun.hash(1KB)", () => Bun.hash(str1k), { iters: 5000 });
bench("bun: CryptoHasher sha256 64KB", () => new Bun.CryptoHasher("sha256").update(buf64k).digest(), { iters: 200 });
bench("bun: crypto.createHash md5 64KB", () => crypto.createHash("md5").update(buf64k).digest("hex"), { iters: 200 });
bench("bun: crypto.randomUUID", () => crypto.randomUUID(), { iters: 10000 });
bench("bun: Buffer base64 encode 64KB", () => buf64k.toString("base64"), { iters: 500 });
bench("bun: Buffer base64 decode 64KB", () => Buffer.from(b64, "base64"), { iters: 500 });
bench("bun: Buffer.toString utf8 mixed", () => utf8Mixed.toString("utf8"), { iters: 2000 });
bench(
  "bun: TextEncoder.encode 1KB",
  (() => {
    const e = new TextEncoder();
    return () => e.encode(str1k);
  })(),
  { iters: 5000 },
);
bench(
  "bun: TextDecoder.decode 64KB",
  (() => {
    const d = new TextDecoder();
    return () => d.decode(buf64k);
  })(),
  { iters: 500 },
);
bench("bun: Bun.escapeHTML 1KB", () => Bun.escapeHTML(strHtml), { iters: 5000 });
bench("bun: Bun.inspect(40KB obj)", () => Bun.inspect(bigObj), { iters: 50 });
bench(
  "bun: Bun.deepEquals(40KB obj)",
  (() => {
    const copy = structuredClone(bigObj);
    return () => Bun.deepEquals(bigObj, copy);
  })(),
  { iters: 200 },
);
bench("bun: Bun.stringWidth 1KB", () => Bun.stringWidth(str1k), { iters: 5000 });
bench(
  "bun: Bun.semver.satisfies x6",
  () => {
    let n = 0;
    for (let i = 0; i < 6; i++) n += Bun.semver.satisfies(semverVersions[i], semverRanges[i]) ? 1 : 0;
    return n;
  },
  { iters: 5000 },
);
bench("bun: new URL", () => new URL("https://user:pw@example.com:8080/a/b/c?x=1&y=2#frag").pathname, { iters: 10000 });
bench("bun: new Headers + get", () => new Headers({ "content-type": "text/html", "x-a": "1", "x-b": "2" }).get("x-b"), {
  iters: 10000,
});
bench("bun: new Response", () => new Response("hello", { status: 200, headers: { "x-a": "1" } }).status, {
  iters: 10000,
});
bench("node: path.resolve/relative", () => path.relative(path.resolve("/a/b/c", "../d", "./e"), "/a/x/y"), {
  iters: 10000,
});
bench("node: fs.readFileSync 4KB", () => fs.readFileSync(smallFile), { iters: 2000 });
bench("node: fs.readFileSync 1MB", () => fs.readFileSync(medFile), { iters: 100 });
bench("node: fs.statSync", () => fs.statSync(smallFile).size, { iters: 5000 });
bench("node: zlib.gzipSync 160KB", () => zlib.gzipSync(gzInput), { iters: 20 });
bench("node: zlib.gunzipSync 160KB", () => zlib.gunzipSync(gzipped), { iters: 50 });
bench(
  "bun: Transpiler.transformSync 60KB ts",
  (() => {
    const t = new Bun.Transpiler({ loader: "ts" });
    return () => t.transformSync(tsSource);
  })(),
  { iters: 20 },
);
bench(
  "bun: Transpiler.scan 60KB ts",
  (() => {
    const t = new Bun.Transpiler({ loader: "ts" });
    return () => t.scan(tsSource);
  })(),
  { iters: 20 },
);
bench(
  "bun: Glob.scanSync runtime/**/*.rs",
  (() => {
    const g = new Bun.Glob("**/*.rs");
    return () => Array.from(g.scanSync(SRC + "/src/runtime")).length;
  })(),
  { iters: 3, batches: 7 },
);

// sqlite
{
  const db = new Database(":memory:");
  db.run("create table t (id integer primary key, name text, v real)");
  const ins = db.prepare("insert into t (name, v) values (?, ?)");
  for (let i = 0; i < 1000; i++) ins.run("name" + i, i * 1.5);
  const q = db.prepare("select id, name, v from t where id = ?");
  let i = 0;
  bench("sqlite: prepared select by pk", () => q.get((i++ % 1000) + 1), { iters: 5000 });
  const all = db.prepare("select id, name, v from t where v > ? limit 100");
  bench("sqlite: select 100 rows", () => all.all(10), { iters: 500 });
}

// module loading: fresh ESM import each time (transpile + link) and CJS require
{
  let n = 0;
  await benchAsync("bun: import() fresh 20KB module", () => import(`${ROOT}/fixtures/module.ts?v=${n++}`), {
    iters: 20,
    batches: 9,
  });
  const modPath = ROOT + "/fixtures/module.cjs";
  bench(
    "bun: require() uncached 20KB cjs",
    () => {
      delete require.cache[modPath];
      return require(modPath);
    },
    { iters: 20, batches: 9 },
  );
}

// ───────────────────────── async / event loop / IO ─────────────────────────
await benchAsync(
  "bun: await Promise.resolve x100",
  async () => {
    for (let i = 0; i < 100; i++) await Promise.resolve(i);
  },
  { iters: 200 },
);
await benchAsync("bun: setImmediate round trip", () => new Promise(r => setImmediate(r)), { iters: 500 });
await benchAsync("bun: Bun.file().text() 4KB", () => Bun.file(smallFile).text(), { iters: 500 });
await benchAsync(
  "bun: Bun.write + read 64KB",
  async () => {
    await Bun.write(ROOT + "/fixtures/out.bin", buf64k);
    return (await Bun.file(ROOT + "/fixtures/out.bin").arrayBuffer()).byteLength;
  },
  { iters: 100 },
);
{
  const jsonBuf = Buffer.from(bigJson);
  await benchAsync("bun: Response(buffer).text() 40KB", () => new Response(jsonBuf).text(), { iters: 500 });
}
await benchAsync("bun: Response.json() 40KB", () => new Response(bigJson).json(), { iters: 500 });
await benchAsync("bun: readableStreamToText", () => Bun.readableStreamToText(new Response(bigJson).body), {
  iters: 500,
});
await benchAsync("bun: $ echo (shell builtin)", () => $`echo hello world`.quiet(), { iters: 100 });

// HTTP: server + client in process
{
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      if (req.method === "POST") return req.json().then(j => Response.json({ ok: true, n: j.users.length }));
      return new Response("hello world", { headers: { "content-type": "text/plain" } });
    },
  });
  const url = `http://127.0.0.1:${server.port}/`;
  await benchAsync("http: fetch GET small, serial", async () => (await fetch(url)).text(), { iters: 200 });
  await benchAsync(
    "http: fetch POST 40KB json, serial",
    async () =>
      (await fetch(url, { method: "POST", body: bigJson, headers: { "content-type": "application/json" } })).json(),
    { iters: 100 },
  );
  await benchAsync(
    "http: fetch GET x50 concurrent",
    () => Promise.all(Array.from({ length: 50 }, () => fetch(url).then(r => r.text()))),
    { iters: 10, batches: 9 },
  );
  server.stop(true);
}

console.log(JSON.stringify(out));
