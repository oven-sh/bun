// Object spread copies. A stub copies a plain object whose properties are all inline, from a cache keyed by structure. The runtime copies every other source.
const print = (...parts) => console.log(parts.join(" "));

const show = object =>
  "{ " +
  Reflect.ownKeys(object)
    .map(key => {
      const { value, writable, enumerable, configurable } = Object.getOwnPropertyDescriptor(object, key);
      const text = typeof value === "function" ? "function" : JSON.stringify(value);
      return String(key) + ": " + text + (writable && enumerable && configurable ? "" : " (not a default data property)");
    })
    .join(", ") +
  " }" +
  (Object.getPrototypeOf(object) === Object.prototype ? "" : " (another prototype)") +
  (Object.isExtensible(object) ? "" : " (not extensible)");

const forms = [
  ["{ ...o }", o => ({ ...o })],
  ["{ ...o, a: 1 }", o => ({ ...o, a: 1 })],
  ["{ ...o, a: 1, b: 2 }", o => ({ ...o, a: 1, b: 2 })],
  ["{ a: 1, ...o }", o => ({ a: 1, ...o })],
];

const values = [1, 1.5, "text", null, true, { nested: 1 }, [1, 2]];
const textOf = names => "{" + names.map((name, i) => JSON.stringify(name) + ":" + JSON.stringify(values[i])).join(",") + "}";
const namesStartingWithA = count => Array.from({ length: count }, (_, i) => (i === 0 ? "a" : "p" + i));
const namesEndingWithB = count => Array.from({ length: count }, (_, i) => (i === count - 1 ? "b" : "q" + i));

for (const count of [0, 1, 6, 7]) {
  const texts = [textOf(namesStartingWithA(count)), textOf(namesEndingWithB(count))];
  for (const [form, copy] of forms) {
    const counts = new Map();
    let sharedObjects = 0;
    let changedSources = 0;
    for (let i = 0; i < 1000; i++) {
      const text = texts[i & 1];
      const source = JSON.parse(text);
      const copied = copy(source);
      const shown = show(copied);
      counts.set(shown, (counts.get(shown) ?? 0) + 1);
      for (const key in source) {
        if (typeof source[key] === "object" && source[key] !== null && copied[key] === source[key]) sharedObjects++;
      }
      for (const key in copied) copied[key] = i;
      copied.added = i;
      if (JSON.stringify(source) !== text) changedSources++;
    }
    for (const [shown, times] of counts) print(count, "properties,", form + ":", times, "times", shown);
    print(count, "properties,", form + ":", sharedObjects, "shared objects,", changedSources, "changed sources");
  }
}

const sourcesWithOwnStructure = Array.from({ length: 600 }, (_, i) => JSON.parse(`{"k${i}":${i},"shared":"s"}`));
for (const [form, copy] of forms) {
  let keys = 0;
  let mismatches = 0;
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < sourcesWithOwnStructure.length; i++) {
      const copied = copy(sourcesWithOwnStructure[i]);
      if (copied["k" + i] !== i || copied.shared !== "s") mismatches++;
      keys += Object.keys(copied).length;
    }
  }
  print("600 structures,", form + ":", keys, "keys,", mismatches, "mismatches");
}

function copyInLoop(label, createSource) {
  for (const [form, copy] of forms) {
    const counts = new Map();
    for (let i = 0; i < 100; i++) {
      const shown = show(copy(createSource()));
      counts.set(shown, (counts.get(shown) ?? 0) + 1);
    }
    for (const [shown, times] of counts) print(label + ",", form + ":", times, "times", shown);
  }
}

copyInLoop("out-of-line properties", () => {
  const source = {};
  for (let i = 0; i < 10; i++) source["w" + i] = i;
  return source;
});

let getterCalls = 0;
copyInLoop("getter", () => ({
  x: 1,
  get y() {
    getterCalls++;
    return this.x + 1;
  },
}));
print("getter calls:", getterCalls);

copyInLoop("index keys", () => ({ x: 1, 2: "two", 0: "zero" }));
copyInLoop("index key in parsed JSON", () => JSON.parse('{"x":1,"0":"zero"}'));
copyInLoop("array", () => [1, 2]);
copyInLoop("inherited property", () => Object.assign(Object.create({ inherited: 1 }), { x: 1 }));
copyInLoop("null prototype", () => Object.assign(Object.create(null), { x: 1 }));
copyInLoop("non-enumerable property", () => Object.defineProperty(JSON.parse('{"x":1}'), "hidden", { value: 2, enumerable: false }));
copyInLoop("frozen", () => Object.freeze(JSON.parse('{"x":1,"a":2}')));
copyInLoop("null", () => null);
copyInLoop("undefined", () => undefined);
copyInLoop("string", () => "ab");
copyInLoop("number", () => 7);

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  sum() {
    return this.x + this.y;
  }
}
copyInLoop("class instance", () => new Point(1, 2));
copyInLoop("class instance with an extra property", () => {
  const point = new Point(1, 2);
  point.extra = "extra";
  return point;
});

class Reading {
  constructor(value) {
    this.value = value;
  }
}
const showNumber = number => (Object.is(number, -0) ? "-0" : String(number));
for (const [form, copy] of forms) {
  for (const value of [1, 1.5, 2 ** 31, -0]) {
    const source = new Reading(value);
    const copied = copy(source);
    copied.value += 0.25;
    const sourceAfterCopyChanged = source.value;
    source.value = 9.5;
    print("number field,", form + ":", "source", showNumber(sourceAfterCopyChanged), "copy", showNumber(copied.value));
  }
}

class Button {
  constructor(label) {
    this.label = label;
  }
  onClick = () => this.label;
}
for (const [form, copy] of forms) {
  let sameFunction = 0;
  let sameReceiver = 0;
  for (let i = 0; i < 100; i++) {
    const source = new Button("label " + i);
    const copied = copy(source);
    if (copied.onClick === source.onClick) sameFunction++;
    copied.label = "changed";
    if (copied.onClick() === "label " + i) sameReceiver++;
  }
  print("arrow function field,", form + ":", sameFunction, "same function,", sameReceiver, "same receiver,", show(copy(new Button("last"))));
}
