// Loops over the keys of an object that do nothing but look at each key, over every kind of object, and loops in which the keys change on the way.
function hasOnly(value, first, second, third) {
  for (const key in value) if (key !== first && key !== second && key !== third) return false;
  return true;
}
function countKeys(value) {
  let count = 0;
  for (const key in value) count++;
  return count;
}
function joinKeys(value) {
  let text = "";
  for (const key in value) text += key + ",";
  return text;
}
function longest(value) {
  let length = 0;
  for (const key in value) if (key.length > length) length = key.length;
  return length;
}
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  norm() {
    return this.x + this.y;
  }
}
class Point3 extends Point {
  constructor(x, y, z) {
    super(x, y);
    this.z = z;
  }
}
function Legacy() {
  this.own = 1;
}
Legacy.prototype.inherited = 2;

const dictionary = {};
for (let i = 0; i < 300; i++) dictionary["k" + i] = i;
delete dictionary.k7;
const withElements = { b: 1, 2: "two", a: 2, 0: "zero" };
const list = ["x", "y"];
list.extra = true;
const late = new Point(1, 2);
late.added = 3;
const shrunk = new Point3(1, 2, 3);
delete shrunk.y;
const hidden = Object.defineProperty({ seen: 1 }, "unseen", { value: 2, enumerable: false });
const frozen = Object.freeze({ f: 1, g: 2 });
const trapped = [];
const proxy = new Proxy({ p: 1, q: 2 }, {
  ownKeys(target) {
    trapped.push("ownKeys");
    return Reflect.ownKeys(target);
  },
  getOwnPropertyDescriptor(target, key) {
    trapped.push("descriptor " + String(key));
    return Reflect.getOwnPropertyDescriptor(target, key);
  },
});
const values = {
  parsed: JSON.parse('{"id":1,"name":"n","email":"e"}'),
  odd: JSON.parse('{"id":1,"name":"n","other":2}'),
  empty: {},
  bare: Object.assign(Object.create(null), { id: 1 }),
  point: new Point(1, 2),
  point3: new Point3(1, 2, 3),
  legacy: new Legacy(),
  below: Object.create({ above: 1, id: 2 }, { id: { value: 1, enumerable: true } }),
  dictionary, withElements, list, late, shrunk, hidden, frozen, proxy,
  belowProxy: Object.create(proxy, { mine: { value: 1, enumerable: true } }),
  text: "abc",
  boxed: Object.assign(new String("ab"), { more: 1 }),
  number: 5,
  nothing: null,
  missing: undefined,
  bytes: new Uint8Array(3),
  func: Object.assign(function () {}, { id: 1 }),
  map: new Map([[1, 2]]),
  args: (function () { return arguments; })(1, 2),
};
for (let round = 0; round < 3; round++) {
  for (const name in values) {
    const value = values[name];
    const keys = joinKeys(value);
    console.log(round, name, hasOnly(value, "id", "name", "email"), countKeys(value), longest(value), keys.length > 60 ? keys.length : keys);
  }
}
console.log(trapped.length, trapped.slice(0, 6).join(" | "));

// A getter of the prototype chain cannot run in such a loop, but a trap above the object can, and it changes the object that is walked.
function walkBelowTrap() {
  const seen = [];
  const walked = { first: 1, second: 2, third: 3 };
  let calls = 0;
  Object.setPrototypeOf(walked, new Proxy({ above: 1 }, {
    ownKeys(target) {
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, key) {
      calls++;
      delete walked.third;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    has(target, key) {
      calls++;
      return key in target;
    },
  }));
  for (const key in walked) seen.push(key);
  return seen.join() + " " + (calls > 0);
}
console.log(walkBelowTrap(), walkBelowTrap());

// The keys change in the loop itself.
function removesAhead(value) {
  const seen = [];
  for (const key in value) {
    seen.push(key);
    if (key === "a") delete value.c;
  }
  return seen.join();
}
function addsBehind(value) {
  const seen = [];
  for (const key in value) {
    seen.push(key);
    value["new" + key.length] = 1;
  }
  return seen.join();
}
function changedByCallee(value, change) {
  let text = "";
  for (const key in value) {
    text += key;
    change(value, key);
  }
  return text;
}
for (let round = 0; round < 3; round++) {
  console.log(removesAhead({ a: 1, b: 2, c: 3, d: 4 }), addsBehind({ a: 1, bb: 2 }), removesAhead(Object.assign(new Point(1, 2), { a: 1, c: 2, e: 3 })));
  console.log(changedByCallee({ a: 1, b: 2, c: 3 }, (value, key) => { if (key === "a") delete value.b; }), changedByCallee({ a: 1, b: 2, c: 3 }, () => {}), changedByCallee(new Point3(1, 2, 3), (value, key) => { if (key === "x") delete value.z; }));
}

// One enumerator after another for the same object, and two loops at once.
function pairs(value) {
  let count = 0;
  for (const outer in value) for (const inner in value) if (outer !== inner) count++;
  return count;
}
console.log(pairs({ a: 1, b: 2, c: 3 }), pairs(new Point3(1, 2, 3)), pairs(withElements), pairs(list));
