// Loops over o.values(), o.keys() and o.entries() where the read of the method, the call, the opening of the iteration, a step or the body throws, with the call inside or outside the `try` that encloses the loop. An error is caught by the handler that encloses the operation that throws, and by no other.
const log = [];
function callOutside(o) { const it = o.values(); try { for (const v of it) log.push(v); } catch { return "caught"; } return "done"; }
function callInside(o) { try { for (const v of o.values()) log.push(v); } catch { return "caught"; } return "done"; }
function entriesOutside(o) { const it = o.entries(); try { for (const [k, v] of it) log.push(k + "=" + v); } catch { return "caught"; } return "done"; }
function entriesInside(o) { try { for (const [k, v] of o.entries()) log.push(k + "=" + v); } catch { return "caught"; } return "done"; }
function noHandler(o) { for (const k of o.keys()) log.push(k); return "done"; }
function twoHandlers(o) { try { const it = o.keys(); try { for (const k of it) log.push(k); } catch { return "inner"; } } catch { return "outer"; } return "done"; }
function withFinally(o) { try { for (const v of o.values()) log.push(v); } finally { log.push("finally"); } return "done"; }
function bodyThrows(o) { try { for (const v of o.values()) { log.push(v); if (log.length === 2) throw new Error("body"); } } catch (error) { return "caught " + (error instanceof TypeError ? "TypeError" : error.message); } return "done"; }
const everyMethod = method => ({ values: method, keys: method, entries: method });
const iterableOf = iterator => everyMethod(() => ({ [Symbol.iterator]: iterator }));
const subjects = [["map", new Map([[1, 2], [3, 4], [5, 6]])], ["set", new Set([1, 2, 3])], ["array", [7, 8, 9]], ["null", null], ["no methods", {}],
  ["getter throws", { get values() { log.push("get"); throw new Error("get"); }, get keys() { log.push("get"); throw new Error("get"); }, get entries() { log.push("get"); throw new Error("get"); } }],
  ["call throws", everyMethod(() => { log.push("call"); throw new Error("call"); })], ["not iterable", everyMethod(() => 5)], ["open throws", iterableOf(() => { log.push("open"); throw new Error("open"); })],
  ["step throws", iterableOf(() => ({ next() { log.push("next"); throw new Error("next"); }, return() { log.push("return"); return {}; } }))],
  ["closable", iterableOf(() => { let i = 0; return { next: () => ({ done: i >= 3, value: [i, ++i] }), return() { log.push("return"); return {}; } }; })]];
for (const [label, subject] of subjects) for (const loop of [callOutside, callInside, entriesOutside, entriesInside, noHandler, twoHandlers, withFinally, bodyThrows]) {
  let outcome; log.length = 0;
  try { outcome = "returned " + loop(subject); } catch (error) { outcome = "threw " + (error instanceof TypeError ? "TypeError" : error.message); }
  console.log(label + ", " + loop.name + ": " + outcome + " [" + log.join(" ") + "]");
}
