// Object.setPrototypeOf and Reflect.setPrototypeOf at sites that run again and again: the same change of the same kind of object, and every case in which the change must be refused, must be seen
// by somebody else, or is no change of a plain object at all
const lines = [];
const first = { name() { return "first"; }, shared() { return 1; } };
const second = { name() { return "second"; }, shared() { return 2; } };
const third = Object.create(first, { name: { value() { return "third"; }, configurable: true, writable: true } });
const prototypes = [first, second, third, null];

function describe(object) {
  const prototype = Object.getPrototypeOf(object);
  return prototype === null ? "none" : object.name() + (object.shared ? object.shared() : "");
}

function changesFreshObjects(turns) {
  const seen = {};
  for (let i = 0; i < turns; i++) {
    const object = { a: i, b: "text" };
    const result = Object.setPrototypeOf(object, prototypes[i % prototypes.length]);
    if (result !== object) lines.push("the result is not the object");
    const what = describe(object) + object.a % 2;
    seen[what] = (seen[what] ?? 0) + 1;
  }
  lines.push("fresh " + JSON.stringify(seen));
}

function changesOneObject(turns) {
  const object = { a: 1 };
  let text = "";
  for (let i = 0; i < turns; i++) {
    if (!Reflect.setPrototypeOf(object, prototypes[(i * 7) % prototypes.length])) lines.push("refused");
    if (i % 97 === 0) text += describe(object) + " ";
  }
  lines.push("one object " + text);
}

class Point {
  constructor(x) { this.x = x; }
  name() { return "point"; }
}
function changesInstances(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const point = new Point(i);
    if (i % 3) Object.setPrototypeOf(point, i % 3 === 1 ? first : Point.prototype);
    sum += point.name().length + (point instanceof Point ? 100 : 0) + point.x % 2;
  }
  lines.push("instances " + sum);
}

function refusals(turns) {
  const counts = {};
  const count = what => { counts[what] = (counts[what] ?? 0) + 1; };
  for (let i = 0; i < turns; i++) {
    const object = { a: i };
    if (i % 4 === 1) Object.preventExtensions(object);
    if (i % 4 === 2) Object.freeze(object);
    if (i % 4 === 3) Object.seal(object);
    try {
      Object.setPrototypeOf(object, first);
      count("changed " + describe(object));
    } catch (error) {
      count(error.constructor.name + " " + (Object.getPrototypeOf(object) === Object.prototype));
    }
    count("reflect " + Reflect.setPrototypeOf(object, second) + " " + Reflect.setPrototypeOf(object, Object.getPrototypeOf(object)));
  }
  lines.push("refusals " + JSON.stringify(counts));
}

function cycles(turns) {
  let refused = 0;
  for (let i = 0; i < turns; i++) {
    const bottom = { level: 0 };
    const middle = { level: 1 };
    const top = { level: 2 };
    Object.setPrototypeOf(bottom, middle);
    Object.setPrototypeOf(middle, top);
    try {
      Object.setPrototypeOf(top, i % 2 ? bottom : middle);
    } catch (error) {
      refused += error instanceof TypeError ? 1 : 0;
    }
    if (Reflect.setPrototypeOf(top, top)) lines.push("an object is its own prototype");
    if (Object.getPrototypeOf(top) !== Object.prototype) lines.push("the top changed");
  }
  lines.push("cycles refused " + refused);
}

// A change in the middle of a chain is seen by reads that went through it before.
function changesAboveReaders(turns) {
  const holder = { kind: "holder" };
  Object.setPrototypeOf(holder, first);
  const readers = [];
  for (let i = 0; i < 8; i++) readers.push(Object.setPrototypeOf({ i }, holder));
  let text = "";
  for (let i = 0; i < turns; i++) {
    Object.setPrototypeOf(holder, i % 2 ? second : first);
    let sum = 0;
    for (const reader of readers) sum += reader.shared();
    if (i < 4 || i === turns - 1) text += readers[i % 8].name() + sum + " ";
  }
  lines.push("above readers " + text);
}

function otherReceivers(turns) {
  const counts = {};
  const count = what => { counts[what] = (counts[what] ?? 0) + 1; };
  for (let i = 0; i < turns; i++) {
    const receivers = [[i], function () {}, () => i, new Map(), new Proxy({}, {}), Object.create(null), new Date(0), /x/, i, "text", true, Symbol.iterator, 10n];
    for (const receiver of receivers) {
      const result = Object.setPrototypeOf(receiver, first);
      if (result !== receiver) lines.push("another result");
      count(typeof receiver + " " + (typeof receiver === "object" || typeof receiver === "function" ? receiver.shared() : Object.getPrototypeOf(receiver) === first));
    }
    for (const receiver of [undefined, null]) {
      try { Object.setPrototypeOf(receiver, first); } catch (error) { count("receiver " + error.constructor.name); }
      try { Reflect.setPrototypeOf(receiver, first); } catch (error) { count("reflect receiver " + error.constructor.name); }
    }
    for (const prototype of [undefined, 1, "text", true, Symbol.iterator]) {
      try { Object.setPrototypeOf({ a: i }, prototype); } catch (error) { count("prototype " + error.constructor.name); }
      try { Reflect.setPrototypeOf({ a: i }, prototype); } catch (error) { count("reflect prototype " + error.constructor.name); }
    }
  }
  lines.push("other receivers " + JSON.stringify(counts));
}

function proxiesAndExtras(turns) {
  let log = 0;
  const watching = new Proxy(first, { get(target, key, receiver) { log++; return Reflect.get(target, key, receiver); } });
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const object = { a: i };
    if (i % 2) object["extra" + (i % 5)] = i;
    Object.setPrototypeOf(object, i % 3 ? watching : second);
    sum += object.shared();
    if (i % 2 && object["extra" + (i % 5)] !== i) lines.push("an extra property is lost");
    if (Object.keys(object).length !== 1 + (i % 2)) lines.push("keys changed");
  }
  lines.push("proxies " + sum + " " + log);
}

function byValue(turns) {
  const functions = [Object.setPrototypeOf, Reflect.setPrototypeOf, (object, prototype) => Object.setPrototypeOf(object, prototype)];
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const object = { a: i };
    functions[i % 3](object, i % 2 ? first : second);
    sum += object.shared();
  }
  lines.push("by value " + sum);
}

function acrossCollections(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const own = { shared() { return i; } };
    const object = Object.setPrototypeOf({ a: i }, own);
    if (i % 500 === 499) Bun.gc(true);
    sum += object.shared() + Object.setPrototypeOf({ a: i }, first).shared();
  }
  lines.push("collections " + sum);
}

changesFreshObjects(4000);
changesOneObject(1000);
changesInstances(3000);
refusals(400);
cycles(300);
changesAboveReaders(300);
otherReceivers(60);
proxiesAndExtras(600);
byValue(3000);
acrossCollections(2000);
console.log(lines.join("\n"));
