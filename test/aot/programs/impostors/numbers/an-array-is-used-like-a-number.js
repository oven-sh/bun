function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

const uses = {
  "value - 0": value => value - 0,
  "+value": value => +value,
  "value * 2": value => value * 2,
  "value + 1": value => value + 1,
  "value | 0": value => value | 0,
  "value < 6": value => value < 6,
  "value == 0": value => value == 0,
  "value == 5": value => value == 5,
  "value == false": value => value == false,
  "!value": value => !value,
  "value++": value => [value++, value],
  "Math.max(value, 1)": value => Math.max(value, 1),
  "'abcdefg'[value]": value => "abcdefg"[value],
  "isNaN(value)": value => isNaN(value),
  "'ab'.repeat(value)": value => "ab".repeat(value),
};

const arrays = {
  "[]": () => [],
  "[5]": () => [5],
  "[1, 2]": () => [1, 2],
  "['5']": () => ["5"],
  "[[5]]": () => [[5]],
  "[[[]]]": () => [[[]]],
  "[null]": () => [null],
  "[undefined]": () => [undefined],
  "[,]": () => [,],
  "[-0]": () => [-0],
  "[true]": () => [true],
  "[5n]": () => [5n],
  "[{}]": () => [{}],
  "[' 5 ']": () => [" 5 "],
  "[1e21]": () => [1e21],
  "Array(1)": () => Array(1),
  "new Array(5)": () => new Array(5),
  "an array with its own valueOf": () => Object.assign([1, 2], { valueOf: () => 3 }),
  "an array with its own toString": () => Object.assign([1, 2], { toString: () => "4" }),
  "an array with its own join": () => Object.assign([1, 2], { join: () => "6" }),
  "an array without join": () => Object.assign([5], { join: undefined }),
  "a subclass that overrides toString": () => new (class extends Array { toString() { return "2"; } })(),
  "a typed array": () => new Uint8Array([5]),
  "an empty typed array": () => new Uint8Array(0),
  "an array that contains itself": () => {
    const list = [];
    list.push(list);
    return list;
  },
};

for (const name of Object.keys(uses)) for (let i = 0; i < 300; i++) uses[name](i % 6);
for (const kind of Object.keys(arrays)) for (const name of Object.keys(uses)) attempt(name + " of " + kind, () => uses[name](arrays[kind]()));
