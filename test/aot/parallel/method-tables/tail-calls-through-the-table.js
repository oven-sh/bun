// Methods of one name on six classes end in a tail call of that name. The call goes through the method table and gives up the caller's frame:
// a million of them need no stack, a stack trace lists no caller that has left, and numbers of every kind come back.
const all = [];
class A { step(key, sum) { return key < 1 ? sum : all[key % all.length].step(key - 1, sum + 1); } kind() { return 1; } }
class B { step(key, sum) { return key < 1 ? sum + 0.5 : all[key % all.length].step(key - 1, sum + 2); } kind() { return 2.5; } }
class C { step(key, sum) { return key < 1 ? -0 : all[key % all.length].step(key - 1, sum + 3); } kind() { return "three"; } }
class D { step(key, sum) { return key < 1 ? undefined : all[key % all.length].step(key - 1, sum + 4); } kind() { return null; } }
class E { step(key, sum) { return key < 1 ? "end" : all[key % all.length].step(key - 1, sum + 5); } kind() { return 5n; } }
class F { step(key, sum, extra) { return key < 1 ? [sum, extra] : all[key % all.length].step(key - 1, sum + 6); } kind() { return { six: 6 }; } }
all.push(new A(), new B(), new C(), new D(), new E(), new F());

function show(value) {
  return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : JSON.stringify(value) ?? String(value);
}
for (let first = 0; first < 6; first++) {
  const line = [];
  for (let key = 0; key < 13; key++) line.push(show(all[first].step(key, first)));
  console.log(line.join(" "));
}
console.log(show(all[1].step(1000000, 0)));

function kindOf(object) { "use strict"; return object.kind(); }
console.log(all.map(object => show(kindOf(object))).join(" "));

// Where the frames are listed.
class G { walk(depth) { return depth < 1 ? new Error("here").stack.split("\n").slice(0, 4).map(line => line.trim().replace(/[^ (]*[\\/]/, "")).join(" | ") : walkers[(depth + 5) % walkers.length].walk(depth - 1); } }
class H extends G { walk(depth) { return depth < 1 ? "H" : walkers[(depth + 5) % walkers.length].walk(depth - 1); } }
class I extends G { walk(depth) { return depth < 1 ? "I" : walkers[(depth + 5) % walkers.length].walk(depth - 1); } }
class J extends G { walk(depth) { return depth < 1 ? "J" : walkers[(depth + 5) % walkers.length].walk(depth - 1); } }
class K extends G { walk(depth) { return depth < 1 ? "K" : walkers[(depth + 5) % walkers.length].walk(depth - 1); } }
class L extends G { walk(depth) { return depth < 1 ? "L" : walkers[(depth + 5) % walkers.length].walk(depth - 1); } }
const walkers = [new G(), new H(), new I(), new J(), new K(), new L()];
function outer() { return [walkers[3].walk(6)]; }
console.log(outer()[0]);

// Four arguments, the most that the table passes, and fractions among them.
class M { mix(a, b, c, d) { return a < 1 ? b + c * d : mixers[a % mixers.length].mix(a - 1, c, d, b + 0.25); } }
class N { mix(a, b, c, d) { return a < 1 ? b - c - d : mixers[a % mixers.length].mix(a - 1, d, b, c + 1); } }
class O { mix(a, b, c, d) { return a < 1 ? b * c + d : mixers[a % mixers.length].mix(a - 1, b, d, c); } }
class P { mix(a, b, c, d) { return a < 1 ? d : mixers[a % mixers.length].mix(a - 1, b + c, c, d); } }
class Q { mix(a, b, c, d) { return a < 1 ? String(b) + c + d : mixers[a % mixers.length].mix(a - 1, c, b, d); } }
const mixers = [new M(), new N(), new O(), new P(), new Q()];
const mixed = [];
for (let a = 0; a < 12; a++) mixed.push(show(mixers[a % mixers.length].mix(a, 1, 2, 3)));
console.log(mixed.join(" "));
