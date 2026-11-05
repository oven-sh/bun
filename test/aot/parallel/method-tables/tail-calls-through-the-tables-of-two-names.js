// Methods of two names on six classes, each ending in a tail call of the other name. A copy of a callee in its caller would hold such a call again,
// so both calls go through the method table: a million of them need no stack, and a stack trace lists no caller that has left.
const all = [];
class A { down(key, sum) { return key < 1 ? sum : all[key % all.length].across(key - 1, sum + 1); } across(key, sum) { return key < 1 ? -sum : all[(key + 1) % all.length].down(key - 1, sum * 2 % 1000); } }
class B { down(key, sum) { return key < 1 ? sum + 0.5 : all[key % all.length].across(key - 1, sum + 2); } across(key, sum) { return key < 1 ? "B" + sum : all[(key + 2) % all.length].down(key - 1, sum + 0.25); } }
class C { down(key, sum) { return key < 1 ? -0 : all[key % all.length].across(key - 1, sum + 3); } across(key, sum) { return key < 1 ? null : all[(key + 3) % all.length].down(key - 1, sum); } }
class D { down(key, sum) { return key < 1 ? undefined : all[key % all.length].across(key - 1, sum + 4); } across(key, sum) { return key < 1 ? [sum] : all[(key + 4) % all.length].down(key - 1, sum - 1); } }
class E { down(key, sum) { return key < 1 ? "end" : all[key % all.length].across(key - 1, sum + 5); } across(key, sum) { return key < 1 ? 7n : all[(key + 5) % all.length].down(key - 1, sum + 1); } }
class F { down(key, sum) { return key < 1 ? { sum } : all[key % all.length].across(key - 1, sum + 6); } across(key, sum) { return key < 1 ? new Error("here").stack.split("\n").slice(0, 4).map(line => line.trim().replace(/[^ (]*[\\/]/, "")).join(" | ") : all[key % all.length].down(key - 1, sum); } }
all.push(new A(), new B(), new C(), new D(), new E(), new F());

function show(value) {
  return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : JSON.stringify(value) ?? String(value);
}
for (let first = 0; first < 6; first++) {
  const line = [];
  for (let key = 0; key < 14; key++) line.push(show(all[first].down(key, first)), show(all[first].across(key, first)));
  console.log(line.join(" "));
}
console.log(show(all[1].down(1000000, 0)), show(all[4].across(1000001, 0)));

// A function that is no method leaves by a call of methods that return at once: nothing is copied twice.
class G { size() { return 1; } }
class H { size() { return 2.5; } }
class I { size() { return "three"; } }
class J { size() { return null; } }
class K { size() { return 5n; } }
class L { size() { return undefined; } }
const sized = [new G(), new H(), new I(), new J(), new K(), new L()];
function sizeOf(index) { "use strict"; return sized[index % sized.length].size(); }
const sizes = [];
for (let index = 0; index < 8; index++) sizes.push(show(sizeOf(index)));
console.log(sizes.join(" "));
