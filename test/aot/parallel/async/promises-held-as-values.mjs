// What settles with a promise that is no thenable holds the promise itself, whoever takes it.
import { runInNewContext } from "node:vm";
const makers = {
  plain: () => Promise.resolve(9),
  nullproto: () => Object.setPrototypeOf(Promise.resolve(9), null),
  nullprotoWithConstructor: () => Object.assign(Object.setPrototypeOf(Promise.resolve(9), null), { constructor: Promise }),
  object: () => Object.setPrototypeOf(Promise.resolve(9), Object.prototype),
  ownUndefined: () => Object.assign(Promise.resolve(9), { then: undefined }),
  ownFive: () => Object.assign(Promise.resolve(9), { then: 5 }),
  ownDeleted: () => { const p = Object.assign(Promise.resolve(9), { then: 5 }); delete p.then; return p; },
  ownThen: () => Object.assign(Promise.resolve(9), { then(y) { y("own"); } }),
  getter: () => Object.defineProperty(Promise.resolve(9), "then", { get() { return undefined; } }),
  pending: () => Object.setPrototypeOf(new Promise(() => {}), null),
  pendingOwn: () => Object.assign(new Promise(() => {}), { then: null }),
  rejected: () => { const p = Promise.reject(8); p.catch(() => {}); return Object.setPrototypeOf(p, null); },
  rejectedOwn: () => { const p = Promise.reject(8); p.catch(() => {}); return Object.assign(p, { then: undefined }); },
  frozen: () => Object.freeze(Object.setPrototypeOf(Promise.resolve(9), null)),
  proxied: () => new Proxy(Object.setPrototypeOf(Promise.resolve(9), null), {}),
  subclass: () => Sub.resolve(9),
  subclassWithout: () => Object.setPrototypeOf(Sub.resolve(9), null),
  subclassOwn: () => Object.assign(Sub.resolve(9), { then: undefined }),
  otherRealm: () => otherPromise(),
  otherRealmWithout: () => Object.setPrototypeOf(otherPromise(), null),
  otherRealmOwn: () => Object.assign(otherPromise(), { then: undefined }),
  thenless: () => ({ then: undefined }),
  list: () => [1],
};
class Sub extends Promise {}
let realm = null;
function otherPromise() { try { realm ??= runInNewContext("({ make() { return Promise.resolve(9); } })"); return realm.make(); } catch { return Promise.resolve(9); } }
const never = async v => v;
const bound = Promise.resolve.bind(Promise);
async function deep(v) { return never(v); }
async function both(v) { return await never(v); }
async function late(v) { await null; return v; }
async function inTry(v) { try { return v; } finally { count++; } }
async function* each(v) { yield v; return v; }
class Holder { async m(v) { return v; } static async s(v) { return v; } }
const holder = new Holder(), record = { async f(v) { return v; }, g: v => Promise.resolve(v) };
let count = 0;
const handlers = {
  never: v => never(v), async: async v => v, wrap: v => Promise.resolve(v), bound, constructed: v => new Promise(r => r(v)), value: v => v, notTail: v => { const p = never(v); return p; }, late, deep, both, inTry,
  method: v => holder.m(v), fixed: v => Holder.s(v), field: v => record.f(v), fieldWrap: v => record.g(v), afterThen: v => Promise.resolve().then(() => v), all: v => Promise.all([never(v)]), settled: v => Promise.allSettled([never(v)]), race: v => Promise.race([never(v)]), any: v => Promise.any([never(v)]), finallyOf: v => Promise.resolve().finally(() => never(v)), caught: v => Promise.reject(1).catch(() => never(v)), generator: v => each(v).next(), tried: v => Promise.try(() => never(v)), withResolvers: v => { const w = Promise.withResolvers(); w.resolve(v); return w.promise; },
};
const takers = {
  await: async (h, p) => await h(p),
  awaitVariable: async (h, p) => { const r = h(p); return [await r]; },
  awaitInTry: async (h, p) => { try { const r = await h(p); return [r]; } catch (e) { return ["e", e]; } },
  return: async (h, p) => [await (async () => h(p))()],
  returnAwait: async (h, p) => [await (async () => await h(p))()],
  then: (h, p) => Promise.resolve().then(() => h(p)).then(v => [v]),
  thenTwice: (h, p) => Promise.resolve().then(() => h(p)).then(v => [v, 1]).then(v => v),
  thenOfArgument: (h, p) => Promise.resolve([p]).then(([q]) => h(q)).then(v => [v]),
  all: (h, p) => Promise.all([0, 1].map(() => Promise.resolve().then(() => h(p)))),
  race: (h, p) => Promise.race([Promise.resolve().then(() => h(p))]).then(v => [v]),
  any: (h, p) => Promise.any([Promise.resolve().then(() => h(p))]).then(v => [v]),
  finally: (h, p) => Promise.resolve([p]).finally(() => h(p)),
  settled: (h, p) => Promise.allSettled([Promise.resolve().then(() => h(p))]).then(([r]) => [r.value ?? r.reason]),
  catch: (h, p) => Promise.reject(0).catch(() => h(p)).then(v => [v]),
  forAwait: async (h, p) => { const out = []; for await (const v of [h(p)]) out.push(v); return out; },
  delegated: async (h, p) => { const out = []; for await (const v of (async function* () { yield h(p); })()) out.push(v); return out; },
  loop: async (h, p) => { const out = []; for (let i = 0; i < 3; i++) { const v = await h(p); out.push(v); } return out; },
  literal: async (h, p) => { const literal = { h }; return [await literal.h(p)]; },
};
const limit = p => Promise.race([p, new Promise(r => setTimeout(r, 60, "never"))]);
function tell(r, p) {
  const one = v => v === p ? "itself" : Array.isArray(v) ? "[" + v.map(one).join() + "]" : v && typeof v === "object" && "done" in v ? "{" + one(v.value) + v.done + "}" : v && typeof v === "object" && "status" in v ? v.status + one(v.value) : typeof v === "object" ? "object" : typeof v + String(v);
  return one(r);
}
process.on("unhandledRejection", () => {});
const lines = [];
const runs = [];
for (const [m, make] of Object.entries(makers)) for (const [h, handler] of Object.entries(handlers)) for (const [t, taker] of Object.entries(takers)) {
  const p = make();
  let r;
  try { r = taker(handler, p); } catch (e) { lines.push([m, h, t, "!" + e.constructor.name].join(" ")); continue; }
  runs.push(limit(r).then(v => lines.push([m, h, t, tell(v, p)].join(" ")), e => lines.push([m, h, t, "!" + (e === p ? "itself" : e?.constructor?.name ?? String(e))].join(" "))));
}
await Promise.all(runs);
const told = new Map();
for (const line of lines.sort()) {
  const [m, h, t, ...said] = line.split(" ");
  told.set(m + " " + h, (told.get(m + " " + h) ?? "") + " " + t + ":" + said.join(" "));
}
console.log(lines.length, count > 0);
for (const [title, said] of told) console.log(title + said);
