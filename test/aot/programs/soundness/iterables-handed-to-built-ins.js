function print(a, b, c) { let s = "" + a; if (b !== undefined) s += " " + b; if (c !== undefined) s += " " + c; console.log(s); }
let opened = 0, stepped = 0, closed = 0;
function iterable(values) {
  return { [Symbol.iterator]() { opened++; let i = 0; return { next() { stepped++; return i < values.length ? { done: false, value: values[i++] } : { done: true, value: undefined }; }, return() { closed++; return {}; } }; } };
}
function counts() { return opened + "/" + stepped + "/" + closed; }
function kind(v) { return typeof v + " " + String(v); }

async function main() {
  print("Array.from", Array.from(iterable(["a", 1])).map(kind).join("; "), counts());
  print("Array.from mapped", Array.from(iterable([1]), x => "m" + x).map(kind).join("; "), counts());
  print("spread", [...iterable(["b"])].map(kind).join("; "), counts());
  print("call spread", Math.max(...iterable([1, 5])), counts());
  print("new spread", new Array(...iterable(["c", "d"])).length, counts());
  const [first] = iterable(["e", "f"]); print("pattern closes", kind(first), counts());
  const [x, ...rest] = iterable(["g", 2, 3n]); print("pattern rest", kind(x) + "; " + rest.map(kind).join("; "), counts());
  print("Set", [...new Set(iterable(["h", "h", 4]))].map(kind).join("; "), counts());
  print("Map", [...new Map(iterable([["k", "v"], [1, 2]]))].map(e => kind(e[0]) + "=" + kind(e[1])).join("; "), counts());
  try { new Map(iterable([5])); } catch (e) { print("Map closes on a bad entry", e instanceof TypeError, counts()); }
  print("WeakSet", new WeakSet(iterable([{}])) instanceof WeakSet, counts());
  print("fromEntries", JSON.stringify(Object.fromEntries(iterable([["a", "late"], ["b", 2]]))), counts());
  print("groupBy", JSON.stringify(Object.groupBy(iterable([1, 2, 3]), n => (n % 2 ? "odd" : "even"))), counts());
  print("Map.groupBy", Map.groupBy(iterable(["p", "q"]), s => s).size, counts());
  print("all", (await Promise.all(iterable(["i", Promise.resolve(6)]))).map(kind).join("; "), counts());
  print("race", kind(await Promise.race(iterable(["j"]))), counts());
  print("typed array", new Uint8Array(iterable([7, 8])).join(), counts());
  print("typed array from", Float64Array.from(iterable([1.5])).join(), counts());
  print("Iterator.from", Iterator.from(iterable(["l", "m"])).map(s => s + "!").toArray().join(), counts());
  print("flatMap", Iterator.from(iterable([1])).flatMap(() => iterable(["n", "o"])).toArray().join(), counts());
  print("take closes", Iterator.from(iterable([1, 2, 3])).take(1).toArray().join(), counts());
  function* delegate() { const r = yield* iterable(["p"]); return r; }
  print("yield*", [...delegate()].map(kind).join("; "), counts());
  for (const v of iterable(["q", "r"])) { print("break closes", kind(v), counts()); break; }
  try { for (const v of iterable(["s"])) throw "t"; } catch (e) { print("throw closes", kind(e), counts()); }
  outer: for (const a of iterable([1])) for (const b of iterable([2])) continue outer;
  print("continue outer closes", counts());
  print("fromAsync", (await Array.fromAsync(iterable(["u", Promise.resolve("v")]))).map(kind).join("; "), counts());
  for await (const v of iterable([Promise.resolve("w")])) print("for await", kind(v), counts());
  print("union", [...new Set([1]).union({ size: 1, has() { return false; }, keys() { return iterable(["x"])[Symbol.iterator](); } })].map(kind).join("; "), counts());
  print("String.raw", String.raw({ raw: ["y", "z"] }, ...iterable([0])), counts());
  print("concat does not iterate", [].concat(iterable([1])).length, counts());
  print("apply does not iterate", Math.max.apply(null, { length: 1, 0: 9 }), counts());
}
main().catch(e => print("failed", String(e)));
