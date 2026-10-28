// Object literals and arrays, handed to the addon. A line that begins with LOCKED changes a built-in object, which an executable made by bun compile refuses.
const loaded = { exports: {} };
process.dlopen(loaded, process.env.ADDON);
const attack = loaded.exports;
let at = 0;
function row(label, f) {
  let said;
  try {
    said = JSON.stringify(f());
  } catch (error) {
    said = "threw " + error.constructor.name;
  }
  console.log(String(++at).padStart(3) + " " + label + ": " + said);
}

const makeRecord = () => ({ id: 1, name: "one", nested: { deep: 2 }, list: [1, 2, 3] });
function readRecord(record) {
  let sum = 0;
  for (let round = 0; round < 200; round++) sum += record.id + record.nested.deep + record.list.length + record.name.length;
  return sum;
}
function lookAtRecord(record) {
  return [readRecord(record), JSON.stringify(record), Object.keys(record).join()];
}
row("record untouched", () => lookAtRecord(makeRecord()));
row("record store", () => { const r = makeRecord(); return [attack.store(r, "id", 5), lookAtRecord(r)]; });
row("record store of another kind", () => { const r = makeRecord(); return [attack.store(r, "name", [1, 2]), lookAtRecord(r)]; });
row("record nested object replaced", () => { const r = makeRecord(); return [attack.store(r, "nested", { deep: 40, more: 1 }), lookAtRecord(r)]; });
row("record nested object changed", () => { const r = makeRecord(); return [attack.storeInto(r, "nested", "deep", 50), lookAtRecord(r)]; });
row("record nested object made null", () => { const r = makeRecord(); attack.store(r, "nested", null); return readRecord(r); });
row("record list changed", () => { const r = makeRecord(); return [attack.storeInto(r, "list", "length", 1), attack.storeInto(r, "list", 5, 6), lookAtRecord(r)]; });
row("record new names", () => { const r = makeRecord(); for (let i = 0; i < 40; i++) attack.store(r, "k" + i, i); return [readRecord(r), Object.keys(r).length, r.k39]; });
row("record remove", () => { const r = makeRecord(); return [attack.removeKey(r, "id"), lookAtRecord(r)]; });
row("record remove all", () => { const r = makeRecord(); for (const key of Object.keys(r)) attack.removeKey(r, key); return [JSON.stringify(r), r.id, typeof r.nested]; });
row("record getter", () => { const r = makeRecord(); return [attack.defineGetter(r, "id"), lookAtRecord(r)]; });
row("record hidden value", () => { const r = makeRecord(); return [attack.defineValue(r, "id", 8, 1), lookAtRecord(r)]; });
row("record symbol key", () => { const r = makeRecord(); const key = Symbol("s"); return [attack.store(r, key, 3), r[key], lookAtRecord(r)]; });
row("record freeze, then the program stores", () => { "use strict"; const r = makeRecord(); attack.freeze(r); r.id = 2; return r.id; });
row("record prototype with a name the record lacks", () => { const r = makeRecord(); return [attack.setPrototype(r, { extra: 9, get id() { return -1; } }), r.extra, lookAtRecord(r)]; });
row("record then", () => { const r = makeRecord(); return [attack.store(r, "then", 5), typeof r.then, lookAtRecord(r)]; });
row("record toJSON", () => { const r = makeRecord(); return [attack.store(r, "toJSON", () => "replaced"), JSON.stringify(r), JSON.stringify([r])]; });

function sumOf(array) {
  let sum = 0;
  for (let round = 0; round < 100; round++) for (let i = 0; i < array.length; i++) sum += array[i];
  return sum;
}
function lookAtArray(array) {
  return [sumOf(array), array.length, JSON.stringify(array), array.map(x => x).length, array.indexOf(3), 1 in array];
}
for (const [kind, make] of Object.entries({ integers: () => [1, 2, 3, 4], fractions: () => [1.5, 2.5, 3, 4], values: () => [1, "2", 3, null] })) {
  row(kind + " untouched", () => lookAtArray(make()));
  row(kind + " element", () => { const a = make(); return [attack.storeElement(a, 0, 10), lookAtArray(a)]; });
  row(kind + " element of another kind", () => { const a = make(); return [attack.storeElement(a, 1, "s"), attack.storeElement(a, 2, 0.25), lookAtArray(a)]; });
  row(kind + " element by a key", () => { const a = make(); return [attack.store(a, "1", 20), attack.store(a, 2, 30), lookAtArray(a)]; });
  row(kind + " element at the end", () => { const a = make(); return [attack.storeElement(a, 4, 5), lookAtArray(a)]; });
  row(kind + " element far behind the end", () => { const a = make(); return [attack.storeElement(a, 5000, 5), a.length, sumOf(a.slice(0, 4)), a[4999], a[5000]]; });
  row(kind + " length", () => { const a = make(); return [attack.store(a, "length", 2), lookAtArray(a)]; });
  row(kind + " hole", () => { const a = make(); return [attack.removeKey(a, 1), lookAtArray(a)]; });
  row(kind + " name", () => { const a = make(); return [attack.store(a, "tag", 1), a.tag, lookAtArray(a), Object.keys(a).join()]; });
  row(kind + " getter under an index", () => { const a = make(); return [attack.defineGetter(a, "1"), lookAtArray(a)]; });
  row(kind + " freeze, then the program pushes", () => { const a = make(); attack.freeze(a); a.push(1); return a.length; });
  row(kind + " freeze, then the program stores", () => { "use strict"; const a = make(); attack.freeze(a); a[0] = 9; return a[0]; });
  row(kind + " prototype with elements, then a hole", () => { const a = make(); return [attack.setPrototype(a, Object.assign(Object.create(Array.prototype), { 1: 77 })), attack.removeKey(a, 1), sumOf(a), a[1], Array.isArray(a)]; });
  row(kind + " changed inside the loop", () => { const a = make(); let sum = 0; for (let i = 0; i < a.length && i < 12; i++) { sum += a[i]; if (i === 1) { attack.storeElement(a, 2, 100); attack.storeElement(a, 6, 1); } } return [String(sum), a.length]; });
  row(kind + " shortened inside the loop", () => { const a = make(); let seen = ""; for (let i = 0; i < a.length; i++) { seen += a[i] + ","; if (i === 1) attack.store(a, "length", 2); } return seen; });
  row(kind + " changed inside a callback", () => { const a = make(); return [a.map((x, i) => { if (i === 0) attack.storeElement(a, 3, "late"); return x; }), a.length]; });
}
// The same stores made by the program itself (LOCKED_BY=program) must have the same effect: built-in objects are locked against native code as against anybody.
const byProgram = process.env.LOCKED_BY === "program";
function storeIntoBuiltin(holder, member, key, value) {
  if (!byProgram) return member ? attack.storeIntoBuiltin(holder, member, key, value) : attack.storeIntoGlobal(holder, key, value);
  try {
    (member ? globalThis[holder][member] : globalThis[holder])[key] = value;
    return "ok";
  } catch (error) {
    return "threw " + error.name + ": " + error.message.replace(/ \(bun compile differs .*$/, "");
  }
}
const sparse = [1, 2, 3];
delete sparse[1];
row("LOCKED Array.prototype gets a name", () => [storeIntoBuiltin("Array", "prototype", "extra", 1), [].extra ?? "none"]);
row("LOCKED Array.prototype gets an element", () => [storeIntoBuiltin("Array", "prototype", 1, 88), sparse[1] ?? "none"]);
row("LOCKED Object.prototype gets a name", () => [storeIntoBuiltin("Object", "prototype", "extra", 2), {}.extra ?? "none"]);
row("LOCKED Array.prototype.push is replaced", () => [storeIntoBuiltin("Array", "prototype", "push", () => -1), [].push(1)]);
row("LOCKED Math.max is replaced", () => [storeIntoBuiltin("Math", null, "max", () => -1), Math.max(1, 2)]);
row("LOCKED Promise.prototype.then is replaced", () => [storeIntoBuiltin("Promise", "prototype", "then", () => -1), typeof Promise.resolve(1).then(() => 1)]);
row("LOCKED Function.prototype.call is replaced", () => [storeIntoBuiltin("Function", "prototype", "call", () => -1), (function () { return 1; }).call()]);
