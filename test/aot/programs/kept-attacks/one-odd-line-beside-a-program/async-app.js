// One odd line that never runs stands beside a program that does not change: async app. It prints what plain Bun prints.
import { Vec, Body, Heavy, Ghost, makeWorld } from "./own.js";
const world = makeWorld(9);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function first() { return world[0]; }
async function viaAwait() { return await first(); }
async function position() { return first().then(b => b.pos); }
async function twice() { return first().then(b => b).then(b => b.vel); }
function resolved() { return Promise.resolve(world[1]); }
function made() { return new Promise(resolve => resolve(world[2])); }
function later() { return new Promise(resolve => setTimeout(() => resolve(world[3]), 1)); }
function maybe(flag) { return flag ? world[4] : first(); }
async function failing() { throw new Heavy("bad", new Vec(0, 0), new Vec(0, 0), 1); }
async function* stream() { for (const b of world) yield b; }
class Store {
  constructor() { this.items = new Map(); }
  async get(key) { return this.items.get(key); }
  async put(key, value) { this.items.set(key, value); return this; }
  async total() { let sum = 0; for (const b of this.items.values()) sum += (await this.weigh(b)); return sum; }
  async weigh(b) { await sleep(0); return b.weight(); }
}
const handlers = [async b => b.step(1), b => b.step(2), async b => (await first()).step(3)];
async function main() {
  let sum = 0;
  const a = await first(); sum += a.hits;
  const b = await viaAwait(); sum += b.hits;
  const c = await position(); sum += c.x;
  const d = await twice(); sum += d.y;
  const e = await resolved(); sum += e.hits;
  const f = await made(); sum += f.hits;
  const g = await later(); sum += g.hits;
  const h = await maybe(true); sum += h.hits;
  const i = await maybe(false); sum += i.hits;
  const [j, k, l] = await Promise.all([first(), resolved(), made()]); sum += j.hits + k.hits + l.hits;
  const m = await Promise.all(world.map(async x => x.weight())); sum += m[0];
  const n = await Promise.race([later(), made()]); sum += n.hits;
  const o = await Promise.allSettled([first(), failing()]); sum += o.length;
  const p = await Promise.any([failing(), first()]); sum += p.hits;
  try { await failing(); } catch (error) { sum += error.mass; }
  const q = await failing().catch(error => error); sum += q.mass;
  for await (const x of stream()) sum += x.hits;
  const store = new Store();
  const r = await store.put("a", world[5]); sum += r.items.size;
  const s = await store.get("a"); sum += s.hits;
  const t = await store.total(); sum += t;
  for (const handler of handlers) { const u = await handler(world[6]); sum += u.hits; }
  const v = await world[7]; sum += v.hits;
  const w = await 1; sum += w;
  await sleep(1);
  const x = await new Promise(resolve => process.nextTick(resolve, world[8])); sum += x.hits;
  const y = await first().finally(() => {}); sum += y.hits;
  return sum;
}
console.log(await main());
