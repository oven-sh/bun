const said: unknown[] = [];
const show = (v: unknown) => (Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
class Rows extends Array<number> { entries(): ArrayIterator<[number, number]> { said.push("own entries"); return super.entries(); } }
function run(list: { entries(): Iterable<[unknown, unknown]>; keys(): Iterable<unknown>; values(): Iterable<unknown> }) { for (const [i, x] of list.entries()) said.push(i, x); for (const i of list.keys()) said.push(i); for (const x of list.values()) said.push(x); }
for (let turn = 0; turn < 200; turn++) { said.length = 0; run(Rows.from([7, 8]) as never); run(new Uint8Array([5, 6])); run(new Map([["k", 1]])); run(new Set(["s"])); run([1]); run(new URLSearchParams("a=1")); run({ entries: () => [["e", 1]], keys: () => ["k"], values: () => ["v"] });
  (function (this: unknown, ..._rest: unknown[]) { for (const [i, x] of Array.prototype.entries.call(arguments)) said.push(i, x); })("x", "y"); for (const [i, x] of Array.prototype.entries.call("hi")) said.push(i, x); }
console.log(said.map(show).join(" "));
