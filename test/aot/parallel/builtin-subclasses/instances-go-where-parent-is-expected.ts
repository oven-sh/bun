// Instances of classes below built-in classes are handed to functions that take the parent, are tested for the parent, and every method of the parent is called on them, where the compiler sees the type of the class.
const lines: string[] = [];
function attempt(title: string, read: () => unknown) {
  try { lines.push(title + " " + String(read())); } catch (e) { lines.push(title + " throws " + (e as Error).name); }
}
class OnMap extends Map<string, number> { count = 1; twice(): number { return this.count * 2; } }
class OnSet extends Set<number> { count = 1; twice(): number { return this.count * 2; } }
class OnWeakMap extends WeakMap<object, number> { count = 1; twice(): number { return this.count * 2; } }
class OnWeakSet extends WeakSet<object> { count = 1; twice(): number { return this.count * 2; } }
class OnError extends Error { count = 1; twice(): number { return this.count * 2; } }
class OnTypeError extends TypeError { count = 1; twice(): number { return this.count * 2; } }
class OnDate extends Date { count = 1; twice(): number { return this.count * 2; } }
class OnRegExp extends RegExp { count = 1; twice(): number { return this.count * 2; } }
class OnBytes extends Uint8Array { count = 1; twice(): number { return this.count * 2; } }
class OnBuffer extends ArrayBuffer { count = 1; twice(): number { return this.count * 2; } }
class OnView extends DataView<ArrayBuffer> { count = 1; twice(): number { return this.count * 2; } }
class OnText extends String { count = 1; twice(): number { return this.count * 2; } }
class OnNumber extends Number { count = 1; twice(): number { return this.count * 2; } }
const anchor = {};

function takesMap(m: Map<string, number>): string { return m.size + ":" + m.get("a") + ":" + m.has("b") + ":" + [...m.keys()].join(); }
function takesReadonlyMap(m: ReadonlyMap<string, number>): number { let sum = 0; m.forEach(value => { sum += value; }); for (const [, value] of m) sum += value; return sum; }
function takesSet(s: Set<number>): string { return s.size + ":" + s.has(1) + ":" + [...s].join(); }
function takesIterable(i: Iterable<unknown>): number { let n = 0; for (const _ of i) n++; return n; }
function takesError(e: Error): string { return e.name + ":" + e.message + ":" + (e instanceof TypeError) + ":" + String(e); }
function takesDate(d: Date): string { return d.getTime() + ":" + d.toISOString() + ":" + (+d); }
function takesRegExp(r: RegExp): string { r.lastIndex = 0; return r.source + ":" + r.test("xab") + ":" + "xab".replace(r, "-") + ":" + "a,b".split(r).length; }
function takesBytes(b: Uint8Array): string { return b.length + ":" + b[0] + ":" + b.join() + ":" + b.byteLength; }
function takesView(v: ArrayBufferView): number { return v.byteLength + v.byteOffset; }
function takesBuffer(b: ArrayBuffer): string { return b.byteLength + ":" + new Uint8Array(b).length; }
function takesObject(o: object): string { return Object.prototype.toString.call(o) + ":" + typeof o; }
function takesUnknown(u: unknown): string {
  return [u instanceof Map, u instanceof Set, u instanceof WeakMap, u instanceof WeakSet, u instanceof Error, u instanceof TypeError, u instanceof Date, u instanceof RegExp, u instanceof Uint8Array, u instanceof ArrayBuffer, u instanceof DataView, u instanceof String, u instanceof Number, ArrayBuffer.isView(u), Array.isArray(u), Error.isError(u)].map(Number).join("");
}

function map(k: OnMap) {
  attempt("map twice", () => k.twice());
  attempt("map as the parent", () => takesMap(k) + takesReadonlyMap(k) + takesIterable(k) + takesObject(k) + takesUnknown(k));
  attempt("map tests", () => [k instanceof Map, k instanceof OnMap, k instanceof Object].join());
  attempt("map forEach", () => { let t = ""; k.forEach((value, key, whole) => { t += key + value + (whole === k); }); return t; });
  attempt("map forEach with this", () => { let t = ""; k.forEach(function (this: OnMap, value) { t += value + this.count; }, k); return t; });
  attempt("map iterators", () => [...k.entries()].join("|") + [...k.values()].join() + [...k].length + k[Symbol.iterator]().next().value);
  attempt("map copies", () => new Map(k).size + new OnMap(k).size + Array.from(k).length + Object.fromEntries(k).a + structuredClone(k).size);
  attempt("map through the prototype", () => Map.prototype.get.call(k, "a") + ":" + Map.prototype.has.call(k, "a") + ":" + Reflect.get(Map.prototype, "size", k) + ":" + Map.prototype.forEach.call(k, () => {}));
  attempt("map changes", () => k.set("c", 3).set("d", 4).delete("c") + ":" + k.size + ":" + k.getOrInsert("e", 5) + ":" + k.getOrInsertComputed("f", () => 6));
  attempt("map for a set", () => Set.prototype.has.call(k as any, "a"));
  attempt("map cleared", () => { k.clear(); return k.size + k.twice(); });
}
function set(k: OnSet, other: OnSet) {
  attempt("set twice", () => k.twice());
  attempt("set as the parent", () => takesSet(k) + takesIterable(k) + takesObject(k) + takesUnknown(k));
  attempt("set forEach", () => { let t = ""; k.forEach((value, same, whole) => { t += value + same + (whole === k ? "w" : "?"); }); return t; });
  attempt("set iterators", () => [...k.entries()].join("|") + [...k.values()].join() + [...k.keys()].join() + [...k].length);
  attempt("set with sets", () => [...k.union(other)].join() + "|" + [...k.intersection(other)].join() + "|" + [...k.difference(other)].join() + "|" + [...k.symmetricDifference(other)].join() + "|" + k.isSubsetOf(other) + k.isSupersetOf(other) + k.isDisjointFrom(other));
  attempt("sets with it", () => [...new Set([1, 9]).union(k)].join() + "|" + new Set([1]).isSubsetOf(k) + (k.union(other) instanceof OnSet));
  attempt("set copies", () => new Set(k).size + new OnSet(k).size + Array.from(k).length + structuredClone(k).size);
  attempt("set through the prototype", () => Set.prototype.has.call(k, 1) + ":" + Reflect.get(Set.prototype, "size", k) + ":" + Set.prototype.forEach.call(k, () => {}));
  attempt("set changes", () => k.add(7).add(8).delete(7) + ":" + k.size);
  attempt("set for a map", () => Map.prototype.get.call(k as any, 1));
}
function weak(m: OnWeakMap, s: OnWeakSet) {
  attempt("weak map", () => m.twice() + ":" + m.get(anchor) + m.has(anchor) + m.set(anchor, 2).get(anchor) + m.delete(anchor) + takesObject(m) + takesUnknown(m) + WeakMap.prototype.has.call(m, anchor));
  attempt("weak set", () => s.twice() + ":" + s.has(anchor) + s.add(anchor).has(anchor) + s.delete(anchor) + takesObject(s) + takesUnknown(s) + WeakSet.prototype.has.call(s, anchor));
}
function error(k: OnError, t: OnTypeError) {
  attempt("error", () => k.twice() + takesError(k) + takesObject(k) + takesUnknown(k) + Error.prototype.toString.call(k) + typeof k.stack + (k.cause as number));
  attempt("type error", () => t.twice() + takesError(t) + takesObject(t) + takesUnknown(t) + (t instanceof Error) + (t instanceof TypeError) + (t instanceof OnError));
  attempt("error thrown", () => { try { throw k; } catch (e) { return e instanceof Error ? takesError(e) : "?"; } });
  attempt("error rejected", () => { Promise.reject(t).catch(e => lines.push("caught " + takesError(e) + (e as OnTypeError).twice())); return "later"; });
  attempt("error as a cause", () => takesError(new Error("outer", { cause: k }).cause as Error) + new AggregateError([k, t]).errors.length);
}
function date(k: OnDate) {
  attempt("date", () => k.twice() + takesDate(k) + takesObject(k) + takesUnknown(k) + k.getUTCFullYear() + k.getUTCDay() + k.valueOf() + JSON.stringify(k) + k.toJSON() + Date.prototype.getTime.call(k));
  attempt("date changes", () => k.setTime(5) + ":" + k.setUTCHours(1) + ":" + k.getTime() + ":" + (k > new Date(0)) + ":" + (Number(k) - Number(new OnDate(1))) + ":" + new Date(k).getTime());
  attempt("date as a text", () => typeof `${k}` + typeof (k + "") + k[Symbol.toPrimitive]("number"));
}
function regExp(k: OnRegExp) {
  attempt("regexp", () => k.twice() + takesRegExp(k) + takesObject(k) + takesUnknown(k) + k.flags + k.global + k.exec("ab")?.index + String(k) + RegExp.prototype.test.call(k, "b"));
  attempt("regexp with texts", () => "aXbXc".split(k).join() + "ab".match(k)?.length + "ab".search(k) + "ab".replaceAll(new OnRegExp("a", "g"), "-") + [..."aa".matchAll(new OnRegExp("a", "g"))].length);
}
function bytes(k: OnBytes, b: OnBuffer, v: OnView) {
  attempt("bytes", () => k.twice() + takesBytes(k) + takesView(k) + takesIterable(k) + takesObject(k) + takesUnknown(k) + k.at(-1) + k.indexOf(2) + k.includes(3) + k.reduce((a, c) => a + c, 0) + k.subarray(1).length + k.slice(1).join() + k.map(x => x * 2).join() + new Uint8Array(k).length + new TextDecoder().decode(k).length + Buffer.from(k).length);
  attempt("bytes change", () => { k[0] = 9; k.set([7], 1); k.fill(1, 2); k.reverse(); k.sort(); return k.join() + Reflect.get(Object.getPrototypeOf(Uint8Array.prototype), "length", k); });
  attempt("buffer", () => b.twice() + takesBuffer(b) + takesObject(b) + takesUnknown(b) + b.slice(1).byteLength + new DataView(b).byteLength + b.resizable + structuredClone(b).byteLength);
  attempt("view", () => v.twice() + takesView(v) + takesObject(v) + takesUnknown(v) + v.getInt8(0) + (v.setInt16(0, 258), v.getUint8(1)) + v.buffer.byteLength);
}
function wrappers(t: OnText, n: OnNumber) {
  attempt("text", () => t.twice() + takesObject(t) + takesUnknown(t) + t.length + t.charAt(1) + t.slice(1) + t.indexOf("x") + t.split("e").length + [...t].length + t.concat("!") + (t + "?") + t.valueOf() + String.prototype.toUpperCase.call(t) + JSON.stringify(t));
  attempt("number", () => n.twice() + takesObject(n) + takesUnknown(n) + n.toFixed(1) + n.toString(2) + (Number(n) + 1) + n.valueOf() + Number.prototype.toFixed.call(n, 2) + JSON.stringify(n));
}
for (let round = 0; round < 3; round++) {
  map(new OnMap([["a", 1], ["b", 2]]));
  set(new OnSet([1, 2, 3]), new OnSet([2, 5]));
  weak(new OnWeakMap([[anchor, 1]]), new OnWeakSet([anchor]));
  error(new OnError("text", { cause: 4 }), new OnTypeError("typed"));
  date(new OnDate(86400000));
  regExp(new OnRegExp("[ab]"));
  bytes(new OnBytes([1, 2, 3]), new OnBuffer(4), new OnView(new ArrayBuffer(4)));
  wrappers(new OnText("text"), new OnNumber(4));
  Bun.gc(true);
}
await Promise.resolve();
console.log(lines.join("\n"));
export {};
