// Forces the unguarded `H` release while a request-triggered bundle is in flight.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "overlap-h-"));
const w = (name, text) => writeFileSync(join(dir, name), text);
let big = "";
for (let i = 0; i < 400; i++) big += `import "./b${i}.ts";\n`;
for (let i = 0; i < 400; i++) w(`b${i}.ts`, `export const x${i} = ${i};\n` + "// pad\n".repeat(2000));
w("a.ts", `console.log("a");\n`);
w("p2.ts", big + `console.log("p2");\n`);
w("index.html", `<!doctype html><html><body><script type="module" src="./a.ts"></script></body></html>\n`);
w("p2.html", `<!doctype html><html><body><script type="module" src="./p2.ts"></script></body></html>\n`);

const html = (await import(join(dir, "index.html"))).default;
const html2 = (await import(join(dir, "p2.html"))).default;
const server = Bun.serve({ port: 0, development: { hmr: true }, routes: { "/": html, "/p2": html2 }, fetch: () => new Response("nf") });
const origin = `http://localhost:${server.port}`;
await (await fetch(origin + "/")).text();

const ws = new WebSocket(`ws://localhost:${server.port}/_bun/hmr`);
ws.binaryType = "arraybuffer";
await new Promise(r => (ws.onopen = r));
const waiters = [];
ws.onmessage = ev => {
  const b = new Uint8Array(ev.data);
  if (b[0] === 0x72) for (const f of waiters.splice(0)) f(b[1]);
};
const next = () => new Promise(r => waiters.push(r));
ws.send("sr");
ws.send("n/");
await Bun.sleep(50);

let started = next();
ws.send("H"); // enable batching
await started;
let seen = next();
w("a.ts", `console.log("a2");\n`);
await seen;
await Bun.sleep(60);
// start the (large) /p2 bundle through a request, then release the batch while it runs
const p2 = fetch(origin + "/p2").then(r => r.text()).catch(() => "");
await Bun.sleep(Number(process.env.GAP_MS ?? 15));
ws.send("H");
await Bun.sleep(3000);
await p2;
console.error("[overlap] no crash");
ws.close();
await server.stop(true);
rmSync(dir, { recursive: true, force: true });
process.exit(0);
