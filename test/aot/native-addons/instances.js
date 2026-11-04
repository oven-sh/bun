// Instances of classes, handed to the addon: every way in which native code changes an object, then the fields read back by code that was compiled to loads from slots.
const loaded = { exports: {} };
process.dlopen(loaded, process.env.ADDON);
const attack = loaded.exports;
let at = 0;
function row(label, f) {
  let said;
  try {
    said = JSON.stringify(f());
  } catch (error) {
    said = "threw " + error.constructor.name;
  }
  console.log(String(++at).padStart(3) + " " + label + ": " + said);
}

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  sum() {
    return this.x + this.y;
  }
}
class Point3 extends Point {
  constructor(x, y, z) {
    super(x, y);
    this.z = z;
  }
  sum() {
    return super.sum() + this.z;
  }
}
function total(point) {
  let sum = 0;
  for (let round = 0; round < 300; round++) sum += point.x + point.y;
  return sum;
}
function totalOfCalls(point) {
  let sum = 0;
  for (let round = 0; round < 300; round++) sum += point.sum();
  return sum;
}
function look(point) {
  return [total(point), totalOfCalls(point), Object.keys(point).join(), JSON.stringify(point)];
}
function changedInTheLoop(point, change) {
  let sum = 0;
  for (let round = 0; round < 50; round++) {
    sum += point.x;
    change(point, round);
    sum += point.x * 2 + point.sum();
  }
  return sum;
}
function bump(point) {
  "use strict";
  point.x = point.x + 1;
  point.y++;
  return point.x + point.y;
}

for (const make of [() => new Point(1, 2), () => new Point3(1, 2, 3)]) {
  const name = make().constructor.name;
  row(name + " untouched", () => look(make()));
  row(name + " store", () => { const p = make(); return [attack.store(p, "x", 10), look(p)]; });
  row(name + " store by a C name", () => { const p = make(); return [attack.storeNamed(p, "y", 20), look(p)]; });
  row(name + " store of a fraction", () => { const p = make(); return [attack.store(p, "x", 0.5), look(p)]; });
  row(name + " store of a string", () => { const p = make(); return [attack.store(p, "x", "s"), look(p)]; });
  row(name + " store of undefined", () => { const p = make(); return [attack.store(p, "x", undefined), look(p)]; });
  row(name + " store of an object", () => { const p = make(); return [attack.store(p, "x", { valueOf: () => 4 }), total(p), totalOfCalls(p)]; });
  row(name + " store under a new name", () => { const p = make(); return [attack.store(p, "w", 9), look(p), p.w]; });
  row(name + " store under the name of a method", () => { const p = make(); return [attack.store(p, "sum", () => 100), look(p).slice(0, 3)]; });
  row(name + " store under an index", () => { const p = make(); return [attack.storeElement(p, 0, 5), look(p), p[0]]; });
  row(name + " remove", () => { const p = make(); return [attack.removeKey(p, "y"), look(p), "y" in p]; });
  row(name + " remove and store again", () => { const p = make(); return [attack.removeKey(p, "x"), attack.store(p, "x", 3), look(p)]; });
  row(name + " getter", () => { const p = make(); return [attack.defineGetter(p, "x"), look(p), bump(p), look(p)]; });
  row(name + " read-only value", () => { const p = make(); return [attack.defineValue(p, "x", 30, 0), look(p)]; });
  row(name + " read-only value, then the program stores", () => { const p = make(); attack.defineValue(p, "x", 30, 0); return bump(p); });
  row(name + " native method on the object", () => { const p = make(); return [attack.defineMethod(p, "sum"), look(p).slice(0, 3)]; });
  row(name + " freeze", () => { const p = make(); return [attack.freeze(p), look(p), Object.isFrozen(p)]; });
  row(name + " freeze, then the program stores", () => { const p = make(); attack.freeze(p); return bump(p); });
  row(name + " seal, then the program stores", () => { const p = make(); attack.seal(p); return [bump(p), look(p), Object.isSealed(p)]; });
  row(name + " seal, then the program adds", () => { "use strict"; const p = make(); attack.seal(p); p.w = 1; return look(p); });
  row(name + " preventExtensions, then the program adds", () => { "use strict"; const p = make(); attack.preventExtensions(p); p.w = 1; return look(p); });
  row(name + " another prototype", () => { const p = make(); return [attack.setPrototype(p, { sum() { return -1; } }), look(p), p instanceof Point]; });
  row(name + " no prototype", () => { const p = make(); return [attack.setPrototype(p, null), total(p), typeof p.sum]; });
  row(name + " no prototype, then a call", () => { const p = make(); attack.setPrototype(p, null); return totalOfCalls(p); });
  row(name + " wrap", () => { const p = make(); return [attack.wrap(p, 6.5), attack.unwrap(p), look(p)]; });
  row(name + " changed inside the loop", () => changedInTheLoop(make(), (p, round) => attack.store(p, "x", round)));
  row(name + " changed inside the loop, not handed in that call", () => { const p = make(); attack.keep(0, p); return changedInTheLoop(p, (_, round) => attack.storeIntoKept(0, "x", round)); });
  row(name + " removed inside the loop", () => changedInTheLoop(make(), (p, round) => round === 20 && attack.removeKey(p, "x")));
  row(name + " getter inside the loop", () => changedInTheLoop(make(), (p, round) => round === 20 && attack.defineGetter(p, "x")));
  row(name + " method hidden inside the loop", () => changedInTheLoop(make(), (p, round) => round === 20 && attack.store(p, "sum", () => 1000)));
  row(name + " prototype changed inside the loop", () => changedInTheLoop(make(), (p, round) => round === 20 && attack.setPrototype(p, { sum: () => 2000 })));
  row(name + " reached through a field", () => { const p = make(); const holder = { inner: p }; return [attack.storeInto(holder, "inner", "x", 11), look(p)]; });
  row(name + " reached through an element", () => { const p = make(); return [attack.storeInto([0, p], 1, "y", 12), look(p)]; });
  row(name + " reached through a closure", () => { const p = make(); return [attack.callAndStore(() => p, "x", 13), look(p)]; });
  row(name + " made by the addon", () => { const p = attack.construct(make().constructor, 4, 5); return [look(p), p instanceof Point, p.constructor.name]; });
  row(name + " others stay as they were", () => look(make()));
}
