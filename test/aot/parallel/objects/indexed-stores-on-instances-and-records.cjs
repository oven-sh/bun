// Stores under an array index to class instances, instances of constructor functions and records with named fields. A CommonJS file, so that storeSloppy() is sloppy code.
const lines = [];
function report(label, ...values) {
  lines.push(label + ": " + values.map(value => (typeof value === "string" ? value : JSON.stringify(value) ?? String(value))).join(" "));
}
function attempt(run) {
  try { return run(); } catch (error) { return error.constructor.name; }
}
function strictStore(object, key, value) { "use strict"; object[key] = value; return object[key]; }
function storeSloppy(object, key, value) { object[key] = value; return object[key]; }

class Row { n = 0; add(x) { this[this.n++] = x; return this; } }
function List() { this.length = 0; }
List.prototype.push = function (x) { this[this.length++] = x; return this.length; };
const record = () => ({ name: "r", n: 0 });

// Appends, holes, kinds of values, order of keys.
for (const [label, create] of [["class", () => new Row()], ["function", () => new List()], ["record", record]]) {
  const o = create();
  for (let i = 0; i < 40; i++) o[i] = i;
  report(label + " ints", Object.keys(o).length, o[0], o[39], o[40], 39 in o, 40 in o);
  o[3] = 1.5;
  o[41] = 2.5;
  report(label + " doubles", o[3], o[41], o[40], Object.keys(o).slice(-4));
  o[4] = "text";
  o[42] = { deep: 1 };
  o[43] = undefined;
  o[44] = NaN;
  report(label + " anything", o[4], o[42], 43 in o, o[44], Object.keys(o).length);
  delete o[5];
  report(label + " deleted", 5 in o, o[5]);
  o[5] = "again";
  report(label + " stored again", 5 in o, o[5], Object.getOwnPropertyDescriptor(o, 5));
  o[1000] = "far";
  o[100000] = "farther";
  o[4294967294] = "last index";
  o[4294967295] = "no index";
  o[-1] = "negative";
  o[1.5] = "fraction";
  o["07"] = "no canonical index";
  o["8"] = "text index";
  report(label + " far", o[1000], o[100000], o[4294967294], o[4294967295], o[-1], o[1.5], o["07"], o[8], Object.keys(o).slice(-9));
  o.later = 1;
  o[45] = "after a name";
  report(label + " keys", Object.keys(o).slice(0, 3), Object.keys(o).slice(-4), Object.entries(o).length, JSON.stringify(o).length);
}

// One element and a length, the first store to each object.
function Wrapped(element) { this[0] = element; this.length = 1; }
let wrapped = 0;
for (let i = 0; i < 50; i++) { const w = new Wrapped(i); wrapped += w[0] + w.length + Array.prototype.slice.call(w).length; }
report("wrapped", wrapped);

// Integrity levels.
for (const [label, lock] of [["preventExtensions", Object.preventExtensions], ["seal", Object.seal], ["freeze", Object.freeze]]) {
  const o = new Row().add("a").add("b");
  lock(o);
  report(label, storeSloppy(o, 0, "changed"), storeSloppy(o, 2, "added"), attempt(() => strictStore(o, 1, "strict")), attempt(() => strictStore(o, 3, "strict")), Object.keys(o));
  const empty = new Row();
  lock(empty);
  report(label + " without elements", storeSloppy(empty, 0, "added"), attempt(() => strictStore(empty, 0, "strict")), Object.keys(empty));
}

// Own elements that are not plain.
{
  const o = new Row().add("a");
  Object.defineProperty(o, 1, { value: "fixed", writable: false, enumerable: true, configurable: true });
  let seen = [];
  Object.defineProperty(o, 2, { set(v) { seen.push(v); }, get() { return "got"; }, enumerable: false, configurable: true });
  report("own read-only and setter", storeSloppy(o, 1, "x"), attempt(() => strictStore(o, 1, "x")), storeSloppy(o, 2, "y"), seen, storeSloppy(o, 0, "z"), storeSloppy(o, 3, "w"), Object.keys(o));
}

// What is above the object.
{
  class Watched { n = 0; }
  const early = new Watched();
  early[7] = "before";
  const seen = [];
  Object.defineProperty(Watched.prototype, 7, { set(v) { seen.push(v); }, get() { return "from above"; }, configurable: true });
  const late = new Watched();
  report("setter above", storeSloppy(late, 7, "x"), Object.keys(late), seen, storeSloppy(early, 7, "own"), storeSloppy(late, 8, "free"), Object.keys(late));
  delete Watched.prototype[7];
  report("setter removed", storeSloppy(late, 7, "now own"), Object.keys(late));
}
{
  class Fixed { n = 0; }
  Object.defineProperty(Fixed.prototype, 2, { value: "fixed above", writable: false });
  const o = new Fixed();
  report("read-only above", storeSloppy(o, 2, "x"), attempt(() => strictStore(o, 2, "x")), Object.keys(o), storeSloppy(o, 3, "y"));
}
{
  class Plain { n = 0; }
  Plain.prototype[1] = "value above";
  const o = new Plain();
  report("value above", o[1], storeSloppy(o, 1, "own"), Object.keys(o), Plain.prototype[1]);
}
{
  class Numbered { n = 0; 0() { return "method 0"; } get 1() { return "getter 1"; } set 2(v) { this.n = v; } }
  const o = new Numbered();
  let calls = "";
  for (let i = 0; i < 20; i++) { calls += o[0]().length; if (i === 10) o[0] = () => "own"; }
  report("members under indices", calls, storeSloppy(o, 1, "x"), attempt(() => strictStore(o, 1, "x")), storeSloppy(o, 2, 5), o.n, Object.keys(o));
}
{
  const log = [];
  class Trapped { n = 0; }
  const o = new Trapped();
  o[0] = "before";
  Object.setPrototypeOf(Trapped.prototype, new Proxy({}, { set(target, key, value, receiver) { log.push(String(key)); return Reflect.set(target, key, value, receiver); } }));
  report("proxy above", storeSloppy(o, 0, "own"), storeSloppy(o, 1, "through"), log, Object.keys(o));
}
{
  class OverBytes { n = 0; }
  Object.setPrototypeOf(OverBytes.prototype, new Uint8Array(4));
  const o = new OverBytes();
  report("typed array above", storeSloppy(o, 1, 9), storeSloppy(o, 9, 9), Object.keys(o));
}
{
  class OverText { n = 0; }
  Object.setPrototypeOf(OverText.prototype, new String("abc"));
  const o = new OverText();
  report("string object above", o[1], storeSloppy(o, 5, "y"), Object.keys(o));
}
{
  const parent = new Row().add("p0");
  const child = Object.create(parent);
  report("an instance above", child[0], storeSloppy(child, 0, "c0"), parent[0], Object.keys(child));
  const frozenParent = Object.freeze(new Row().add("f0"));
  const below = Object.create(frozenParent);
  report("a frozen instance above", storeSloppy(below, 0, "x"), attempt(() => strictStore(below, 0, "x")), Object.keys(below));
  const holder = new Row();
  const reader = Object.create(holder);
  const readings = [];
  for (let i = 0; i < 6; i++) { readings.push(reader[2]); if (i === 2) holder[2] = "appeared"; }
  report("an element appears above", readings);
  const list = [];
  list.length = 3;
  Object.setPrototypeOf(list, holder);
  report("an array with holes below", list[2], list[1]);
  holder[1] = "later";
  report("an array with holes below, later", list[1]);
}

// Other receivers.
{
  const o = new Row().add("a");
  const other = {};
  report("Reflect.set", Reflect.set(o, 0, "x", other), other, o[0], Reflect.set(o, 5, "y"), o[5], Reflect.set(o, 6, "z", 1));
  const target = new Row();
  Object.assign(target, ["a", "b"], { 5: "f" });
  report("Object.assign", Object.keys(target), target[5]);
  const spreadOver = { ...target, 1: "replaced" };
  report("spread", spreadOver);
  for (const key in { 3: 1, 4: 1 }) target[key] = key;
  report("keys out of for-in", Object.keys(target), target[3]);
}

// Array built-ins on an array-like instance.
{
  const list = new List();
  for (let i = 0; i < 10; i++) list.push(i * 2);
  Array.prototype.push.call(list, "pushed");
  Array.prototype.reverse.call(list);
  report("array built-ins", list.length, list[0], Array.prototype.join.call(list, ","), Array.from(list).length, Array.prototype.indexOf.call(list, 4));
  Array.prototype.splice.call(list, 1, 3);
  report("splice", list.length, Array.prototype.join.call(list, ","), Object.keys(list).length);
}

// Many objects, so that collections run in between.
{
  let total = 0;
  for (let round = 0; round < 300; round++) {
    const r = new Row();
    for (let i = 0; i < 100; i++) r.add(i % 7 === 0 ? { i } : i % 5 === 0 ? i + 0.5 : i);
    total += r.n + r[99] + (r[98].i ?? 0) + r[95];
  }
  report("many", total);
}

console.log(lines.join("\n"));
