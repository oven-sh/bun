// Memory that two threads share changes under the reader: what Atomics reads may not be kept from an earlier read, moved out of a loop or taken from what this thread stored.
import { isMainThread, Worker, workerData } from "node:worker_threads";
const show = v => JSON.stringify(v);
async function t(name, main, other) {
  if (!isMainThread) { if (workerData.name === name) other(new Int32Array(workerData.memory), workerData.memory); return; }
  const memory = new SharedArrayBuffer(64); const worker = new Worker(new URL(import.meta.url), { workerData: { name, memory } });
  let r; try { r = show(await main(new Int32Array(memory), memory)); } catch (e) { r = "threw " + e.name + ": " + e.message; }
  await new Promise(done => worker.on("exit", done)); console.log(name, r);
}
const later = f => setTimeout(f, 30);
await t("spin on load", a => { let n = 0; while (Atomics.load(a, 0) === 0) n++; return [Atomics.load(a, 0), n > 0]; }, a => later(() => Atomics.store(a, 0, 7)));
await t("spin in a function", a => { const ready = () => Atomics.load(a, 0) !== 0; while (!ready()); return a[0]; }, a => later(() => Atomics.store(a, 0, 8)));
await t("spin in a method", a => { class Flag { constructor(m) { this.m = m; } get set() { return Atomics.load(this.m, 0) === 1; } } const f = new Flag(a); while (!f.set); return "left"; }, a => later(() => Atomics.store(a, 0, 1)));
await t("spin after own store", a => { Atomics.store(a, 0, 1); while (Atomics.load(a, 0) === 1); return Atomics.load(a, 0); }, a => later(() => Atomics.store(a, 0, 2)));
await t("two loads", a => { const first = Atomics.load(a, 0); Atomics.wait(a, 1, 0, 200); const second = Atomics.load(a, 0); return [first, second]; }, a => later(() => { Atomics.store(a, 0, 5); Atomics.store(a, 1, 1); Atomics.notify(a, 1); }));
await t("plain read after wait", a => { const first = a[0]; Atomics.wait(a, 1, 0, 500); return [first, a[0]]; }, a => later(() => { a[0] = 6; Atomics.store(a, 1, 1); Atomics.notify(a, 1); }));
await t("plain read after load", a => { const first = a[2]; while (Atomics.load(a, 0) === 0); return [first, a[2]]; }, a => later(() => { a[2] = 9; Atomics.store(a, 0, 1); }));
await t("spin on compare exchange", a => { let n = 0; while (Atomics.compareExchange(a, 0, 1, 2) !== 1) n++; return [a[0], n > 0]; }, a => later(() => Atomics.store(a, 0, 1)));
await t("spin on add zero", a => { while (Atomics.add(a, 0, 0) === 0); return "left"; }, a => later(() => Atomics.store(a, 0, 1)));
await t("spin on or", a => { while (Atomics.or(a, 0, 0) === 0); return "left"; }, a => later(() => Atomics.store(a, 0, 1)));
await t("spin on exchange", a => { while (Atomics.exchange(a, 0, 0) === 0); return "left"; }, a => later(() => Atomics.store(a, 0, 1)));
await t("wait value", a => [Atomics.wait(a, 0, 0, 2000), Atomics.load(a, 0)], a => later(() => { Atomics.store(a, 0, 3); Atomics.notify(a, 0); }));
await t("wait async", async a => { const w = Atomics.waitAsync(a, 0, 0, 2000); return [w.async, await w.value, Atomics.load(a, 0)]; }, a => later(() => { Atomics.store(a, 0, 4); Atomics.notify(a, 0); }));
await t("another view", (a, m) => { const bytes = new Uint8Array(m); while (Atomics.load(bytes, 0) === 0); return [bytes[0], a[0]]; }, a => later(() => Atomics.store(a, 0, 0x0102)));
await t("big view", (a, m) => { const big = new BigInt64Array(m); while (Atomics.load(big, 0) === 0n); return String(Atomics.load(big, 0)); }, (a, m) => later(() => Atomics.store(new BigInt64Array(m), 0, 5n)));
await t("data view after load", (a, m) => { const v = new DataView(m); const first = v.getInt32(8, true); while (Atomics.load(a, 0) === 0); return [first, v.getInt32(8, true)]; }, a => later(() => { a[2] = 11; Atomics.store(a, 0, 1); }));
await t("counter from both", async a => { for (let i = 0; i < 100000; i++) Atomics.add(a, 0, 1); while (Atomics.load(a, 1) === 0); return Atomics.load(a, 0); }, a => { for (let i = 0; i < 100000; i++) Atomics.add(a, 0, 1); Atomics.store(a, 1, 1); });
await t("lock", a => { let sum = 0; for (let i = 0; i < 20000; i++) { while (Atomics.compareExchange(a, 0, 0, 1) !== 0); a[1] = a[1] + 1; Atomics.store(a, 0, 0); } while (Atomics.load(a, 2) === 0); return a[1]; }, a => { for (let i = 0; i < 20000; i++) { while (Atomics.compareExchange(a, 0, 0, 1) !== 0); a[1] = a[1] + 1; Atomics.store(a, 0, 0); } Atomics.store(a, 2, 1); });
await t("growable", async (a, m) => { const g = new SharedArrayBuffer(8, { maxByteLength: 64 }); const v = new Int32Array(g); const before = v.length; g.grow(32); return [before, v.length, g.byteLength, g.growable]; }, () => {});
await t("length of a view that follows", a => { const g = new ArrayBuffer(8, { maxByteLength: 64 }); const v = new Uint8Array(g); let n = 0; for (let i = 0; i < v.length; i++) { if (i === 4) g.resize(16); n++; } g.resize(2); return [n, v.length, v[5]]; }, () => {});
await t("detached by transfer", a => { const b = new ArrayBuffer(8); const v = new Uint8Array(b); v[0] = 1; const first = v.length; structuredClone(b, { transfer: [b] }); return [first, v.length, v[0], b.byteLength, b.detached]; }, () => {});
await t("detached in a loop", a => { const b = new ArrayBuffer(8); const v = new Uint8Array(b).fill(1); let sum = 0; for (let i = 0; i < v.length; i++) { sum += v[i]; if (i === 2) b.transfer(); } return [sum, v.length]; }, () => {});
await t("detached by a callback", a => { const b = new ArrayBuffer(8); const v = new Uint8Array(b).fill(1); return [v.map((x, i) => { if (i === 1) b.transfer(); return x; }).join(), v.length]; }, () => {});
await t("detached in conversion", a => { const b = new ArrayBuffer(8); const v = new Uint8Array(b); v[0] = { valueOf() { b.transfer(); return 5; } }; return [v.length, v[0]]; }, () => {});
