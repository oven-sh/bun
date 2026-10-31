// Functions made from text at run time that walk the names of an object with for-in and, inside the loop, read the object under the name, ask whether it has the name, and change it.
// The objects: of the text's own literals, of compiled code's literals and classes, arrays, strings, objects with inherited names, with indexed names, with many names, proxies.
// Each case runs several times: the first run links, the later ones take the short way.
const lines = [];
function show(name, run) {
  const seen = [];
  for (let turn = 0; turn < 4; turn++) {
    try {
      seen.push(JSON.stringify(run(turn)) ?? "undefined");
    } catch (error) {
      seen.push(error.constructor.name);
    }
  }
  lines.push(name + ": " + seen.join(" | "));
}
const make = (parameters, text) => new Function(...parameters, text);
class Point { x = 1; y = 2.5; label = "p"; next = null; }
class Named extends Point { name = "n"; }
const walk = make(["o"], "const all = []; for (const k in o) all.push(k, o[k]); return all;");
const ask = make(["o"], "const all = []; for (const k in o) all.push(k in o, Object.prototype.hasOwnProperty.call(o, k), Object.hasOwn(o, k)); return all;");
const sum = make(["o"], "let t = 0; for (const k in o) { const v = o[k]; if (typeof v === 'number') t += v; } return t;");

const subjects = {
  "a literal of compiled code": () => ({ a: 1, b: "two", c: null, d: [4] }),
  "an instance of a compiled class": () => new Point(),
  "an instance of a class below a class": () => new Named(),
  "an array": () => [10, 20, , 40],
  "a string object": () => new String("abc"),
  "inherited names": () => Object.create({ inherited: 1, shadowed: 2 }, { shadowed: { value: 3, enumerable: true }, hidden: { value: 4, enumerable: false } }),
  "indexed and named": () => Object.assign({ z: 1 }, { 2: "two", 0: "zero", a: 2 }),
  "an object parsed from JSON": () => JSON.parse('{"value":1,"issues":[],"more":{"x":1}}'),
  "no prototype": () => Object.assign(Object.create(null), { a: 1, b: 2 }),
  "forty names": () => Object.fromEntries(Array.from({ length: 40 }, (_, i) => ["n" + i, i])),
  "a compiled instance with one more property": () => Object.assign(new Point(), { extra: 9 }),
  "a compiled instance that lost a field": () => { const p = new Point(); delete p.y; return p; },
  "a frozen literal": () => Object.freeze({ a: 1, b: 2 }),
  "a proxy": () => new Proxy({ a: 1, b: 2 }, {}),
  "a function with properties": () => Object.assign(function f() {}, { a: 1 }),
  "a typed array": () => new Uint8Array([7, 8, 9]),
  "null and undefined": () => null,
};
for (const [name, create] of Object.entries(subjects)) {
  show("names and values: " + name, () => walk(create()));
  show("questions: " + name, () => ask(create()));
  show("a sum: " + name, () => sum(create()));
}

show("the text's own literal", make([], "return function (x) { const o = { a: x, b: x + 1, c: 'c' }; const all = []; for (const k in o) all.push(k, o[k]); return all; };")());
show("another object under the same name", make(["other"], "return function () { const o = { a: 1, b: 2 }; const all = []; for (const k in o) all.push(o[k], other[k]); return all; };")({ a: "A", b: "B" }));
show("the object loses a name in the loop", make([], "return function () { const o = { a: 1, b: 2, c: 3 }; const all = []; for (const k in o) { all.push(k, o[k]); delete o.b; } return all; };")());
show("the object gets a name in the loop", make([], "return function () { const o = { a: 1, b: 2 }; const all = []; for (const k in o) { all.push(k, o[k]); o.z = 9; } return [all, o.z]; };")());
show("a value changes in the loop", make([], "return function () { const o = { a: 1, b: 2, c: 3 }; const all = []; for (const k in o) { o.c = 'changed'; all.push(o[k]); } return all; };")());
show("the variable is assigned in the loop", make([], "return function () { const o = { a: 1, b: 2 }; const all = []; for (let k in o) { all.push(o[k]); k = 'b'; all.push(o[k]); } return all; };")());
show("one loop, objects of several kinds", (() => {
  const list = [{ a: 1 }, new Point(), [5], { b: 2, a: 3 }, new Named(), "st"];
  return () => list.map(o => walk(o));
})());
show("a loop in a loop", make(["o", "p"], "const all = []; for (const k in o) for (const j in p) all.push(k + j, o[k], p[j]); return all;").bind(null, { a: 1, b: 2 }, new Point()));
show("a getter is met", make(["o"], "const all = []; for (const k in o) all.push(o[k]); return all;").bind(null, { get g() { return "got"; }, v: 1 }));
show("three hundred temporaries around the loop", (() => {
  const names = Array.from({ length: 300 }, (_, i) => "v" + i);
  const f = make(["o"], names.map((n, i) => `let ${n} = ${i};`).join("") + "const all = []; for (const k in o) all.push(k, o[k]); return [all, " + names.join("+") + "];");
  return () => f({ a: 1, b: new Point().y });
})());

console.log(lines.join("\n"));
