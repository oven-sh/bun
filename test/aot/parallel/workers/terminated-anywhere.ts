// A sampler: a Worker runs one kind of work again and again for ever: operations on objects, lists, texts, collections, numbers, classes, closures, generators, promises, JSON, patterns, typed arrays. It is terminated at a moment of the main thread's choice, from at once to a few milliseconds. Wherever the request arrives, the Worker ends. COUNT says how often each.
type Item = { key: number; name: string; tags: string[]; inner: { a: number; b: number } | null };
const item = (i: number): Item => ({ key: i, name: "n" + i, tags: ["t" + (i % 3), "u"], inner: i % 2 ? { a: i, b: -i } : null });
class Base {
  static made = 0;
  #hidden = 1;
  constructor(public id: number) {
    Base.made++;
  }
  get twice(): number {
    return this.id * 2 + this.#hidden;
  }
  describe(): string {
    return `${this.constructor.name}#${this.id}`;
  }
}
class Heir extends Base {
  extra = [1, 2, 3];
  describe(): string {
    return super.describe() + this.extra.length;
  }
}
function* count(n: number): Generator<number> {
  for (let i = 0; i < n; i++) yield i;
}
let sink: unknown;
let posted = 0;
const works: Record<string, (n: number) => unknown> = {
  "object literals": n => { const list: Item[] = []; for (let i = 0; i < n; i++) list.push(item(i)); return list; },
  "spread and rest": n => { let o: Record<string, number> = {}; for (let i = 0; i < n; i++) { const { a, ...rest } = { ...o, a: i, ["k" + (i % 20)]: i }; o = rest; } return o; },
  "Object functions": n => { const o = item(n); for (let i = 0; i < n; i++) sink = [Object.keys(o), Object.values(o), Object.entries(o), Object.assign({}, o), Object.fromEntries(Object.entries(o)), Object.getOwnPropertyNames(o)]; },
  "definitions": n => { for (let i = 0; i < n; i++) { const o = {}; Object.defineProperty(o, "x", { value: i, enumerable: true }); Object.defineProperties(o, { y: { get: () => i }, z: { value: 1, writable: true } }); sink = Object.getOwnPropertyDescriptors(o); } },
  "deletes and dictionaries": n => { const o: Record<string, number> = {}; for (let i = 0; i < n; i++) { o["k" + i] = i; if (i % 3 === 0) delete o["k" + (i >> 1)]; } return o; },
  "for in": n => { const o = Object.fromEntries(Array.from({ length: 50 }, (_, i) => ["k" + i, i])); let s = 0; for (let i = 0; i < n; i++) for (const k in o) s += o[k]; return s; },
  "classes": n => { let s = ""; for (let i = 0; i < n; i++) s = new (i % 2 ? Heir : Base)(i).describe() + new Heir(i).twice; return s; },
  "classes made in a loop": n => { for (let i = 0; i < n; i++) sink = new (class Local { static tag = i; value = i; method() { return this.value; } })().method(); },
  "closures": n => { const fs: (() => number)[] = []; for (let i = 0; i < n; i++) fs.push(() => i + fs.length); return fs.reduce((s, f) => s + f(), 0); },
  "bound functions": n => { function add(this: { base: number }, x: number) { return this.base + x; } let s = 0; for (let i = 0; i < n; i++) s += add.bind({ base: i })(1) + add.call({ base: 1 }, i) + add.apply({ base: 2 }, [i]); return s; },
  "list methods": n => { const list = Array.from({ length: n }, (_, i) => i); return [list.map(x => x * 2), list.filter(x => x % 2), list.reduce((a, b) => a + b, 0), list.slice(1, -1), list.concat(list), list.indexOf(n - 1), list.includes(-1), list.find(x => x === n), list.some(x => x < 0), list.every(x => x >= 0), list.flatMap(x => [x, x]), [...list].reverse(), list.join(",").length, list.toSorted((a, b) => b - a), list.with(0, 1), list.at(-1)]; },
  "list growth": n => { const a: number[] = [], b: unknown[] = [], c: number[] = []; for (let i = 0; i < n; i++) { a.push(i); b.unshift(i % 2 ? i : "s"); c[i * 2] = i + 0.5; if (i % 7 === 0) a.splice(i >> 1, 1, i, i); if (i % 500 === 0) b.length = 0; } return [a, b, c]; },
  "sorts": n => Array.from({ length: n }, (_, i) => item((i * 7919) % n)).sort((x, y) => x.key - y.key || x.name.localeCompare(y.name)),
  "destructuring": n => { let s = 0; for (let i = 0; i < n; i++) { const [a, , b = 5, ...rest] = [i, 1, undefined, 3, 4]; const { key, inner: { a: c = 0 } = { a: 1 }, tags: [first] } = { ...item(i), inner: undefined } as any; s += a + b + rest.length + key + c + first.length; } return s; },
  "texts": n => { let s = ""; for (let i = 0; i < n; i++) { s += "p" + i; if (s.length > 5000) s = s.slice(-100).toUpperCase().padStart(120, "*").trim().replaceAll("P", "q").split("q").join("-").substring(3).concat("z").repeat(2).normalize(); } return s; },
  "text searches": n => { const t = "the quick brown fox ".repeat(50); let s = 0; for (let i = 0; i < n; i++) s += t.indexOf("fox", i % 500) + t.lastIndexOf("the") + +t.includes("brown") + +t.startsWith("the") + t.charCodeAt(i % 100) + t.codePointAt(3)! + t.at(-1)!.length + t.localeCompare("u"); return s; },
  "templates and numbers": n => { let s = ""; for (let i = 0; i < n; i++) s = `${i}:${i / 3}:${(i * 1.5).toFixed(2)}:${i.toString(16)}:${Number("1" + i)}:${parseInt(i + "px")}:${parseFloat("1." + i)}:${BigInt(i) * 3n}:${Math.hypot(i, 3)}`; return s; },
  "patterns": n => { const t = "a1b22c333 2026-10-23 x=y; k=v"; let s = 0; for (let i = 0; i < n; i++) s += t.match(/\d+/g)!.length + t.replace(/(\w)=(\w)/g, "$2=$1").length + (/(?<y>\d{4})-(?<m>\d\d)/.exec(t)!.groups!.y.length) + t.split(/[ ;]+/).length + [...t.matchAll(/[a-c]/g)].length + +new RegExp("c" + (i % 3)).test(t) + t.search(/x/); return s; },
  "JSON": n => { const list = Array.from({ length: 50 }, (_, i) => item(i)); for (let i = 0; i < n; i++) sink = JSON.parse(JSON.stringify(list, (i % 2 ? null : (_: string, v: unknown) => v) as any, i % 3 ? 0 : 2), i % 5 ? undefined : (_: string, v: unknown) => v); },
  "typed JSON": n => { const text = JSON.stringify(Array.from({ length: 50 }, (_, i) => item(i))); let s = 0; for (let i = 0; i < n; i++) for (const each of JSON.parse(text) as Item[]) s += each.key + each.tags.length + (each.inner?.a ?? 0); return s; },
  "Maps": n => { const m = new Map<unknown, unknown>(); for (let i = 0; i < n; i++) { m.set(i, i); m.set("k" + i, item(i)); m.set(i + 0.5, null); if (i % 3 === 0) m.delete(i >> 1); sink = m.get("k" + (i >> 1)); sink = m.has(i); } return [...m.keys()].length + [...m.entries()].length; },
  "Sets": n => { const s = new Set<unknown>(); for (let i = 0; i < n; i++) { s.add(i % 100); s.add("s" + i); s.add(item(i)); if (i % 5 === 0) s.delete("s" + (i >> 1)); } return new Set([...s].slice(0, 50)).union(new Set([1, 2])).size; },
  "Maps of constants": n => { let s = 0; for (let i = 0; i < n; i++) { const m = new Map([["a", 1], ["b", 2], ["c", 3]]); m.set("d" + (i % 3), i); for (const [k, v] of m) s += k.length + v; const t = new Set(["x", "y", "z"]); t.add("w" + i); s += t.size; } return s; },
  "groupings": n => { const list = Array.from({ length: n }, (_, i) => item(i)); return [Object.groupBy(list, x => x.tags[0]), Map.groupBy(list, x => x.key % 3)]; },
  "weak collections": n => { const w = new WeakMap<object, number>(), v = new WeakSet<object>(), r: WeakRef<object>[] = []; for (let i = 0; i < n; i++) { const o = item(i); w.set(o, i); v.add(o); r.push(new WeakRef(o)); sink = w.get(o); } return r.length; },
  "typed arrays": n => { const f = new Float64Array(n), u = new Uint8Array(n), b = new BigInt64Array(16); for (let i = 0; i < n; i++) { f[i] = i / 3; u[i] = i; b[i % 16] = BigInt(i); } return [f.map(x => x * 2), u.subarray(1).slice(2), f.sort(), u.fill(1, 2), new DataView(f.buffer).getFloat64(8), Array.from(u.slice(0, 9)), new Uint16Array(u.buffer, 0, n >> 2), f.toSorted(), u.indexOf(3), new Uint8Array(new ArrayBuffer(8, { maxByteLength: 64 }))]; },
  "Buffers": n => { let s = 0; for (let i = 0; i < n; i++) { const b = Buffer.from("text " + i); s += b.toString("hex").length + b.toString("base64").length + Buffer.concat([b, b]).length + b.readUInt8(0) + b.indexOf("x") + Buffer.byteLength("é" + i) + +b.subarray(1).equals(b.subarray(1)); } return s; },
  "generators": n => { let s = 0; for (const v of count(n)) s += v; s += [...count(50)].length + Math.max(...count(50)); const it = count(3); it.next(); it.return(1); return s; },
  "iterator helpers": n => count(n).map(x => x * 2).filter(x => x % 3 === 0).take(1000).drop(2).flatMap(x => [x, x]).toArray(),
  "own iterables": n => { const it = { *[Symbol.iterator]() { yield* count(n); } }; let s = 0; for (const v of it) s += v; const [a, b] = it; return s + a + b + Array.from(it).length + new Set(it).size; },
  "throws and catches": n => { let s = 0; for (let i = 0; i < n; i++) { try { if (i % 2) throw new RangeError("r" + i); (null as any).x; } catch (e) { s += (e as Error).message.length; } finally { s++; } } return s; },
  "stacks": n => { let s = 0; for (let i = 0; i < n / 10; i++) s += new Error("e").stack!.length; return s; },
  "proxies and Reflect": n => { const p = new Proxy(item(1), { get: (t, k, r) => Reflect.get(t, k, r), has: () => true, ownKeys: t => Reflect.ownKeys(t) }); let s = 0; for (let i = 0; i < n; i++) s += p.key + +("zz" in p) + Object.keys(p).length + Reflect.ownKeys(p).length; return s; },
  "symbols": n => { const o: Record<symbol, number> = {}; for (let i = 0; i < n; i++) { const y = i % 2 ? Symbol("s" + i) : Symbol.for("f" + (i % 10)); o[y] = i; sink = y.description; if (i % 100 === 0) sink = Object.getOwnPropertySymbols(o); } },
  "dates and Intl": n => { let s = 0; for (let i = 0; i < n / 10; i++) s += new Date(i * 1e7).toISOString().length + new Date(2026, i % 12, 1).getDay() + new Intl.NumberFormat("en").format(i).length + (i).toLocaleString().length + Date.parse("2026-10-23T00:00:00Z"); return s; },
  "bigints": n => { let b = 1n; for (let i = 1; i < n; i++) { b = (b * BigInt(i) + 7n) % (2n ** 200n); sink = b.toString(36); } return BigInt.asUintN(64, b); },
  "clones": n => { const list = Array.from({ length: 30 }, (_, i) => item(i)); for (let i = 0; i < n / 10; i++) sink = structuredClone({ list, map: new Map([[1, list]]), date: new Date(i) }); },
  "arguments and defaults": n => { function f(a = 1, b = a + 1, ...c: number[]) { return a + b + c.length + arguments.length; } let s = 0; for (let i = 0; i < n; i++) s += f() + f(i) + f(i, undefined, 1, 2) + f(...[1, 2, 3, 4]); return s; },
  "getters, setters, statics": n => { const o = { _v: 0, get v() { return this._v; }, set v(x: number) { this._v = x + 1; } }; for (let i = 0; i < n; i++) { o.v = o.v + i; Base.made += o.v % 2; } return o.v; },
  "optional chains": n => { let s = 0; for (let i = 0; i < n; i++) { const x = item(i); s += (x.inner?.a ?? -1) + (x.tags?.[5]?.length ?? 0) + ((x as any).nothing?.() ?? 1) + (x.inner ??= { a: 0, b: 0 }).b; } return s; },
  "labels and switches": n => { let s = 0; outer: for (let i = 0; i < n; i++) { for (let j = 0; j < 5; j++) { switch ((i + j) % 4) { case 0: continue outer; case 1: s++; break; case 2: s += 2; default: s--; } if (s > 1e9) break outer; } } return s; },
  "console and inspect": n => { for (let i = 0; i < n / 20; i++) sink = Bun.inspect(item(i)) + Bun.inspect(new Map([[1, new Heir(i)]])) + String(new Heir(i)) + JSON.stringify(new Heir(i)); },
  "messages": n => { for (let i = 0; i < n / 10 && posted < 5000; i++, posted++) postMessage(item(i)); },
  "collections of the heap": n => { for (let i = 0; i < 3; i++) { sink = Array.from({ length: n }, (_, k) => item(k)); Bun.gc(true); } },
};
const asyncWorks: Record<string, (n: number) => Promise<unknown>> = {
  "awaits": async n => { let s = 0; for (let i = 0; i < n; i++) s += await i + (await Promise.resolve(i)) + (await { then(r: (v: number) => void) { r(1); } } as unknown as number); return s; },
  "promise functions": async n => { for (let i = 0; i < n / 10; i++) sink = [await Promise.all([1, Promise.resolve(2)]), await Promise.allSettled([Promise.reject(1), 2]), await Promise.race([1, 2]), await Promise.any([Promise.reject(0), 3]), Promise.withResolvers()]; },
  "async generators": async n => { async function* g() { for (let i = 0; i < n; i++) yield i; } let s = 0; for await (const v of g()) s += v; return s; },
  "async throws": async n => { let s = 0; for (let i = 0; i < n; i++) { try { await (async () => { await 0; throw new Error("e" + i); })(); } catch { s++; } finally { s++; } } return s; },
  "timers": async n => { for (let i = 0; i < n / 100; i++) { await new Promise(r => setTimeout(r, 0)); await new Promise(r => setImmediate(r)); await new Promise<void>(r => queueMicrotask(r)); await new Promise<void>(r => process.nextTick(r)); } },
};

if (Bun.isMainThread) {
  const rounds = Number(process.env.COUNT ?? 3);
  const only = process.env.ONLY;
  const names = [...Object.keys(works), ...Object.keys(asyncWorks)].filter(name => !only || name === only);
  const width = 8;
  let closed = 0;
  const one = async (name: string, round: number) => {
    const worker = new Worker(new URL(import.meta.url));
    worker.onerror = event => (console.log(name, "ERROR", event.message.split("\n").find(line => /rror/.test(line))), event.preventDefault());
    const isClosed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
    await new Promise<void>(resolve => {
      worker.onmessage = event => event.data === "works" && resolve();
      worker.postMessage(name);
    });
    const delay = [0, 0, 1, 2, 3, 5, 8, 13][round % 8];
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    worker.terminate();
    const slow = setTimeout(() => console.log(name, "IS NOT CLOSED 20 s BEHIND terminate(), delay", delay), 20_000);
    await isClosed;
    clearTimeout(slow);
    closed++;
  };
  const jobs = names.flatMap(name => Array.from({ length: rounds }, (_, round) => [name, round] as const));
  let next = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    while (next < jobs.length) await one(...jobs[next++]);
  }));
  console.log("closed:", closed === jobs.length);
} else {
  addEventListener("message", async (event: MessageEvent<string>) => {
    postMessage("works");
    const name = event.data;
    if (name in works) for (;;) sink = works[name](2000);
    for (;;) sink = await asyncWorks[name](2000);
  });
}
