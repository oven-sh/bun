// What TypeScript refuses in a literal and JavaScript allows: a name twice, an accessor under a name that is also defined, in either order, with values of one type and of several.
const lines = [];
const keysOf = object => Reflect.ownKeys(object).map(String).join();
function accessorFirst(i) { return { a: i, get d() { return "getter"; }, d: i + 1, e: "e" }; }
function accessorLast(i) { return { a: i, d: i + 1, get d() { return "getter " + this.a; }, e: "e" }; }
function setterFirst(i) { return { a: i, set d(value) { lines.push("the setter ran"); }, d: i + 1, e: "e" }; }
function setterLast(i) { return { a: i, d: i + 1, set d(value) { lines.push("the setter ran"); }, e: "e" }; }
function twice(i) { return { a: i, d: "first", e: "e", d: i + 1 }; }
function twiceWithCallsBetween(i) { return { a: i, d: String(i), e: [i].join(), d: i + 1, f: [i, i].join() }; }
function thrice(i) { return { d: 1, d: "two", d: { three: i } }; }
function prototypeTwiceInWords(i) { return { __proto__: null, ["__proto__"]: i, a: i, d: i + 1 }; }
function methodsAndNames(i) { return { run() { return this.d; }, d: i + 1, run2: () => i, e: "e", run() { return "second " + this.d; } }; }
for (const [label, make] of Object.entries({ accessorFirst, accessorLast, setterFirst, setterLast, twice, twiceWithCallsBetween, thrice, prototypeTwiceInWords, methodsAndNames })) {
  let last;
  for (let i = 0; i < 40; i++) last = make(i);
  lines.push(label + ": " + keysOf(last) + " | " + JSON.stringify(last.d) + " | " + JSON.stringify(Object.getOwnPropertyDescriptor(last, "d"), (key, value) => typeof value === "function" ? "function" : value) + " | " + (typeof last.run === "function" ? last.run() : "no run") + " | " + String(Object.getPrototypeOf(last) === Object.prototype));
}
console.log(lines.join("\n"));
