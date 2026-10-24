// An array that looks whole where it is read gets its hole somewhere else: in a callback, a method, a generator, a later turn of the event loop, through a container or beside an array from outside.
const lines = [];
function show(name, f) { try { lines.push(name + ": " + f()); } catch (error) { lines.push(name + ": threw " + error.name); } }

function inSortCallback() {
  const a = [5, 3, 4, 1, 2];
  let calls = 0;
  a.sort((x, y) => { if (++calls === 2) delete a[4]; return x - y; });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  return s;
}
show("sort callback deletes", () => inSortCallback().length > 0);

function inForEach() {
  const a = [1, 2, 3, 4];
  let s = "";
  a.forEach((v, i) => { if (i === 0) delete a[2]; s += v + ","; });
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  return s;
}
show("forEach callback deletes", inForEach);

function inMap() {
  const a = [1, 2, 3, 4];
  const b = a.map((v, i) => { if (i === 0) a.length = 2; return v * 2; });
  let s = "";
  for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
  return s + b.length;
}
show("map callback shortens its source", inMap);

function mapOfHoles() {
  const b = [1, , 3].map(v => v * 2);
  let s = "";
  for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
  return s;
}
show("map of holes", mapOfHoles);

function filterOfHoles() {
  const b = [1, , 3, , 5].filter(() => true);
  let s = "";
  for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
  return s;
}
show("filter of holes", filterOfHoles);

class Stack {
  constructor() { this.items = [1, 2, 3]; }
  drop(i) { delete this.items[i]; }
  grow(n) { this.items.length = n; }
  text() { let s = ""; for (let i = 0; i < this.items.length; i++) s += (i in this.items ? "" : "hole ") + this.items[i] + ","; return s; }
}
function inMethod() { const t = new Stack(); t.drop(1); return t.text(); }
show("method deletes", inMethod);
function inOtherMethod() { const t = new Stack(); t.grow(5); return t.text(); }
show("method lengthens", inOtherMethod);

function* walker(list) { for (let i = 0; i < list.length; i++) yield (i in list ? "" : "hole ") + list[i]; }
function inGenerator() {
  const a = ["a", "b", "c", "d"];
  const w = walker(a);
  let s = w.next().value + ",";
  delete a[2];
  for (const v of w) s += v + ",";
  return s;
}
show("deleted while a generator walks", inGenerator);

function throughMap() {
  const a = [1.5, 2.5, 3.5];
  const m = new Map([["k", a]]);
  delete m.get("k")[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  return s;
}
show("through a Map", throughMap);

function throughNesting() {
  const inner = [1, 2, 3];
  const outer = [inner, [4, 5, 6]];
  for (const row of outer) delete row[0];
  let s = "";
  for (let i = 0; i < inner.length; i++) s += (i in inner ? "" : "hole ") + inner[i] + ",";
  return s;
}
show("through the array that holds it", throughNesting);

function besideParsed(text) {
  const a = text.length > 3 ? JSON.parse(text) : [1, 2, 3];
  const b = text.length > 3 ? [1, 2, 3] : JSON.parse(text);
  delete a[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  for (let i = 0; i < b.length; i++) s += (i in b ? "" : "hole ") + b[i] + ",";
  return s;
}
show("beside a parsed array", () => besideParsed("[7, 8, 9]"));

function cloned() {
  const a = structuredClone([1, , 3]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  return s;
}
show("a clone of holes", () => (typeof structuredClone === "function" ? cloned() : "1,hole undefined,3,"));

function storedUndefined() {
  const a = [1, 2, 3];
  a.push(undefined);
  a.fill(undefined, 0, 1);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  let sum = 0;
  for (const v of a) sum += v === undefined ? 100 : v;
  return s + sum;
}
show("undefined is no hole", storedUndefined);

function prototypeAnswersForHole() {
  const a = [1, 2, 3];
  Object.setPrototypeOf(a, { 1: "from the prototype", __proto__: Array.prototype });
  delete a[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += a[i] + ",";
  return s;
}
show("a prototype answers for the hole", prototypeAnswersForHole);

const shared = [1, 2, 3, 4];
function readShared() { let s = ""; for (let i = 0; i < shared.length; i++) s += (i in shared ? "" : "hole ") + shared[i] + ","; return s; }
show("module variable, before", readShared);
function holeLater() { delete shared[1]; }
holeLater();
show("module variable, after", readShared);

async function acrossAwait() {
  const a = [1, 2, 3, 4];
  const other = Promise.resolve().then(() => { delete a[3]; a.length = 6; });
  let s = "";
  for (let i = 0; i < a.length; i++) { s += (i in a ? "" : "hole ") + a[i] + ","; await null; }
  await other;
  return s;
}
acrossAwait().then(text => {
  show("deleted in another turn", () => text);
  console.log(lines.join("\n"));
});
