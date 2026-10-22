// A store of a value of another kind than the declared type of the property throws a TypeError, whoever writes, and leaves the property as it was. Plain Bun stores it.
// Columns: kinds types. Elsewhere: as plain Bun.
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); }
}
interface Inner { id: number }
interface Shape { count: number; name: string; done: boolean; inner: Inner; run: () => number }
class Entry implements Shape { count: number = 1; name: string = "n"; done: boolean = false; inner: Inner = { id: 1 }; run: () => number = () => 1; }
const makers: [string, () => any][] = [
  ["a class instance", () => new Entry()],
  ["a literal", () => { const shape: Shape = { count: 1, name: "n", done: false, inner: { id: 1 }, run: () => 1 }; return shape; }],
];
const key = ["co", "unt"].join("");
const writers: [string, (o: any) => unknown][] = [
  ["through any", o => { o.count = "text"; return o.count; }],
  ["under a computed key", o => { o[key] = "text"; return o.count; }],
  ["Reflect.set", o => Reflect.set(o, "count", "text")],
  ["Object.assign", o => Object.assign(o, { count: "text" }).count],
  ["Object.defineProperty with a value", o => Object.defineProperty(o, "count", { value: "text" }).count],
  ["a destructuring assignment", o => { ({ a: o.count } = { a: "text" }); return o.count; }],
  ["a compound assignment", o => { o.count += "text"; return o.count; }],
  ["the target of for-of", o => { for (o.count of ["text"]); return o.count; }],
];
const values: [string, string, unknown][] = [
  ["a number into string", "name", 5],
  ["a number into boolean", "done", 1],
  ["a string into an object type", "inner", "text"],
  ["a number into an object type", "inner", 5],
  ["an object into number", "count", { id: 1 }],
  ["a bigint into number", "count", 1n],
  ["a symbol into string", "name", Symbol.iterator],
  ["a number into a function type", "run", 5],
  ["a boolean into number", "count", true],
];
const show = (o: any) => [o.count, o.name, o.done, o.inner.id, typeof o.run === "function" ? o.run() : "no function"].map(String).join();
for (const [how, make] of makers) {
  for (const [what, write] of writers) {
    const o = make();
    attempt(how + ", a string into number " + what, () => write(o));
    console.log("  afterwards:", show(o));
  }
  for (const [what, name, value] of values) {
    const o = make();
    attempt(how + ", " + what, () => { o[name] = value; return typeof o[name]; });
    console.log("  afterwards:", show(o));
  }
}
