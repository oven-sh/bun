// A construction reads the prototype of new.target before the constructor runs, and a proxy answers that read with code of the program.
function trapped(prototype, list) {
  return new Proxy(function () {}, {
    get(target, key) {
      if (key === "prototype") { list.push(list.length); return prototype; }
      return target[key];
    },
  });
}
function Legacy() { this.legacy = true; }
class BelowLegacy extends Legacy {
  constructor(list) { const before = list.length; super(); this.lengths = before + "," + list.length; }
}
class BelowArray extends Array {
  constructor(list) { const before = list.length; super(); this.lengths = before + "," + list.length; }
}
class BelowObject extends Object {
  constructor(list) { const before = list.length; super(); this.lengths = before + "," + list.length; }
}
function construct(constructor, list) {
  const before = list.length;
  const made = Reflect.construct(constructor, [list], trapped(constructor.prototype, list));
  return before + "," + list.length + " " + made.lengths;
}
for (const constructor of [BelowLegacy, BelowArray, BelowObject]) {
  const list = [1, 2];
  console.log(constructor.name, construct(constructor, list), construct(constructor, list));
  console.log(constructor.name, new constructor(list).lengths);
}
