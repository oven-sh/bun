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
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

function sortAscending(list, change) {
  let calls = 0;
  const result = list.sort((a, b) => {
    if (calls++ === 0) change();
    return a - b;
  });
  return result === list;
}

function sortedCopy(list, change) {
  let calls = 0;
  return list.toSorted((a, b) => {
    if (calls++ === 0) change();
    return a - b;
  });
}

function sortByKey(list, change) {
  let calls = 0;
  const result = list.sort(function (a, b) {
    if (calls++ === 0) change();
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return result === list;
}

const uses = { sortAscending, sortedCopy, sortByKey };

const otherPrototype = { __proto__: Array.prototype, 3: 1000 };

const changes = {
  "nothing": list => {},
  "stores a double": list => { list[3] = 0.5; },
  "stores a string": list => { list[3] = "s"; },
  "shrinks the length": list => { list.length = 2; },
  "empties it": list => { list.length = 0; },
  "grows the length": list => { list.length = 8; },
  "pushes one": list => { list.push(0); },
  "pushes a hundred": list => { for (let i = 0; i < 100; i++) list.push(0); },
  "pops": list => { list.pop(); },
  "shifts": list => { list.shift(); },
  "deletes an element": list => { delete list[3]; },
  "fills": list => { list.fill(9); },
  "sorts it": list => { list.sort(); },
  "freezes": list => { Object.freeze(list); },
  "seals": list => { Object.seal(list); },
  "fixes the length": list => { Object.defineProperty(list, "length", { writable: false }); },
  "makes an element read-only": list => { Object.defineProperty(list, 3, { writable: false }); },
  "defines a setter": list => { Object.defineProperty(list, 3, { get: () => 1000, set() {}, configurable: true, enumerable: true }); },
  "makes it sparse": list => { list[50000] = 1; },
  "changes the prototype and deletes": list => { Object.setPrototypeOf(list, otherPrototype); delete list[3]; },
  "removes the prototype": list => { Object.setPrototypeOf(list, null); },
};

const kinds = {
  integers: () => [5, 3, 6, 1, 4, 2],
  doubles: () => [5.5, 3.5, 6.5, 1.5, 4.5, 2.5],
  "integers with a hole and an undefined": () => [5, , 6, undefined, 4, 2],
};

const throwing = {
  "a comparator that throws at once": () => { throw new RangeError("comparator"); },
  "a comparator that returns text": (a, b) => String(a - b),
  "a comparator that returns an object": (a, b) => ({ valueOf: () => a - b }),
  "a comparator that returns a big integer": () => 1n,
  "a comparator that returns undefined": () => undefined,
  "a comparator that returns NaN": () => NaN,
  "a comparator that returns true or false": (a, b) => a > b,
};

const notComparators = { null: null, "a number": 5, "a string": "x", "an object": {}, undefined: undefined };

for (const use in uses) for (const kind in kinds) for (let i = 0; i < 300; i++) uses[use](kinds[kind](), () => {});

for (const kind in kinds) {
  for (const name in changes) {
    for (const use in uses) {
      const list = kinds[kind]();
      let answer;
      try {
        answer = describe(uses[use](list, () => changes[name](list)));
      } catch (error) {
        answer = "threw " + error.constructor.name;
      }
      console.log(kind + ", " + use + ", " + name + ": " + answer + " and left " + describe(list));
    }
  }
}

for (const name in throwing) {
  const list = [5, 3, 6, 1, 4, 2];
  attempt(name, () => list.sort(throwing[name]));
  if (name.includes("throws")) console.log("  left " + describe(list));
}
for (const name in notComparators) attempt("instead of a comparator, " + name, () => [3, 1, 2].sort(notComparators[name]));
for (const name in notComparators) attempt("instead of a comparator for a copy, " + name, () => [3, 1, 2].toSorted(notComparators[name]));
