// Built ins mc: json impostor. It prints what plain Bun prints.
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

function report(label, run) {
  attempt(label, run);
  if (log.length) console.log("  log:", log.splice(0).join(", "));
}

function withSpace(space) {
  return JSON.stringify({ a: [1] }, null, space);
}

function withList(list) {
  return JSON.stringify({ a: 1, b: 2, 1: 3, null: 4, "1,2": 5, nested: { a: 6, c: 7 } }, list);
}

function keysSeenByAReplacer(value) {
  const seen = [];
  JSON.stringify(value, function (key, item) {
    seen.push(typeof key + " " + JSON.stringify(key) + " in " + (Array.isArray(this) ? "list" : "object"));
    return item;
  });
  return seen;
}

function keysSeenByToJSON(build) {
  const seen = [];
  const noisy = { toJSON(key) { seen.push(typeof key + " " + JSON.stringify(key)); return 0; } };
  JSON.stringify(build(noisy));
  return seen;
}

function stringify(value) {
  return JSON.stringify(value);
}

for (let i = 0; i < 2000; i++) {
  withSpace("  ");
  withList(["a", "b"]);
  stringify("text");
  stringify({ a: "text" });
}

for (const space of ["'  '", "''", "'\\t'", "'abcdefghijklmnop'", "2", "0", "-1", "2.9", "11", "'2'", "new String('--')", "new Number(2)", "true", "null", "undefined", "[' ']", "{ toString() { return '  '; } }", "Object.assign(new String('--'), { toString() { log.push('toString'); return '++'; } })", "Object.assign(new Number(1), { valueOf() { log.push('valueOf'); return 3; } })", "Symbol(' ')", "2n"]) {
  report("space " + space, () => withSpace(make(space)));
}

for (const list of ["['a']", "['b', 'a']", "[1]", "['1']", "[null]", "[[1, 2]]", "[new String('a')]", "[new Number(1)]", "[{ toString() { return 'a'; } }]", "['a', 'a', new String('a')]", "[Symbol('a')]", "[true]", "[]", "['nested', 'c']", "'ab'", "{ 0: 'a', length: 1 }", "new Set(['a'])", "[Object.assign(new String('a'), { toString() { log.push('toString'); return 'b'; } })]"]) {
  report("list " + list, () => withList(make(list)));
}

report("keys seen by a replacer", () => keysSeenByAReplacer({ a: [10, { 0: 1 }], 1: "x" }));
report("keys seen by a replacer for a text", () => keysSeenByAReplacer("text"));
report("keys seen by toJSON", () => keysSeenByToJSON(noisy => ({ a: noisy, 1: noisy, list: [noisy, noisy] })));
report("keys seen by toJSON at the top", () => keysSeenByToJSON(noisy => noisy));

for (const value of ["'text'", "'\\u2028\\u2029'", "'\\ud83d'", "'\"\\\\\\n\\u0007'", "new String('wrapped')", "Object.assign(new String('wrapped'), { extra: 1 })", "Object.assign(new String('wrapped'), { toString() { log.push('toString'); return 'changed'; } })", "Object.assign(new String('wrapped'), { valueOf() { log.push('valueOf'); return 'changed'; } })", "Object.setPrototypeOf(new String('wrapped'), null)", "new Proxy(new String('wrapped'), {})", "[new String('a'), new Number(1), new Boolean(false), Object(1n) && null]", "Symbol('s')", "[Symbol('s')]", "{ a: Symbol('s'), [Symbol('k')]: 1 }", "undefined", "[undefined, function f() {}]", "{ a: undefined, b: function f() {} }", "-0", "[NaN, Infinity]", "1n", "{ toJSON() { return 'from toJSON'; } }", "{ toJSON() { return new String('wrapped by toJSON'); } }", "{ toJSON: 'not a function' }", "new Date(0)", "Buffer.from('ab')", "new Uint8Array([1, 2])", "new Map([['a', 1]])", "/a/g", "new Error('message')", "Object.create({ inherited: 1 })", "{ '': 1, ' ': 2, 'a b': 3, '\\n': 4, '\\u00e9': 5, '\\ud83d': 6 }"]) {
  report("stringify " + value, () => stringify(make(value)));
}

console.log("bytes made in plain sight", Buffer.from("he").length);
