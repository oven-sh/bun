// Arrays used as queues and stacks, subclasses of Array, and arrays that native code reads, fills or empties.
import { edenGC, fullGC } from "bun:jsc";
const out: string[] = [];
const ring: unknown[] = new Array(1024).fill(null); let turn = 0;
function churn(n: number) { for (let i = 0; i < n; i++) { ring[turn++ & 1023] = [i, "x" + i]; ring[turn++ & 1023] = [{ i }]; } }
// A queue: push at the end, shift at the front, over collections.
const queue = [0, 1, 2]; let next = 3, expected = 0, bad = "";
for (let round = 0; round < 3000 && !bad; round++) {
  queue.push(next++); if (round % 3) queue.push(next++);
  const got = queue.shift(); if (got !== expected++) bad = "round " + round + ": " + got;
  if (round % 5 === 0) { const again = queue.shift(); if (again !== expected++) bad = "round " + round + ": " + again; }
  if (round % 400 === 0) { churn(2000); if (round & 1) edenGC(); else fullGC(); }
}
out.push("queue: " + bad + " " + queue.length + " " + queue[0] + " " + queue[queue.length - 1]);
const objects: { n: number }[] = [{ n: 0 }]; let made = 1, taken = 0; bad = "";
for (let round = 0; round < 3000 && !bad; round++) {
  objects.push({ n: made++ }); objects.unshift({ n: -1 }); if (objects.shift()!.n !== -1) bad = "front " + round;
  if (round & 1) { if (objects.shift()!.n !== taken++) bad = "order " + round; }
  if (round % 500 === 0) { churn(2000); fullGC(); }
}
out.push("queue of objects: " + bad + " " + objects.length + " " + objects[0].n);
// A stack that empties and fills again.
const stack: string[] = []; bad = "";
for (let round = 0; round < 200 && !bad; round++) { for (let i = 0; i < round % 23; i++) stack.push("v" + i); for (let i = (round % 23) - 1; i >= 0; i--) if (stack.pop() !== "v" + i) bad = "round " + round; if (stack.length) bad = "left " + round; if (round % 50 === 0) { churn(1000); edenGC(); } }
out.push("stack: " + bad);
// Subclasses.
class Stack<T> extends Array<T> { top(): T | undefined { return this[this.length - 1]; } static get [Symbol.species]() { return Array; } }
class Named extends Array<number> { name = "named"; total() { let t = 0; for (const x of this) t += x; return t; } }
const st = new Stack<number>(); st.push(1, 2, 3, 4, 5, 6, 7, 8, 9); out.push("subclass: " + st.top() + " " + st.length + " " + (st instanceof Stack) + " " + (st.map(x => x) instanceof Stack) + " " + Array.isArray(st));
const nm = Named.from([1, 2, 3]) as Named; nm.push(4); const sliced = nm.slice(1) as Named; out.push("subclass with a field: " + nm.total() + " " + nm.name + " " + (sliced instanceof Named) + " " + sliced.total() + " " + sliced.name + " " + nm.concat([5, 6]).length + " " + (nm.filter(x => x > 1) as Named).total());
const of = Named.of(7, 8, 9) as Named; fullGC(); out.push("of: " + of.total() + " " + of.length);
// Native code.
const parts = [new Uint8Array([1, 2]), new Uint8Array([3])]; out.push("Buffer.concat: " + Buffer.concat(parts).join());
const pairs: [string, number][] = [["a", 1], ["b", 2], ["c", 3]]; out.push("entries: " + JSON.stringify(Object.fromEntries(pairs)) + " " + new Map(pairs).size + " " + new Set([1, 2, 2, 3]).size + " " + JSON.stringify(Object.entries({ x: 1, y: [2, 3] })));
out.push("apply: " + Math.max.apply(null, [1, 9, 3]) + " " + Math.max(...[4, 5, 6]) + " " + String.fromCharCode.apply(null, [104, 105]) + " " + Reflect.apply((a: number, b: number) => a + b, null, [1, 2]) + " " + new (Function.prototype.bind.apply(Date, [null, 2020, 1, 1]))().getFullYear());
out.push("strings: " + "a,b,c".split(",").concat(["d"]).join("-") + " " + "x1y22z".match(/\d+/g)!.concat(["3"]).join() + " " + Array.from("héllo").reverse().join("") + " " + [..."ab"].concat([..."cd"]).join(""));
const matched = /(\d)(\d)?/.exec("7")!; matched.push("more"); out.push("match: " + matched.length + " " + matched[0] + " " + matched[2] + " " + matched.index + " " + matched[3]);
const parsed = JSON.parse("[1,[2,3],{\"a\":[4]}]"); parsed.push(5); parsed[1].push(6); parsed[2].a.push(7); out.push("parsed: " + JSON.stringify(parsed));
const all = await Promise.all([1, Promise.resolve(2), 3]); all.push(4); out.push("Promise.all: " + all.join());
const settled = await Promise.allSettled([Promise.reject(new Error("no")), 1]); out.push("allSettled: " + settled.map(x => x.status).join());
const sorted = [5, 1, 4].sort(); const keys = Object.keys({ b: 1, a: 2 }); keys.push("c"); keys.sort(); out.push("sorted: " + sorted.join() + " " + keys.join());
const cloned = structuredClone({ list: [1, [2, 3]], set: new Set([[4]]) }); cloned.list.push(9); out.push("cloned: " + JSON.stringify(cloned.list) + " " + [...cloned.set][0].join());
const typed = Array.from(new Float64Array([1.5, 2.5])); typed.push(3.5); typed.push("s" as unknown as number); out.push("typed: " + typed.join());
const args = (function (..._rest: number[]) { return arguments; })(1, 2, 3); const fromArguments = Array.prototype.slice.call(args); fromArguments.push(4); out.push("arguments: " + fromArguments.join());
function rest(...values: number[]) { values.push(values.length); return values; } out.push("rest: " + rest().join() + "|" + rest(1).join() + "|" + rest(1, 2, 3, 4, 5, 6, 7).join());
const inspected = Bun.inspect([1, [2, [3]], "x"]); out.push("inspect: " + inspected.replace(/\s+/g, " "));
console.log(out.join("\n"));
