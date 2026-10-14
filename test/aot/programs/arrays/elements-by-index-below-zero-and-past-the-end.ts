// Reads, writes and `in` by index in loops, below zero and past the end: arrays with holes, typed arrays, strings, arguments objects, array-likes, frozen arrays, accessors.
const say = (what: string, got: unknown) => console.log(what + ": " + String(got));
function readAll(a: any, from: number, to: number): string { let s = ""; for (let i = from; i < to; i++) s += "|" + String(a[i]); return s; }
function readByLength(a: any, more: number): string { let s = ""; for (let i = 0; i < a.length + more; i++) s += "|" + String(a[i]); return s; }
function writeAll(a: any, from: number, to: number, v: unknown): void { for (let i = from; i < to; i++) a[i] = v; }
function writeByLength(a: any, more: number, v: unknown): void { const n = a.length + more; for (let i = 0; i < n; i++) a[i] = v; }
function forOf(a: unknown[]): string { let s = ""; for (const x of a) s += "|" + String(x); return s; }
const holes = [1, , 3, , 5]; const doubles = [1.5, 2.5, , 4.5]; const ints = [1, 2, 3]; const mixed = ["a", 1, null, undefined, { toString() { return "o"; } }];
const big: unknown[] = []; big[70000] = "far"; const frozen = Object.freeze(["f", "g"]);
function args(..._: unknown[]) { return arguments; }
const like = { length: 3, 0: "x", 2: "z" }; const withProto = Object.create({ 1: "inherited" }); withProto[0] = "own"; withProto.length = 3;
for (const [name, a] of Object.entries({ holes, doubles, ints, mixed, frozen, text: "héllo", wide: "日本語", u8: new Uint8Array([1, 2, 3]), f64: new Float64Array([1.5, NaN]), i16: new Int16Array([-1, 2]), args: args("p", "q"), like, withProto, empty: [] })) {
  say(name + " by length", readByLength(a, 2));
  say(name + " from below", readAll(a, -2, 2));
}
say("far", readAll(big, 69999, 70002)); say("beyond int32", readAll(ints, 2147483646, 2147483650)); say("beyond uint32", readAll(ints, 4294967294, 4294967298));
say("for of holes", forOf(holes)); say("for of doubles", forOf(doubles as unknown[]));
say("null", (() => { try { return readAll(null, 0, 1); } catch (e) { return (e as Error).constructor.name; } })());
say("a number", readAll(5, 0, 2)); say("a function", readAll(readAll, 0, 2));
{ const a = [1, 2, 3]; writeByLength(a, 3, "w"); say("written past the end", a.join() + " " + a.length); }
{ const a: unknown[] = [1.5, 2.5]; writeAll(a, 0, 3, "s"); say("strings into doubles", a.join()); }
{ const a: unknown[] = [1, 2]; writeAll(a, 0, 2, 1.5); say("doubles into ints", a.join()); }
{ const a: unknown[] = []; writeAll(a, 5, 7, "h"); say("leaving holes", a.join() + " " + a.length); }
{ const a: unknown[] = []; writeAll(a, -2, 1, "n"); say("below nought", a.join() + " " + Object.keys(a).join()); }
{ const a: unknown[] = []; writeAll(a, 4294967294, 4294967297, "b"); say("beyond uint32", a.length + " " + Object.keys(a).join()); }
{ const a = new Uint8Array(3); writeAll(a, -1, 5, 300); say("a typed array", a.join()); }
{ const a = new Float64Array(2); writeAll(a, 0, 2, "7"); say("a string into floats", a.join()); }
{ const o: Record<number, unknown> = {}; writeAll(o, 0, 3, "o"); say("an object", JSON.stringify(o)); }
{ say("frozen", (() => { try { writeAll(frozen, 0, 1, "x"); return "no error"; } catch (e) { return (e as Error).constructor.name; } })() + " " + frozen.join()); }
{ const a = [1, 2, 3]; Object.defineProperty(a, 1, { get() { return "got"; }, set(v) { say("setter", v); } }); say("an accessor", readByLength(a, 0)); writeByLength(a, 0, "v"); say("after", readByLength(a, 0)); }
{ const cow = () => [1, 2, 3]; const a = cow(); writeAll(a, 0, 1, 9); say("copy on write", a.join() + " " + cow().join()); }
function hasAll(a: any, from: number, to: number): string { let s = ""; for (let i = from; i < to; i++) s += i in a ? "1" : "0"; return s; }
function hasByLength(a: any, more: number): string { let s = ""; for (let i = 0; i < a.length + more; i++) s += i in a ? "1" : "0"; return s; }
for (const [name, a] of Object.entries({ holes, doubles, ints, mixed, frozen, u8: new Uint8Array([1, 2, 3]), f64: new Float64Array([1.5, NaN]), args: args("p", "q"), like, withProto, empty: [], text: new String("héllo"), fn: hasAll })) {
  say(name + " has, by length", hasByLength(a, 2));
  say(name + " has, from below", hasAll(a, -2, 2));
}
say("has far", hasAll(big, 69999, 70002)); say("has beyond int32", hasAll(ints, 2147483646, 2147483650)); say("has beyond uint32", hasAll(ints, 4294967294, 4294967298));
for (const bad of [null, undefined, 5, "text", true, Symbol.iterator]) say("in " + String(bad), (() => { try { return hasAll(bad, 0, 1); } catch (e) { return (e as Error).constructor.name; } })());
{ const a: unknown[] = [undefined, null, 0, "", false, NaN]; say("has falsy elements", hasByLength(a, 1)); }
{ class Below extends Array<unknown> {} const a = new Below(); a.length = 4; a[1] = "own"; (Below.prototype as any)[2] = "inherited"; say("has through a prototype", hasByLength(a, 1)); delete (Below.prototype as any)[2]; say("and no more", hasByLength(a, 1)); }
{ const a: unknown[] = [1, 2, 3, 4]; const log = [hasByLength(a, 0)]; delete a[1]; log.push(hasByLength(a, 0)); a.length = 2; log.push(hasAll(a, 0, 4)); a[3] = 1.5; log.push(hasAll(a, 0, 5)); a.pop(); log.push(hasAll(a, 0, 5)); say("has, as the array changes", log.join()); }
{ const a = [1, 2, 3]; let s = ""; for (let i = 0; i < 6; i++) { s += i in a ? "1" : "0"; if (i === 0) a.length = 1; if (i === 3) a[5] = 6; } say("has, changing in the loop", s); }
{ const a = [1, 2, 3]; Object.defineProperty(a, 1, { get() { throw new Error("not called"); } }); say("has an accessor", hasByLength(a, 1)); }
{ const asked: string[] = []; const p = new Proxy([1, , 3], { has(t, k) { asked.push(String(k)); return k in t; } }); say("has, of a proxy", hasAll(p, 0, 4) + " " + asked.join()); }
{ const cow = () => [1, 2, 3]; say("has, copy on write", hasByLength(cow(), 1)); }
{ const seen = (a: unknown[]) => { const log: string[] = []; const note = (how: string) => (x: unknown, i: number) => { log.push(how + i); return x; };
    a.forEach(note("e")); a.map(note("m")); a.filter(note("f")); a.some(x => (note("s")(x, -1), false)); a.every(x => (note("v")(x, -1), true)); a.reduce((n: number, _x, i) => (log.push("r" + i), n), 0); a.reduceRight((n: number, _x, i) => (log.push("R" + i), n), 0);
    log.push(String(a.indexOf(undefined)), String(a.includes(undefined)), String(a.findIndex(x => x === undefined)), String(a.map(x => x).length), String(1 in a.map(x => x)), String(a.filter(() => true).length)); return log.join(" "); };
  say("methods skip holes", seen([1, , 3, , 5])); say("in doubles", seen([1.5, , 3.5])); say("none to skip", seen(["a", undefined, null])); const sparse: unknown[] = []; sparse[3] = "x"; sparse[1000] = "y"; say("sparse", seen(sparse)); }
export {};
