function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (ArrayBuffer.isView(value)) return value.constructor.name + "<" + Array.prototype.join.call(value, " ") + ">";
  let text;
  try {
    text = String.prototype.valueOf.call(value);
  } catch {
    const parts = [];
    for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + show(value[key]));
    return "{" + parts.join(", ") + "}";
  }
  return "String object " + JSON.stringify(text);
}

function attempt(label, run) {
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + line);
}

function make(text) {
  return (0, eval)("(" + text + ")");
}

const table = { ab: "ab", a1: "a1", "1a": "1a", 3: "3", 12: "12", a_b: "a_b", "1_2": "1_2", "a:b": "a:b", "1:2": "1:2", anull: "anull", aundefined: "aundefined", NaN: "NaN", "a1,2": "a1,2", "a[object Object]": "a[object Object]", "a-0": "a-0", a0: "a0", "0": "0", atrue: "atrue", 2: "2", a: "a", "": "empty", "null:undefined": "null:undefined", "a_": "a_", _: "_", ":": ":" };
const map = new Map(Object.entries(table));

function bySum(a, b) {
  return table[a + b];
}

function byThree(a, b) {
  return table[a + "_" + b];
}

function byTemplate(a, b) {
  return table[`${a}:${b}`];
}

function bySumInAMap(a, b) {
  return map.get(a + b);
}

function byPrefix(b) {
  return table["a" + b];
}

function isThere(a, b) {
  return a + b in table;
}

function storeBySum(a, b) {
  const target = {};
  target[a + b] = 1;
  return Reflect.ownKeys(target).map(key => typeof key + " " + String(key));
}

function countBySum(pairs) {
  const counts = {};
  for (const [a, b] of pairs) {
    const key = a + "|" + b;
    counts[key] = (counts[key] || 0) + 1;
  }
  return JSON.stringify(counts);
}

function idsInALoop(prefix, count) {
  const ids = {};
  for (let i = 0; i < count; i++) ids[prefix + i] = i;
  return Object.keys(ids);
}

const uses = [
  ["a + b", bySum],
  ["a + '_' + b", byThree],
  ["template", byTemplate],
  ["map", bySumInAMap],
  ["'a' + b", (a, b) => byPrefix(b)],
  ["in", isThere],
  ["store", storeBySum],
];

const pairs = [
  ["'a'", "'b'"],
  ["'a'", "1"],
  ["1", "'a'"],
  ["1", "2"],
  ["'1'", "2"],
  ["1", "'2'"],
  ["1n", "2n"],
  ["1n", "'2'"],
  ["1n", "2"],
  ["'a'", "null"],
  ["'a'", "undefined"],
  ["null", "undefined"],
  ["null", "null"],
  ["undefined", "1"],
  ["'a'", "[1, 2]"],
  ["[1]", "[2]"],
  ["[]", "[]"],
  ["'a'", "{}"],
  ["'a'", "-0"],
  ["-0", "-0"],
  ["'a'", "true"],
  ["true", "true"],
  ["'a'", "''"],
  ["''", "''"],
  ["new String('a')", "new String('b')"],
  ["new Number(1)", "new Number(2)"],
  ["{ valueOf() { return 1; }, toString() { return 'a'; } }", "2"],
  ["{ valueOf() { return 1; }, toString() { return 'a'; } }", "'b'"],
  ["'a'", "Symbol('b')"],
  ["Symbol('a')", "'b'"],
  ["new Date(0)", "1"],
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) total += String(use("a", "b")).length;
  total += countBySum([["a", "b"]]).length + idsInALoop("id", 3).length;
}
console.log("2000 honest rounds", total);

for (const [a, b] of pairs) {
  console.log(a + ", " + b + " -> " + uses.map(([name, use]) => {
    try {
      return name + ": " + show(use(make(a), make(b)));
    } catch (error) {
      return name + ": threw " + error.constructor.name;
    }
  }).join("; "));
}

attempt("counted pairs", () => countBySum([["a", "b"], ["a", "b"], [1, 2], ["1", "2"], [null, undefined], [[1], [2]], [-0, 0], ["a|b", ""], ["a", "b|"]]));
attempt("counted pairs with a symbol", () => countBySum([["a", Symbol("b")]]));
for (const prefix of ["'id'", "''", "0", "1", "-1", "0.5", "null", "[]", "[1]", "1n", "{}", "new String('id')", "Symbol('id')"]) attempt("ids with the prefix " + prefix, () => idsInALoop(make(prefix), 3));
