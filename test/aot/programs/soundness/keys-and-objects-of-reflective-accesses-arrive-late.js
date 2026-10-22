// The key of a reflective read changes inside a function that is found through the first read.
function main() {
let key = "first";
const table = {
  first() { key = "second"; return 1; },
  second() { key = "third"; return "two"; },
  third: { deep: true },
};
let seen = [];
for (let i = 0; i < 3; i++) {
  const member = Reflect.get(table, key);
  seen.push(typeof member === "function" ? typeof member() : member.deep);
}
console.log(seen.join());

// The object changes the same way.
let source = { value() { source = { value: "late object" }; return 0; } };
let out = [];
for (let i = 0; i < 2; i++) {
  const v = Reflect.get(source, "value");
  out.push(typeof v === "function" ? v() : v.length);
}
console.log(out.join());

// A store under a key that arrives late.
let storeKey = "a";
const stored = { a: 0, b: 0 };
function bump() { storeKey = "b"; return "text"; }
for (let i = 0; i < 2; i++) Reflect.set(stored, storeKey, i ? bump : bump());
console.log(typeof stored.a, typeof stored.b);
for (let i = 0; i < 2; i++) Reflect.set(stored, storeKey, { n: i });
console.log(typeof stored.a, typeof stored.b, stored.b.n);

let definedKey = "x";
const definedOn = { x: 1, y: 2 };
const descriptor = { get() { definedKey = "y"; return "got"; }, configurable: true };
for (let i = 0; i < 2; i++) { Object.defineProperty(definedOn, definedKey, descriptor); definedOn.x; }
console.log(definedOn.x, definedOn.y);
}
main();
