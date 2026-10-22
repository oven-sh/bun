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

const log = [];

function hinted() {
  return {
    [Symbol.toPrimitive](hint) {
      log.push(hint);
      return hint === "string" ? "1" : hint === "number" ? 2 : 3;
    },
  };
}

const list = ["zero", "one", "two", "three"];
const uses = {
  "value - 0": value => value - 0,
  "value * 1": value => value * 1,
  "+value": value => +value,
  "-value": value => -value,
  "value + 0": value => value + 0,
  "value + ''": value => value + "",
  "0 + value": value => 0 + value,
  "value++": value => value++,
  "value += 1": value => (value += 1),
  "value -= 1": value => (value -= 1),
  "value | 0": value => value | 0,
  "value < 3": value => value < 3,
  "value < '3'": value => value < "3",
  "value == 3": value => value == 3,
  "value == '3'": value => value == "3",
  "value == 3n": value => value == 3n,
  "value === 3": value => value === 3,
  "value == null": value => value == null,
  "value == true": value => value == true,
  "list[value]": value => list[value],
  "value in list": value => value in list,
  "template": value => `${value}`,
  "String(value)": value => String(value),
  "Number(value)": value => Number(value),
  "BigInt(value)": value => BigInt(value),
  "Math.abs(value)": value => Math.abs(value),
  "isNaN(value)": value => isNaN(value),
  "parseInt(value)": value => parseInt(value),
  "new Date(value)": value => new Date(value).getTime(),
  "list.at(value)": value => list.at(value),
  "list.slice(value)": value => list.slice(value),
  "'ab'.repeat(value)": value => "ab".repeat(value),
  "'abc'.charAt(value)": value => "abc".charAt(value),
  "'a1b'.indexOf(value)": value => "a1b".indexOf(value),
  "[value].join()": value => [value].join(),
  "{ [value]: 0 }": value => Object.keys({ [value]: 0 }),
  "new Array(value)": value => new Array(value).length,
  "Object.is(value, 2)": value => Object.is(value, 2),
  "switch": value => {
    switch (value) {
      case 2:
        return "two";
      case 3:
        return "three";
      default:
        return "none";
    }
  },
  "list.indexOf(value)": value => [1, 2, 3].indexOf(value),
  "new Set": value => new Set([2, 3]).has(value),
  "typed array store": value => {
    const array = new Int8Array(1);
    array[0] = value;
    return array[0];
  },
  "JSON.stringify": value => JSON.stringify([value]),
};

for (const round of ["first", "second"]) {
  for (const name of Object.keys(uses)) {
    log.length = 0;
    const result = outcome(() => uses[name](hinted()));
    console.log(round, name, "->", result, "hints:", log.join(", ") || "none");
  }
  for (let i = 0; i < 500; i++) for (const name of Object.keys(uses)) uses[name](i % 4);
}
