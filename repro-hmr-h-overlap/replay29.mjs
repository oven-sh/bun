// Targeted replay of the fleet's it26..it29 edits, looped with jitter.
// Goal: provoke a parse task that outlives its dev-server bundle.
import { mkdtempSync, writeFileSync, rmSync, renameSync, existsSync, openSync, writeSync, closeSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const seed = Number(process.argv[2] ?? 1);
const rounds = Number(process.argv[3] ?? 60);
const pauseMs = Number(process.env.PAUSE_MS ?? 35);
const verbose = !!process.env.VERBOSE;

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(seed * 48271 + 11);
const int = n => Math.floor(rand() * n);

const dir = mkdtempSync(join(tmpdir(), `replay29-${seed}-`));
const p = name => join(dir, name);
const w = (name, text) => writeFileSync(p(name), text);
let n = 0;

function it26() {
  n++;
  w("m0.ts", `export const v0 = "ss${n}";\n`);
  w("m1.ts", `export const v1 = "ss${n}";\n`);
  w("m2.ts", `export const v2 = { a: ${n}, b: [1,2,3] };\nexport const z2 = 25;\n`);
  w("m3.ts", `export const v3 = Symbol.for("m3");\n`);
  w("util.css", `.u{margin:${n % 9}px}\n`);
  w("index.css", `body{color:#5c4;margin:3px}\n.k0{display:grid}\n`);
  w(
    "app.ts",
    `import { v0 } from "./m0.ts";\nimport { v1 } from "./m1.ts";\nimport * as M2 from "./m2.ts";\nimport { v4 } from "./m4.ts";\nimport { v7 } from "./m7.ts";\nimport "./util.css";\nexport const ALL = [v0, v1, M2, v4, v7];\n(globalThis as any).__T = ALL;\n`,
  );
  w(
    "index.html",
    `<!doctype html><html><head><link rel="stylesheet" href="./index.css"></head><body><script type="module" src="./app.ts"></script></body></html>\n`,
  );
  if (existsSync(p("m2.ts"))) renameSync(p("m2.ts"), p("m2r.ts"));
  if (existsSync(p("m2r.ts"))) renameSync(p("m2r.ts"), p("m2r.ts"));
  if (existsSync(p("m4.ts"))) rmSync(p("m4.ts"));
  if (existsSync(p("m7.ts"))) rmSync(p("m7.ts"));
}
function it27() {
  n++;
  w("m6.ts", `export const v6 = Symbol.for("m6");\n`);
  w("m6.ts", `export const v = ((((\n`);
}
function it28() {
  n++;
  const fd = openSync(p("m4.ts"), "w");
  writeSync(fd, "export co");
  writeSync(fd, `nst v4 = { a: ${n}, b: [1,2,3] };\n`);
  closeSync(fd);
}
function it29() {
  n++;
  renameSync(p("m4.ts"), p("m4r.ts"));
  renameSync(p("m4r.ts"), p("m4.ts"));
  w("index.css", `@import "./util.css";\nbody{color:#3e7;margin:${n % 7}px}\n`);
  w("index.css", `@import "./util.css";\nbody{color:#${(n * 7919) % 4096};margin:${n % 5}px}\n`);
}

// first state must bundle: give it a complete graph once
w("m4.ts", `export const v4 = 1;\n`);
w("m7.ts", `export const v7 = 1;\n`);
it26();
w("m2.ts", `export const v2 = 1;\n`);
w("m4.ts", `export const v4 = 1;\n`);
w("m7.ts", `export const v7 = 1;\n`);
w("p2.html", `<!doctype html><html><head><link rel="stylesheet" href="./index.css"></head><body><script type="module" src="./app.ts"></script></body></html>\n`);

const html = (await import(p("index.html"))).default;
const html2 = (await import(p("p2.html"))).default;
const server = Bun.serve({
  port: 0,
  development: { hmr: true },
  routes: { "/": html, "/p2": html2 },
  fetch: () => new Response("nf", { status: 404 }),
});
const origin = `http://localhost:${server.port}`;

async function gets() {
  const out = [];
  for (const path of ["/", "/p2"]) {
    try {
      const res = await fetch(origin + path);
      const text = await res.text();
      out.push(res.status);
      const refs = [...text.matchAll(/(?:src|href)="(\/_bun\/[^"]+)"/g)].map(m => m[1]).slice(0, 2);
      for (const ref of refs) await fetch(origin + ref).then(r => r.arrayBuffer());
    } catch (e) {
      out.push("ERR");
    }
  }
  return out.join(",");
}
console.error(`[r29] seed=${seed} dir=${dir} first: ${await gets()}`);

const ws = new WebSocket(`ws://localhost:${server.port}/_bun/hmr`);
ws.binaryType = "arraybuffer";
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let messages = 0;
ws.onmessage = () => messages++;
ws.onclose = () => console.error("[r29] ws closed");
ws.send("she");
ws.send("n/");
await Bun.sleep(30);

// The fleet unit's second client: in about 35% of iterations one more hmr socket sends 1 to 4
// seeded frames (nine kinds, the bare `H` among them) and mostly closes again.
const ephemeral = (process.env.EPHEMERAL ?? "1") === "1";
const frameKinds = [
  () => "i" + "0123abcd",
  () => "i12",
  () => "she",
  () => "n/p2",
  () => (process.env.NO_H === "1" ? "she" : "H"),
  () => "llhello from the viewer",
  () => "u" + "\0".repeat(8),
  () => "",
  () => new Uint8Array([int(256), int(256), int(256), int(256)]),
];
let hFrames = 0;
function ephemeralClient() {
  if (!ephemeral || rand() >= 0.35) return;
  const frames = [];
  for (let k = 0, count = 1 + int(4); k < count; k++) frames.push(frameKinds[int(frameKinds.length)]());
  const stay = rand() < 0.2;
  const delay = int(Number(process.env.EPH_DELAY_MS ?? 70));
  setTimeout(() => openEphemeral(frames, stay), delay);
}
function openEphemeral(frames, stay) {
  const sock = new WebSocket(`ws://localhost:${server.port}/_bun/hmr`);
  sock.binaryType = "arraybuffer";
  sock.onopen = () => {
    for (const f of frames) {
      if (f === "H") hFrames++;
      try {
        sock.send(f);
      } catch {}
    }
    if (!stay) sock.close();
  };
  sock.onerror = () => {};
}

const steps = [it26, it27, it28, it29];
for (let round = 0; round < rounds; round++) {
  for (const step of steps) {
    ephemeralClient();
    step();
    // the fleet pause was 35 ms; jitter around it so bundles and edits overlap in different ways
    await Bun.sleep(Math.max(0, pauseMs - 10 + int(21)));
    const status = await gets();
    if (verbose) console.error(`[r29] round ${round} ${step.name} -> ${status} (ws ${messages})`);
  }
  // extra it29-style churn: rename away and back while the previous bundle may still run
  for (let k = 0; k < 1 + int(3); k++) {
    it29();
    await Bun.sleep(int(12));
  }
  await gets();
}

ws.close();
await server.stop(true);
rmSync(dir, { recursive: true, force: true });
console.error(`[r29] seed=${seed} done, ws messages=${messages}, H frames=${hFrames}`);
process.exit(0);
