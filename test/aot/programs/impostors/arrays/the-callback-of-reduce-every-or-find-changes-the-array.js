function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, list, run) {
  try {
    console.log(label + ": " + describe(run(list)) + " and left " + describe(list));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name + " and left " + describe(list));
  }
}

const otherPrototype = {
  __proto__: Array.prototype,
  3: "inherited",
  push() {
    return "the other prototype's push";
  },
  *[Symbol.iterator]() {
    yield "the other prototype's iterator";
  },
};

const changes = {
  "nothing": list => {},
  "stores a double ahead": list => { list[3] = 0.5; },
  "stores a string ahead": list => { list[3] = "s"; },
  "stores an object ahead": list => { list[3] = { valueOf() { return 100; } }; },
  "stores undefined ahead": list => { list[3] = undefined; },
  "stores behind": list => { list[0] = "behind"; },
  "shrinks the length": list => { list.length = 2; },
  "empties it": list => { list.length = 0; },
  "grows the length": list => { list.length = 8; },
  "pushes one": list => { list.push(7); },
  "pushes a hundred": list => { for (let i = 0; i < 100; i++) list.push(1); },
  "pops": list => { list.pop(); },
  "shifts": list => { list.shift(); },
  "unshifts": list => { list.unshift(0); },
  "splices two out": list => { list.splice(2, 2); },
  "deletes ahead": list => { delete list[3]; },
  "reverses": list => { list.reverse(); },
  "fills": list => { list.fill(9); },
  "freezes": list => { Object.freeze(list); },
  "seals": list => { Object.seal(list); },
  "prevents extensions": list => { Object.preventExtensions(list); },
  "fixes the length": list => { Object.defineProperty(list, "length", { writable: false }); },
  "defines a getter ahead": list => { Object.defineProperty(list, 3, { get() { return 1000; }, configurable: true, enumerable: true }); },
  "makes an element read-only": list => { Object.defineProperty(list, 3, { writable: false }); },
  "makes it sparse": list => { list[50000] = 1; },
  "changes the prototype": list => { Object.setPrototypeOf(list, otherPrototype); },
  "changes the prototype and deletes ahead": list => { Object.setPrototypeOf(list, otherPrototype); delete list[3]; },
  "removes the prototype": list => { Object.setPrototypeOf(list, null); },
  "adds its own iterator": list => { list[Symbol.iterator] = function* () { yield "its own iterator"; }; },
  "adds its own push": list => { list.push = () => "its own push"; },
  "adds a named property": list => { list.extra = 1; },
};

const kinds = {
  "integers": () => [1, 2, 3, 4, 5, 6],
  "doubles": () => [1.5, 2.5, 3.5, 4.5, 5.5, 6.5],
  "strings": () => ["a", "b", "c", "d", "e", "f"],
};

function sum(list, change) {
  return list.reduce((total, value, index) => {
    if (index === 1) change();
    return total + value;
  }, 0);
}

function visits(list, change) {
  let count = 0;
  list.every((value, index) => {
    if (index === 1) change();
    count++;
    return true;
  });
  return count;
}

function lastVisited(list, change) {
  let last;
  list.find((value, index) => {
    if (index === 1) change();
    last = [index, value];
    return index === 7;
  });
  return last;
}

const uses = {
  "reduce": sum,
  "every": visits,
  "find": lastVisited,
};

for (const use in uses) for (const kind in kinds) for (let i = 0; i < 700; i++) uses[use](kinds[kind](), () => {});

for (const kind in kinds) {
  for (const name in changes) {
    for (const use in uses) {
      attempt(kind + ", " + use + ", " + name, kinds[kind](), list => uses[use](list, () => changes[name](list)));
    }
  }
}

module.exports = uses;
