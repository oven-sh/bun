// Each method of Map, Set, WeakMap, WeakSet and Error on objects of classes below them: in loops, in try blocks, on results of results, typed, through any, and behind a written constructor.
class M extends Map<string, number> { constructor(entries?: [string, number][]) { super(entries); made++; } }
class S extends Set<number> {}
class WM extends WeakMap<object, number> {}
class WS extends WeakSet<object> { constructor() { super(); made++; } }
class E extends Error {}
class TE extends TypeError { constructor(message: string, public extra = 1) { super(message); made++; } }
let made = 0;
const keys = [{}, {}, {}];
function mapWork(m: M): string {
  let out = "";
  for (let i = 0; i < 3; i++) { try { m.set("k" + i, i); out += m.get("k" + i)! + m.size + String(m.has("k" + i)) + String(m.delete("k0")); } catch (e) { out += "threw"; } }
  m.forEach((v, k, self) => { out += k + v + (self === m); });
  for (const [k, v] of m) out += k + v;
  out += [...m.keys()].length + [...m.values()].length + [...m.entries()].length + m.set("z", 1).size + new M([...m]).size + new Map(m).size;
  m.clear(); return out + m.size;
}
function setWork(s: S): string {
  let out = "";
  for (let i = 0; i < 3; i++) { try { out += s.add(i).size + String(s.has(i)) + String(s.delete(0)); } catch (e) { out += "threw"; } }
  s.forEach((v, k, self) => { out += v + k + String(self === s); });
  for (const v of s) out += v;
  out += [...s.keys()].length + [...s.values()].length + [...s.entries()].length + new S(s).size + new Set(s).size + (s as any).union(new Set([9])).size + (s as any).union(new Set([9])).constructor.name;
  s.clear(); return out + s.size;
}
function weakWork(w: WM, x: WS): string {
  let out = "";
  for (const key of keys) { out += String(w.set(key, 1).has(key)) + w.get(key) + String(w.delete(key)) + String(w.has(key)) + String(x.add(key).has(key)) + String(x.delete(key)); }
  return out;
}
function errorWork(e: E | TE): string {
  let out = e.name + e.message + String(e) + (e.stack ? "stack" : "none") + Object.prototype.toString.call(e) + (e instanceof Error) + (e instanceof TypeError) + e.toString().length;
  try { throw e; } catch (caught) { out += String(caught === e) + (caught as Error).message.length; }
  return out + JSON.stringify(Object.keys(e)) + ((Error as any).isError?.(e) ?? true);
}
function loose(value: any): string { try { return String(value.size ?? value.message) + (value.has?.("k1") ?? "") + (value.get?.("k1") ?? ""); } catch (e) { return "threw"; } }
for (let round = 0; round < 4; round++) {
  console.log(mapWork(new M([["a", 1]])), mapWork(new M()), setWork(new S([5, 6])), weakWork(new WM(), new WS()));
  console.log(errorWork(new E("e")), errorWork(new TE("t")), errorWork(new TE("t", 2)));
  console.log(loose(new M([["k1", 4]])), loose(new S([1])), loose(new E("x")), loose(new WM()), made);
}
