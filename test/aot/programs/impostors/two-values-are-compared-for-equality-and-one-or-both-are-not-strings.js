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

const log = [];
globalThis.log = log;

function loose(a, b) {
  return a == b;
}

function looseNot(a, b) {
  return a != b;
}

function strict(a, b) {
  return a === b;
}

function strictNot(a, b) {
  return a !== b;
}

function same(a, b) {
  return Object.is(a, b);
}

function included(a, b) {
  return [a].includes(b);
}

function found(a, b) {
  return [a].indexOf(b);
}

function inASet(a, b) {
  return new Set([a]).has(b);
}

function inASwitch(a, b) {
  switch (a) {
    case b:
      return true;
  }
  return false;
}

function countEqual(values, wanted) {
  let count = 0;
  for (let i = 0; i < values.length; i++) if (values[i] === wanted) count++;
  return count;
}

function countLooselyEqual(values, wanted) {
  let count = 0;
  for (let i = 0; i < values.length; i++) if (values[i] == wanted) count++;
  return count;
}

const uses = [loose, looseNot, strict, strictNot, same, included, found, inASet, inASwitch];

let total = 0;
for (let i = 0; i < 2000; i++) {
  const a = "abc"[i % 3];
  const b = "cab"[i % 3];
  for (const use of uses) if (use(a, b)) total++;
  total += countEqual(["a", "b", a], b) + countLooselyEqual(["a", "b", a], b);
}
console.log("2000 honest rounds", total);

const pairs = [
  ["'abc'", "'abc'"],
  ["'abc'", "'ab' + 'c'"],
  ["'abc'", "'abc\\u4e16'.slice(0, 3)"],
  ["'abc'", "'abd'"],
  ["'abc'", "'ABC'"],
  ["''", "''"],
  ["'abc'", "new String('abc')"],
  ["new String('abc')", "'abc'"],
  ["new String('abc')", "new String('abc')"],
  ["'abc'", "['abc']"],
  ["['abc']", "['abc']"],
  ["'1'", "1"],
  ["1", "'1'"],
  ["'1'", "1n"],
  ["1n", "'1'"],
  ["1", "1n"],
  ["'1'", "true"],
  ["'true'", "true"],
  ["'0'", "false"],
  ["''", "false"],
  ["''", "0"],
  ["''", "-0"],
  ["''", "null"],
  ["''", "undefined"],
  ["''", "[]"],
  ["''", "[[]]"],
  ["'0'", "[0]"],
  ["'null'", "null"],
  ["'undefined'", "undefined"],
  ["null", "undefined"],
  ["'NaN'", "NaN"],
  ["NaN", "NaN"],
  ["0", "-0"],
  ["'0'", "-0"],
  ["'-0'", "-0"],
  ["' 1 '", "1"],
  ["'1e0'", "1"],
  ["'0x1'", "1"],
  ["'1,2'", "[1, 2]"],
  ["'[object Object]'", "{}"],
  ["'a'", "Symbol('a')"],
  ["Symbol.for('a')", "Symbol.for('a')"],
  ["Symbol.for('a')", "Object(Symbol.for('a'))"],
  ["'a'", "{ toString() { log.push('toString'); return 'a'; } }"],
  ["{ toString() { log.push('left'); return 'a'; } }", "{ toString() { log.push('right'); return 'a'; } }"],
  ["'a'", "{ valueOf() { log.push('valueOf'); return 'a'; }, toString() { log.push('toString'); return 'b'; } }"],
  ["'default'", "{ [Symbol.toPrimitive](hint) { log.push(hint); return hint; } }"],
  ["1", "{ [Symbol.toPrimitive](hint) { log.push(hint); return '1'; } }"],
  ["null", "{ toString() { log.push('toString'); return 'null'; } }"],
  ["'a'", "{ toString() { throw new RangeError('no'); } }"],
  ["'a'", "Buffer.from('a')"],
  ["'97'", "new Uint8Array([97])"],
  ["'\\u00e9'", "'e\\u0301'"],
  ["'\\ud83d'", "'\\ud83d\\ude00'[0]"],
];

for (const [a, b] of pairs) {
  let line;
  try {
    const left = make(a);
    const right = make(b);
    line = uses.map(use => show(use(left, right))).join(" ");
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(a + " and " + b + " -> " + line);
  if (log.length) console.log("  log:", log.splice(0).join(", "));
}

const mixed = make("['1', 1, 1n, true, new String('1'), [1], '1.0', ' 1', null, undefined, NaN, { valueOf() { return 1; } }]");
for (const wanted of ["'1'", "1", "1n", "true", "null", "undefined", "NaN", "new String('1')", "[1]"]) {
  attempt("how many of the mixed list equal " + wanted, () => [countEqual(mixed, make(wanted)), countLooselyEqual(mixed, make(wanted))]);
}

console.log("bytes made in plain sight", Buffer.from("he").length);
