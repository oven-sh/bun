// Temporary. usage: bun tmp-dispatch-benchmark.mjs <bun of main> <bun of this branch>
import { SourceMap } from "node:module";
import os from "node:os";
import { join, resolve } from "node:path";

if (process.argv[2] !== "--child") {
  const [main, pr] = process.argv.slice(2).map(path => resolve(path));
  const variants = { main: [main, {}], pr: [pr, {}] };
  if (process.platform === "linux" && process.arch === "arm64") variants["pr-neon"] = [pr, { BUN_TMP_HWY_DISABLE: String(1 << 18) }];
  console.log(`${os.cpus().length} x ${os.cpus()[0].model}, ${os.release()}`);
  if (process.platform === "linux") console.log((await Bun.file("/proc/cpuinfo").text()).match(/^(Features|flags|CPU part|model name).*$/gm).slice(0, 2).join("\n"));
  for (const exe of [main, pr]) console.log(Bun.spawnSync([exe, "--revision"]).stdout.toString().trim());
  console.log(Bun.spawnSync([pr, "--expose-internals", "-e", `console.log(JSON.stringify(require("bun:internal-for-testing").cpuDispatch()))`]).stdout.toString().trim());
  const run = async ([exe, env], filter) => {
    const proc = Bun.spawn([exe, import.meta.path, "--child", filter], { env: { ...process.env, ...env }, stderr: "inherit" });
    return JSON.parse(await proc.stdout.text());
  };
  for (const [title, copies, filter, rounds] of [["one process", 1, ".", 5], ["a process per core", os.cpus().length, "^(serve|transpile|build|indexOf byte 64K|JSONC|xxHash3 64K)", 4]]) {
    const best = {};
    for (let round = 0; round < rounds; round++)
      for (const [name, variant] of Object.entries(variants)) {
        const all = await Promise.all(Array.from({ length: copies }, () => run(variant, filter)));
        for (const key in all[0]) {
          const mean = all.reduce((sum, it) => sum + it[key], 0) / copies;
          (best[key] ??= {})[name] = Math.min(best[key][name] ?? Infinity, mean);
        }
      }
    const names = Object.keys(variants);
    console.log(`--- ${title}\n${"ns".padEnd(34)}${names.map(it => it.padStart(14)).join("")}   pr/main${names[2] ? "  neon/pr" : ""}`);
    for (const key in best) {
      const row = best[key];
      console.log(`@ ${key.padEnd(32)}${names.map(it => row[it].toFixed(1).padStart(14)).join("")}${(row.pr / row.main).toFixed(3).padStart(10)}${names[2] ? (row["pr-neon"] / row.pr).toFixed(3).padStart(9) : ""}`);
    }
  }
  process.exit(0);
}

const root = join(import.meta.dir, "..");
const entry = join(root, "bench/react-hello-world/react-hello-world.node.js");
const source = await Bun.file(entry).bytes();
const cases = [];
const add = (name, run, isAsync) => cases.push([name, run, isAsync]);
const each = (list, run) => () => { for (let i = 0; i < list.length; i++) run(list[i]); };

for (const [n, label] of [[100, "100"], [1024, "1K"], [4096, "4K"], [65536, "64K"], [1 << 20, "1M"]]) {
  const bytes = source.slice(0, n);
  add(`crc32 ${label}`, () => Bun.hash.crc32(bytes));
  add(`adler32 ${label}`, () => Bun.hash.adler32(bytes));
  if (n < 65536) continue;
  const library = "libdeflate", gz = Bun.gzipSync(bytes), stored = Bun.gzipSync(bytes, { level: 0 });
  add(`gzipSync ${label}`, () => Bun.gzipSync(bytes));
  add(`gzipSync level 1 ${label}`, () => Bun.gzipSync(bytes, { level: 1 }));
  add(`gzipSync libdeflate ${label}`, () => Bun.gzipSync(bytes, { library }));
  add(`gunzipSync ${label}`, () => Bun.gunzipSync(gz));
  add(`gunzipSync libdeflate ${label}`, () => Bun.gunzipSync(gz, { library }));
  add(`gunzipSync libdeflate stored ${label}`, () => Bun.gunzipSync(stored, { library }));
}

const text = Buffer.from(source.slice(0, 65536).map(c => (c > 126 ? 32 : c))), str = text.toString("latin1");
const plain = Buffer.alloc(65536, "a"), plainStr = plain.toString("latin1"), hex = text.toString("hex");
const wide = Buffer.from(("☃" + plainStr).slice(0, 32768), "utf16le"), wideStr = wide.toString("utf16le");
const words = str.split(/\W+/).filter(it => it.length > 2).slice(0, 1000), wordBufs = words.map(it => Buffer.from(it));
const lines = Array.from({ length: 1000 }, (_, i) => str.substr(i * 60, 20 + ((i * 7) % 80))), lineBufs = lines.map(it => Buffer.from(it));
const colored = Buffer.from(words.map((it, i) => `\x1b[3${i % 8}m${it}\x1b[0m`).join(" ")).toString("latin1");
add("indexOf byte 64K", () => plain.indexOf(10));
add("lastIndexOf byte 64K", () => plain.lastIndexOf(10));
add("indexOf string 64K", () => text.indexOf("zzzneedlezzz"));
add("lastIndexOf string 64K", () => text.lastIndexOf("zzzneedlezzz"));
add("indexOf utf16 64K", () => wide.indexOf("zzz", 0, "utf16le"));
add("xxHash3 1K", () => Bun.hash.xxHash3(text.subarray(0, 1024)));
add("xxHash3 64K", () => Bun.hash.xxHash3(text));
add("hex encode 64K", () => text.toString("hex"));
add("hex decode 64K", () => Buffer.from(hex, "hex"));
add("escapeHTML plain 64K", () => Bun.escapeHTML(plainStr));
add("escapeHTML source 64K", () => Bun.escapeHTML(str));
add("escapeHTML utf16 32K", () => Bun.escapeHTML(wideStr));
add("stringWidth 64K", () => Bun.stringWidth(str));
add("stringWidth colored", () => Bun.stringWidth(colored));
add("stringWidth utf16 32K", () => Bun.stringWidth(wideStr));
add("stripANSI plain 64K", () => Bun.stripANSI(plainStr));
add("stripANSI colored", () => Bun.stripANSI(colored));
add("swap32 64K", () => text.swap32());
add("utf16 to latin1 32K", () => Buffer.from(wideStr, "latin1"));
for (const [label, strings, buffers] of [["words", words, wordBufs], ["lines", lines, lineBufs]]) {
  add(`indexOf byte, 1000 ${label}`, each(buffers, it => it.indexOf(10)));
  add(`indexOf string, 1000 ${label}`, each(buffers, it => it.indexOf("zq")));
  add(`hex encode, 1000 ${label}`, each(buffers, it => it.toString("hex")));
  add(`escapeHTML, 1000 ${label}`, each(strings, it => Bun.escapeHTML(it)));
  add(`stringWidth, 1000 ${label}`, each(strings, it => Bun.stringWidth(it)));
  add(`stripANSI, 1000 ${label}`, each(strings, it => Bun.stripANSI(it)));
}
const json = JSON.stringify(Object.fromEntries(words.map((it, i) => [it + i, { version: `1.${i}.0`, description: lines[i] }])));
const xml = `<a>${words.map((it, i) => `<b x="${i}">${it} ${it}</b>`).join("\n")}</a>`;
const map = { version: 3, sources: ["a.js"], names: [], mappings: "AAAA,CAAC,EAAE,gBAAgB,CAAC;AACA,KAAK,CAAC;".repeat(4000) };
const minified = new TextDecoder().decode(source), js = new Bun.Transpiler({ loader: "js" }), ts = new Bun.Transpiler({ loader: "ts" });
const types = await Bun.file(join(root, "packages/bun-types/bun.d.ts")).text(), tests = await Bun.file(join(root, "test/cli/install/bun-install.test.ts")).text();
add("JSONC.parse", () => Bun.JSONC.parse(json));
add("XML.parse", () => Bun.XML.parse(xml));
add("SourceMap", () => new SourceMap(map).findEntry(10, 1));
add("transpile react", () => js.transformSync(minified));
add("transpile comments", () => ts.transformSync(types));
add("transpile strings", () => ts.transformSync(tests));
add("build react", () => Bun.build({ entrypoints: [entry], target: "node", minify: true, sourcemap: "external" }), true);

const W = 1024, H = 768, bmp = Buffer.alloc(54 + W * H * 3);
bmp.write("BM"), bmp.writeUInt32LE(bmp.length, 2), bmp.writeUInt32LE(54, 10), bmp.writeUInt32LE(40, 14), bmp.writeInt32LE(W, 18), bmp.writeInt32LE(H, 22), bmp.writeUInt16LE(1, 26), bmp.writeUInt16LE(24, 28);
for (let y = 0, i = 54; y < H; y++) for (let x = 0; x < W; x++) (bmp[i++] = (x * 255) / W + ((x * y) % 13)), (bmp[i++] = (y * 255) / H + ((x * 7) % 11)), (bmp[i++] = (x ^ y) & 255);
const jpeg = await new Bun.Image(bmp).jpeg().bytes();
add("jpeg, resize, jpeg", () => new Bun.Image(jpeg).resize(400, 300).jpeg().bytes(), true);
add("jpeg, rotate, jpeg", () => new Bun.Image(jpeg).rotate(90).jpeg().bytes(), true);
add("jpeg, modulate, jpeg", () => new Bun.Image(jpeg).modulate({ brightness: 1.1, saturation: 0.9 }).jpeg().bytes(), true);

const server = Bun.serve({
  port: 0,
  fetch: (req, server) => (req.headers.get("upgrade") ? void server.upgrade(req) : new Response(req.headers.get("x-request-id"), { headers: { "content-type": "text/plain", "x-served-by": "benchmark" } })),
  websocket: { message: (ws, message) => void ws.send(message) },
});
const headers = { "x-request-id": "0123456789abcdef0123456789abcdef", "accept": "text/html,application/xhtml+xml", "cookie": lines[5].replace(/[^\w]/g, "x") };
add("serve, 16 requests", () => Promise.all(Array.from({ length: 16 }, async () => (await fetch(server.url + "some/path?query=1", { headers })).text())), true);
const ws = new WebSocket(server.url.href.replace("http", "ws"));
await new Promise(resolve => (ws.onopen = resolve));
add("websocket echo 16K", () => new Promise(resolve => ((ws.onmessage = resolve), ws.send(text.subarray(0, 16384)))), true);

const out = {};
for (const [name, run, isAsync] of cases) {
  if (!new RegExp(process.argv[3]).test(name)) continue;
  const time = async count => {
    const start = Bun.nanoseconds();
    if (isAsync) for (let i = 0; i < count; i++) await run();
    else for (let i = 0; i < count; i++) run();
    return (Bun.nanoseconds() - start) / count;
  };
  let count = 1;
  while ((await time(count)) * count < 1.5e7) count *= 2;
  let best = Infinity;
  for (let round = 0; round < 7; round++) best = Math.min(best, await time(count));
  out[name] = best;
}
console.log(JSON.stringify(out));
process.exit(0);
