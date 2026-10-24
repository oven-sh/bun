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

function* byIndex(list) {
  for (let i = 0; i < list.length; i++) yield list[i];
}

function* byIndexWithACachedLength(list) {
  for (let i = 0, length = list.length; i < length; i++) yield list[i];
}

function* byIteration(list) {
  for (const value of list) yield value;
}

function* byDelegation(list) {
  yield* list;
}

function* runningTotal(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    total += list[i];
    yield total;
  }
}

function* storing(list) {
  for (let i = 0; i < list.length && i < 8; i++) {
    list[i] = yield list[i];
  }
}

function* pushing(list) {
  for (let turn = 0; turn < 4; turn++) yield list.push(turn);
}

const generators = { byIndex, byIndexWithACachedLength, byIteration, byDelegation, runningTotal, storing, pushing };

const otherPrototype = {
  __proto__: Array.prototype,
  3: "inherited",
  push() {
    return "the other prototype's push";
  },
};

const changes = {
  "nothing": list => {},
  "stores a double ahead": list => { list[3] = 0.5; },
  "stores a string ahead": list => { list[3] = "s"; },
  "shrinks the length": list => { list.length = 2; },
  "empties it": list => { list.length = 0; },
  "pushes a hundred": list => { for (let i = 0; i < 100; i++) list.push(1); },
  "shifts": list => { list.shift(); },
  "deletes ahead": list => { delete list[3]; },
  "freezes": list => { Object.freeze(list); },
  "defines a getter ahead": list => { Object.defineProperty(list, 3, { get: () => 1000, configurable: true, enumerable: true }); },
  "makes it sparse": list => { list[50000] = 1; },
  "changes the prototype and deletes ahead": list => { Object.setPrototypeOf(list, otherPrototype); delete list[3]; },
  "removes the prototype": list => { Object.setPrototypeOf(list, null); },
  "adds its own push": list => { list.push = () => "its own push"; },
  "adds its own iterator": list => { list[Symbol.iterator] = function* () { yield "its own iterator"; }; },
};

function run(generator, list, change) {
  const steps = generator(list);
  const seen = [];
  for (let turn = 0; turn < 9; turn++) {
    if (turn === 2) change(list);
    const step = steps.next("sent " + turn);
    if (step.done) break;
    seen.push(step.value);
  }
  return seen;
}

for (const name in generators) for (let i = 0; i < 500; i++) run(generators[name], [1, 2, 3, 4, 5, 6], () => {});

for (const name in generators) {
  for (const change in changes) {
    const list = [1, 2, 3, 4, 5, 6];
    attempt(name + ", " + change, () => run(generators[name], list, changes[change]));
    console.log("  left " + describe(list));
  }
}
