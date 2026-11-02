// Evaluated text stores into ordinary objects at sites that have seen the same store before: a property that is added, with and
// without prototypes to ask, a value that is replaced, and what changes under a site that has settled: a setter or a read-only
// property that appears on a prototype, a frozen, sealed or non-extensible receiver, another prototype, storage that grows.
declare const Bun: { gc(synchronous: boolean): void };

const lines: string[] = [];
function show(label: string, value: unknown): void {
  lines.push(label + " " + JSON.stringify(value));
}

const add = new Function("make", "value", "const o = make(); o.first = value; o.second = [value]; o.third = value + 1; return o;");
const literal = new Function("value", "return { first: value, second: { inner: value }, third: [value] };");
const replace = new Function("o", "value", "o.first = value; return o;");
const strictAdd = new Function("o", "value", "'use strict'; o.added = value; return o;");

for (let i = 0; i < 40; i++) {
  add(() => ({}), i);
  literal(i);
}
show("added", add(() => ({}), 7));
show("literal", literal(7));

const parent: Record<string, unknown> = {};
const underParent = () => Object.create(parent);
for (let i = 0; i < 40; i++) add(underParent, i);
show("under a prototype", add(underParent, 8));
const seen: unknown[] = [];
Object.defineProperty(parent, "second", { set(value) { seen.push(value); }, get() { return "from the getter"; }, configurable: true });
const afterSetter = add(underParent, 9);
show("a setter has appeared", [Object.keys(afterSetter), afterSetter.second, seen]);
Object.defineProperty(parent, "third", { value: "fixed", writable: false, configurable: true });
const afterReadOnly = add(underParent, 10);
show("a read-only property has appeared", [Object.keys(afterReadOnly), afterReadOnly.third]);
delete parent.second;
delete parent.third;
show("both are gone", add(underParent, 11));

const other = { first: "inherited" };
show("another prototype", [add(() => Object.create(other), 12), add(() => Object.create(null), 13).first]);

const target: Record<string, unknown> = { first: 0, kept: "kept" };
for (let i = 0; i < 40; i++) replace(target, i);
show("replaced", replace(target, { deep: [1, 2] }));
show("replaced in a frozen object", replace(Object.freeze({ first: 0, kept: "kept" }), 5));
show("replaced in a sealed object", replace(Object.seal({ first: 0, kept: "kept" }), 5));
show("replaced by undefined, null and a string", [replace(target, undefined).first, replace(target, null).first, replace(target, "text").first]);

for (let i = 0; i < 40; i++) strictAdd({ a: 1 }, i);
show("added in strict code", strictAdd({ a: 1 }, 1));
const closers: [string, (o: object) => object][] = [["frozen", o => Object.freeze(o)], ["sealed", o => Object.seal(o)], ["not extensible", o => Object.preventExtensions(o)]];
for (const [name, close] of closers) {
  try {
    show(name, strictAdd(close({ a: 1 }), 2));
  } catch (error) {
    show(name, (error as Error).constructor.name);
  }
}

const grow = new Function("o", "count", "for (let i = 0; i < count; i++) { o.a = i; o.b = i; o.c = i; o.d = i; o.e = i; o.f = i; o.g = i; o.h = i; o.i = i; o.j = i; } return o;");
for (let i = 0; i < 40; i++) grow({}, 2);
show("storage that grows", grow({}, 3));

// An object that has survived collections takes young values from evaluated text, and they are still there after the next collection.
const old: Record<string, unknown>[] = [];
for (let i = 0; i < 200; i++) old.push({ first: 0 });
Bun.gc(true);
Bun.gc(true);
const keep = new Function("o", "i", "o.first = { young: [i, String(i)] }; o.late = { alsoYoung: i };");
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < old.length; i++) keep(old[i], i + round);
  const garbage: unknown[] = [];
  for (let i = 0; i < 20000; i++) garbage.push({ i, text: "garbage" + i });
  Bun.gc(round === 1);
}
let sum = 0;
for (const o of old) sum += (o.first as { young: [number, string] }).young[0] + Number((o.first as { young: [number, string] }).young[1]) + (o.late as { alsoYoung: number }).alsoYoung;
show("young values in old objects", sum);

console.log(lines.join("\n"));
