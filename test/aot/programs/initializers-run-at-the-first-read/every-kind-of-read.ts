// A lazy binding read from every kind of place.
const table = { a: 1, b: 2, list: [1, 2, 3] };
const names = ["x", "y", "z"];
const nested = { inner: { value: 7 } };
const handlers = { run: (n: number) => n + 1 };
const weak = new WeakMap<object, number>();
const big = new Uint8Array(16);
enum Kind { A, B, C }
const out: unknown[] = [];

async function asyncReader() { await null; out.push(table.a); await Promise.resolve(); out.push(names[1]); return nested.inner.value; }
function* generatorReader() { yield table.b; yield* names; yield nested.inner.value; }
async function* asyncGeneratorReader() { yield table.a; await null; yield names.length; }
function tryReader() { try { out.push(table.list.length); throw new Error("t"); } catch (error) { out.push(names[0]); } finally { out.push(nested.inner.value); } }
function loopReader() { let sum = 0; for (let i = 0; i < 3; i++) sum += table.list[i]!; for (const n of names) sum += n.length; for (const k in table) sum += k.length; while (sum < 20) sum += nested.inner.value; return sum; }
function defaultReader(value = table.a, { x = names[2] } = {}) { return [value, x]; }
function switchReader(k: Kind) { switch (k) { case Kind.A: return table.a; case Kind.B: return names[0]; default: return Kind[k]; } }
function closureReader() { return () => () => handlers.run(table.b); }
function typeofReader() { return [typeof table, typeof names, typeof weak, typeof big]; }
function optionalReader() { return [(table as any)?.zzz?.y, nested?.inner?.value, handlers.run?.(1)]; }
function spreadReader() { return [...names, ...table.list, { ...nested }]; }
function tagReader() { const tag = (s: TemplateStringsArray, ...v: unknown[]) => s.join("|") + v.join(","); return tag`a${table.a}b${names[0]}c`; }
function conditionalReader(flag: boolean) { return flag ? table : names; }
function recursiveReader(n: number): number { return n ? recursiveReader(n - 1) + table.a : nested.inner.value; }
function argumentsReader(..._rest: unknown[]) { return arguments.length + names.length; }
class Reader {
  field = table.a;
  static fixed = names.length;
  static { out.push("static block " + nested.inner.value); }
  get value() { return table.b; }
  set value(v: number) { out.push(v + table.a); }
  method() { return handlers.run(this.field); }
  arrow = () => names.join("");
  static make() { return new Reader(); }
  [Symbol.iterator]() { return names[Symbol.iterator](); }
}
class Derived extends Reader { constructor() { out.push(table.a); super(); out.push(names[0]); } method() { return super.method() + big.length; } }
const getter = { get lazy() { return table.list; } };

async function main() {
  out.push(await asyncReader());
  out.push([...generatorReader()]);
  for await (const v of asyncGeneratorReader()) out.push(v);
  tryReader();
  out.push(loopReader(), defaultReader(), switchReader(Kind.A), switchReader(Kind.B), switchReader(Kind.C), closureReader()()(), typeofReader(), optionalReader(), spreadReader(), tagReader());
  out.push(conditionalReader(true) === table, conditionalReader(false) === names, recursiveReader(5), argumentsReader(1, 2));
  const r = Reader.make(); r.value = 5;
  out.push(r.field, Reader.fixed, r.value, r.method(), r.arrow(), [...r], new Derived().method(), getter.lazy.length);
  weak.set(table, 1); out.push(weak.get(table), big[0]);
  await Promise.all([asyncReader(), asyncReader()]);
  setTimeout(() => { out.push(names.length); console.log(JSON.stringify(out)); }, 1);
}
main();
