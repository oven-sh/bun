// `arguments` in strict code: a stub makes the object and copies the arguments into it, whether they lie in parameters or behind them in a list of integers, of fractions or of any values.
// The run time makes the object only where the stub finds no free cell, and where there are more arguments than a small cell holds.
// CALLS+ all CreateArguments
// CALLS+ behindTwo CreateArguments
// COUNTER: operationAOTCreateUnmappedArguments <= 6000
"use strict";
const out = [];
const marker = { name: "marker" };

function all() {
  return arguments;
}
function behindTwo(first, second) {
  return arguments;
}
function afterAStore(first, second) {
  first = "stored";
  second = first + second;
  return arguments;
}

function show(list) {
  const parts = [];
  for (let i = 0; i < list.length; i++) {
    const value = list[i];
    parts.push(!(i in list) ? "hole" : value === marker ? "marker" : Object.is(value, -0) ? "-0" : typeof value === "string" ? JSON.stringify(value) : String(value));
  }
  return Object.prototype.toString.call(list) + " " + list.length + " [" + parts.join(",") + "] " + Reflect.ownKeys(list).map(String).join("|");
}

function listOf(kind, count) {
  const list = [];
  for (let i = 0; i < count; i++) list.push(kind === "integers" ? i - 2 : kind === "fractions" ? i + 0.25 : kind === "numbers" ? (i & 1 ? i : i / 4) : i % 3 === 0 ? marker : i % 3 === 1 ? "t" + i : undefined);
  return list;
}

out.push(show(all()), show(all(1)), show(all(1.5)), show(all("a", marker)), show(all(undefined)), show(all(null, undefined, -0, NaN, 2 ** 31, -(2 ** 31), 2 ** 53)));
out.push(show(behindTwo()), show(behindTwo(1)), show(behindTwo(1, 2)), show(behindTwo(1, 2, 3)), show(behindTwo(1, 2, 3.5)), show(behindTwo(1, 2, "c", marker)), show(behindTwo(0.5, "b", NaN, -0, 1e300)));
out.push(show(afterAStore()), show(afterAStore(1)), show(afterAStore(1, 2)), show(afterAStore(1, 2, 3, 4.5)));

for (const kind of ["integers", "fractions", "numbers", "values"]) {
  for (const count of [0, 1, 2, 3, 4, 7, 8, 31, 64]) {
    const list = listOf(kind, count);
    out.push(kind + " " + count + ": " + show(all(...list)) + " " + show(behindTwo(...list)) + " " + show(all.apply(null, list)));
  }
}
let wrong = 0;
for (let count = 940; count <= 1040; count++) {
  for (const kind of ["integers", "fractions", "values"]) {
    const passed = listOf(kind, count);
    const many = all(...passed);
    const behind = behindTwo(...passed);
    if (many.length !== count || behind.length !== count || count in many || Object.keys(behind).length !== count) wrong++;
    for (let i = 0; i < count; i++) if (many[i] !== passed[i] || behind[i] !== passed[i]) wrong++;
  }
}
out.push("940 to 1040 arguments: " + wrong + " wrong", String(all(...listOf("numbers", 5000))[4999]));

const list = behindTwo(1, 2, 3);
list[1] = "stored";
list[6] = "added";
list.length = 1;
list.name = "named";
delete list[0];
out.push(show(list), JSON.stringify(Object.getOwnPropertyDescriptor(list, "length")), String(list[Symbol.iterator] === Array.prototype.values), [...behindTwo(1, 2.5, "c")].join());
try {
  out.push(String(all().callee));
} catch (error) {
  out.push(error.name);
}

const ring = new Array(257);
let sum = 0;
for (let i = 0; i < 300000; i++) {
  const made = i % 5 === 0 ? all() : i % 5 === 1 ? all(i, "s" + (i & 7)) : i % 5 === 2 ? behindTwo(i, i + 0.5, i, i) : i % 5 === 3 ? behindTwo(i, marker, i + 0.5) : all(i, i, i, i, i, i, i);
  const before = ring[i % 257];
  if (before !== undefined && before.length) sum += typeof before[before.length - 1] === "number" ? before[before.length - 1] : before[0];
  ring[i % 257] = made;
}
out.push("sum " + sum, show(ring[0]), show(ring[1]), show(ring[2]), show(ring[3]), show(ring[4]));
console.log(out.join("\n"));
