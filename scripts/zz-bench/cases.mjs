// Temporary: prints nanoseconds per call of each case, as JSON.
import { Database } from "bun:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import util from "node:util";
import zlib from "node:zlib";

const root = path.join(import.meta.dir, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const tsc = read("node_modules/typescript/lib/typescript.js");
const text = tsc.slice(1e6, 1.5e6);
const bytes = Buffer.from(text);
const ts = read("src/js/node/fs.ts");
const md = read("docs/project/bindgen.mdx");
const records = Array.from({ length: 5000 }, (_, i) => ({ id: i, name: "n" + i, tags: ["a", "b"], x: i * 1.5 }));
const json = JSON.stringify(records);
const unicode = "héllo wörld 你好 世界 🎉 ".repeat(8000);
const unicodeBytes = Buffer.from(unicode);
const latin1 = "café au lait ".repeat(20000);
const css = Array.from(
  { length: 1500 },
  (_, i) =>
    `.a${i} > .b${i}:hover { color: rgb(${i % 255}, 20, 30); margin: ${i}px 0 0 0; transition: all .${i}s ease }`,
).join("\n");
const html = "<html><body>" + `<div class="a"><p id="x">hello <a href="/b">world</a></p></div>`.repeat(3000);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zz-bench-"));
fs.writeFileSync(path.join(tmp, "a.css"), css);
fs.writeFileSync(path.join(tmp, "small.txt"), "x".repeat(1000));
let n = 0;
let sink;

const cases = {
  // The engine's C++
  "jsc: JSON.parse": () => () => JSON.parse(json),
  "jsc: JSON.stringify": () => () => JSON.stringify(records),
  "jsc: parse 200 KB": () => {
    const body = `if (a) { ${read("node_modules/typescript/lib/_typingsInstaller.js").replace(/^"use strict";/m, "")} }`;
    return () => new Function("a", body.repeat(20).replaceAll("typingsInstaller", "t" + n++));
  },
  "jsc: new Function, call": () => () => {
    for (let i = 0; i < 200; i++) sink = new Function("a", `for(let i=0;i<a;i++){if(i>3)break} return a+${n++}`)(1);
  },
  "jsc: optimizing compilers": () => () =>
    new Function(
      "n",
      `let s=${n++},o={a:1,b:2},r=[1,2,3,4];for(let i=0;i<n;i++){s=(s+o.a*r[i&3]+(i%7?o.b:Math.imul(s,3)))|0;if(s&1)o.a=i&15;else r[i&3]=s&7}return s`,
    )(300000),
  "jsc: allocate, collect": () => () => {
    const a = [];
    for (let j = 0; j < 100000; j++) a.push({ j });
    return a.length;
  },
  "jsc: full collection": () => {
    globalThis.kept = Array.from({ length: 200000 }, (_, i) => ({ i, s: "k" + i, a: [i] }));
    return Object.assign(() => Bun.gc(true), { done: () => (globalThis.kept = undefined) });
  },
  "jsc: sort strings": () => {
    const words = text.split(/\W+/).slice(0, 20000);
    return () => words.slice().sort();
  },
  "jsc: Map of strings": () => () => {
    const map = new Map();
    for (let i = 0; i < 10000; i++) map.set("key" + i, i);
    return map.size;
  },
  "jsc: dictionary object": () => () => {
    const o = {};
    for (let i = 0; i < 5000; i++) o["p" + i] = i;
    return Object.keys(o).length;
  },
  "jsc: split, join": () => () => text.split("\n").join("\r\n"),
  "jsc: replaceAll": () => () => text.replaceAll("function", "fn"),
  "jsc: toLowerCase": () => () => text.toLowerCase(),
  "jsc: indexOf": () => () => text.indexOf("not in there"),
  "jsc: compile RegExp": () => () => {
    for (let i = 0; i < 100; i++) sink = new RegExp(`^(a|b${n++})+[c-f]{2,5}(?:x|\\d+)*$`).test("aabcd123");
  },
  "jsc: number to string": () => () => {
    for (let i = 0; i < 10000; i++) sink = (n++ * 1.37).toString();
  },
  "jsc: parseFloat": () => {
    const numbers = Array.from({ length: 10000 }, (_, i) => String(i * 1.37));
    return () => numbers.map(parseFloat);
  },
  "jsc: BigInt multiply": () => {
    const [a, b] = [3n ** 5000n, 7n ** 3000n];
    return () => a * b;
  },
  "jsc: typed array convert": () => {
    const [from, to] = [new Int16Array(200000).fill(3), new Float32Array(200000)];
    return () => to.set(from);
  },
  "jsc: typed array sort": () => {
    const numbers = Float64Array.from({ length: 50000 }, (_, i) => Math.sin(i));
    return () => numbers.slice().sort();
  },
  "jsc: typed array indexOf": () => {
    const numbers = new Int32Array(500000);
    return () => numbers.indexOf(1);
  },
  "jsc: Error with stack": () => () => {
    for (let i = 0; i < 500; i++) sink = new Error("x").stack;
  },
  "jsc: promises": () => async () => {
    for (let i = 0; i < 10000; i++) await i;
  },
  "jsc: Date": () => () => {
    for (let i = 0; i < 5000; i++) sink = new Date(n++ * 1e6).toISOString();
  },
  "jsc: Atomics.add, SharedArrayBuffer": () => () => {
    for (let i = 0; i < 2000; i++) sink = Atomics.add(new Int32Array(new SharedArrayBuffer(16)), 0, 1);
  },
  // Loops over bytes
  "bytes: base64 encode": () => () => bytes.toString("base64"),
  "bytes: base64 decode": () => {
    const encoded = bytes.toString("base64");
    return () => Buffer.from(encoded, "base64");
  },
  "bytes: hex encode": () => () => bytes.toString("hex"),
  "bytes: hex decode": () => {
    const encoded = bytes.toString("hex");
    return () => Buffer.from(encoded, "hex");
  },
  "bytes: UTF-8 encode": () => () => Buffer.from(unicode),
  "bytes: UTF-8 decode": () => () => unicodeBytes.toString(),
  "bytes: Latin-1 to UTF-8": () => () => Buffer.from(latin1),
  "bytes: swap32": () => {
    const b = Buffer.alloc(500000, 1);
    return () => b.swap32();
  },
  "bytes: escapeHTML": () => () => Bun.escapeHTML(text),
  "bytes: stringWidth": () => () => Bun.stringWidth(unicode),
  "bytes: wyhash": () => () => Bun.hash(bytes),
  "bytes: xxHash3": () => () => Bun.hash.xxHash3(bytes),
  "bytes: crc32": () => () => Bun.hash.crc32(bytes),
  "bytes: adler32": () => () => Bun.hash.adler32(bytes),
  "compress: gzip": () => () => zlib.gzipSync(bytes),
  "compress: gunzip": () => {
    const packed = zlib.gzipSync(bytes);
    return () => zlib.gunzipSync(packed);
  },
  "compress: Bun.gzipSync": () => () => Bun.gzipSync(bytes, { library: "libdeflate" }),
  "compress: brotli": () => () =>
    zlib.brotliCompressSync(bytes, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }),
  "compress: unbrotli": () => {
    const packed = zlib.brotliCompressSync(bytes, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } });
    return () => zlib.brotliDecompressSync(packed);
  },
  "compress: zstd": () => () => Bun.zstdCompressSync(bytes),
  "compress: unzstd": () => {
    const packed = Bun.zstdCompressSync(bytes);
    return () => Bun.zstdDecompressSync(packed);
  },
  "crypto: sha256, short": () => () => {
    for (let i = 0; i < 2000; i++)
      sink = crypto
        .createHash("sha256")
        .update("x" + i)
        .digest("hex");
  },
  "crypto: md5": () => () => crypto.hash("md5", bytes),
  "crypto: sha3": () => () => new Bun.CryptoHasher("sha3-256").update(bytes).digest(),
  "crypto: ed25519 sign": () => {
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    return () => crypto.sign(null, Buffer.from("hello"), privateKey);
  },
  "crypto: argon2": () => () => Bun.password.hashSync("x", { algorithm: "argon2id", memoryCost: 4096, timeCost: 1 }),
  "crypto: bcrypt": () => () => Bun.password.hashSync("x", { algorithm: "bcrypt", cost: 6 }),
  // Parsers and printers
  "tools: transpile TypeScript": () => {
    const transpiler = new Bun.Transpiler({ loader: "ts" });
    return () => transpiler.transformSync(ts);
  },
  "tools: minify CSS": () => () => Bun.build({ entrypoints: [path.join(tmp, "a.css")], minify: true }),
  "tools: YAML.parse": () => {
    const yaml = Bun.YAML.stringify(records.slice(0, 1000), null, 2);
    return () => Bun.YAML.parse(yaml);
  },
  "tools: TOML.parse": () => {
    const toml = records
      .slice(0, 1000)
      .map(r => `[[r]]\nid = ${r.id}\nname = "${r.name}"\nx = ${r.x}\n`)
      .join("");
    return () => Bun.TOML.parse(toml);
  },
  "tools: markdown": () => () => Bun.markdown.html(md),
  "tools: HTMLRewriter": () => () =>
    new HTMLRewriter().on("a", { element: e => void e.setAttribute("b", "c") }).transform(html),
  "tools: Glob.match": () => {
    const glob = new Bun.Glob("src/**/*.{ts,tsx}");
    return () => {
      for (let i = 0; i < 5000; i++) sink = glob.match("src/a/b/c/d/file" + i + ".tsx");
    };
  },
  "tools: semver": () => () => {
    for (let i = 0; i < 5000; i++) sink = Bun.semver.satisfies("1.2." + i, ">=1.0.0 <2.0.0 || ^3");
  },
  "tools: Bun.inspect": () => () => Bun.inspect(records.slice(0, 100)),
  "tools: deepEquals": () => {
    const copy = JSON.parse(json);
    return () => Bun.deepEquals(records, copy);
  },
  "tools: image resize": async () => {
    const image = fs.readFileSync(path.join(root, "docs/images/cat.jpg"));
    return () => new Bun.Image(image).resize(200, 200).jpeg().bytes();
  },
  // Calls between JavaScript, C++ and Rust
  "web: URL": () => () => {
    for (let i = 0; i < 5000; i++) sink = new URL("https://example.com/a/b?c=" + i);
  },
  "web: URLSearchParams": () => () => {
    for (let i = 0; i < 3000; i++) sink = new URLSearchParams("a=1&b=%20x&c=" + i).toString();
  },
  "web: Headers": () => () => {
    for (let i = 0; i < 3000; i++) {
      const headers = new Headers({ a: "1", b: "2" });
      headers.set("c", "" + i);
      sink = headers.get("a");
    }
  },
  "web: Response": () => () => {
    for (let i = 0; i < 5000; i++) sink = new Response("hi" + i, { status: 200 });
  },
  "web: structuredClone": () => () => structuredClone(records.map(r => ({ ...r, d: new Date(0) }))),
  "web: EventTarget": () => {
    const target = new EventTarget();
    target.addEventListener("a", () => n++);
    return () => {
      for (let i = 0; i < 5000; i++) target.dispatchEvent(new Event("a"));
    };
  },
  "web: ReadableStream": () => async () => {
    let left = 1000;
    for await (const chunk of new ReadableStream({ pull: c => (left-- ? c.enqueue(left) : c.close()) })) sink = chunk;
  },
  "web: timers": () => () => {
    for (let i = 0; i < 5000; i++) clearTimeout(setTimeout(() => {}, 1000));
  },
  "node: path.join": () => () => {
    for (let i = 0; i < 10000; i++) sink = path.join("/a/b", "../c", "" + i);
  },
  "node: small Buffers": () => () => {
    for (let i = 0; i < 10000; i++) sink = Buffer.from("hello" + i).toString("latin1");
  },
  "node: util.inspect": () => () => util.inspect(records.slice(0, 100)),
  "node: readFileSync": () => () => {
    for (let i = 0; i < 300; i++) sink = fs.readFileSync(path.join(tmp, "small.txt"));
  },
  "node: statSync": () => () => {
    for (let i = 0; i < 300; i++) sink = fs.statSync(tmp);
  },
  "intl: NumberFormat": () => {
    const format = new Intl.NumberFormat("de");
    return () => {
      for (let i = 0; i < 3000; i++) sink = format.format(i * 1.5);
    };
  },
  "intl: DateTimeFormat": () => {
    const format = new Intl.DateTimeFormat("fr", { dateStyle: "full", timeStyle: "long", timeZone: "UTC" });
    return () => {
      for (let i = 0; i < 1000; i++) sink = format.format(i * 1e9);
    };
  },
  "intl: Collator": () => {
    const words = Array.from({ length: 3000 }, (_, i) => "é" + ((i * 7919) % 3001) + "ö");
    return () => words.slice().sort(new Intl.Collator("de").compare);
  },
  "intl: normalize": () => () => unicode.normalize("NFD"),
  "sqlite: insert, select": () => {
    const db = new Database(":memory:");
    db.run("create table t (a integer primary key, b text, c real)");
    const insert = db.prepare("insert into t values (?, ?, ?)");
    return () => {
      db.transaction(() => records.forEach(r => insert.run(r.id, r.name, r.x)))();
      sink = db.query("select * from t where c > 10 order by b").all();
      db.run("delete from t");
    };
  },
  "io: serve and fetch": () => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("hello") });
    const some = async () => {
      for (let i = 0; i < 25; i++) await (await fetch(server.url)).text();
    };
    return Object.assign(() => Promise.all(Array.from({ length: 8 }, some)), { done: () => server.stop(true) });
  },
  "io: WebSocket echo": async () => {
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (request, server) => void server.upgrade(request),
      websocket: { message: (socket, message) => void socket.send(message) },
    });
    const socket = new WebSocket(server.url.href.replace("http", "ws"));
    await new Promise(resolve => (socket.onopen = resolve));
    const payload = text.slice(0, 2000);
    const run = () =>
      new Promise(resolve => {
        let left = 500;
        socket.onmessage = () => --left || resolve();
        for (let i = 0; i < 500; i++) socket.send(payload);
      });
    return Object.assign(run, { done: () => (socket.close(), server.stop(true)) });
  },
  "io: postMessage": async () => {
    fs.writeFileSync(path.join(tmp, "w.js"), "onmessage = e => postMessage(e.data)");
    const worker = new Worker(path.join(tmp, "w.js"));
    const run = () =>
      new Promise(resolve => {
        let left = 1000;
        worker.onmessage = () => --left || resolve();
        for (let i = 0; i < 1000; i++) worker.postMessage({ i, a: [i] });
      });
    return Object.assign(run, { done: () => worker.terminate() });
  },
};

const batch = Number(process.env.ZZ_BATCH_MS ?? 45) * 1e6;
const result = {};
for (const [name, make] of Object.entries(cases)) {
  try {
    const run = await make();
    let best = Infinity;
    for (let round = 0; round < 5; round++) {
      let calls = 0;
      const start = Bun.nanoseconds();
      do {
        sink = run();
        if (sink instanceof Promise) sink = await sink;
        calls++;
      } while (Bun.nanoseconds() - start < batch);
      if (round > 0) best = Math.min(best, (Bun.nanoseconds() - start) / calls);
    }
    run.done?.();
    result[name] = Math.round(best);
  } catch (error) {
    console.error(`${name}: ${error}`);
  }
  sink = undefined;
  Bun.gc(true);
}
console.log(JSON.stringify(result));
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(0);
