// Reads of an absent field stay correct as prototypes gain, lose and replace a property of that name.
const host = globalThis as any;
const collect = (full: boolean) => (host.Bun ? host.Bun.gc(full) : full ? host.fullGC() : host.edenGC());

interface P {
  a: number;
  b?: number;
}
interface HasX {
  x?: number;
}
interface HasToString {
  a: number;
  toString?: () => string;
}
class C {
  x?: number;
}
class DeclaredOnly {
  declare x?: number;
}

const objectCount = 10000;

function createRecord(a: number): P {
  return { a };
}
function createRecordWithPrototype(prototype: object | null, a: number): P {
  const record: any = createRecord(a);
  Object.setPrototypeOf(record, prototype);
  return record;
}
function readB(o: P): number | undefined {
  return o.b;
}
function readX(o: HasX): number | undefined {
  return o.x;
}
function readUntyped(o: any, name: string): unknown {
  return name === "b" ? o.b : o.x;
}
function summarizeRecords(records: P[]): string {
  const seen = new Set<string>();
  for (const record of records) seen.add(`${readB(record)} ${readUntyped(record, "b")} ${"b" in record}`);
  return [...seen].join(" | ");
}
function summarizeInstances(instances: HasX[]): string {
  const seen = new Set<string>();
  for (const instance of instances) seen.add(`${readX(instance)} ${readUntyped(instance, "x")} ${"x" in instance}`);
  return [...seen].join(" | ");
}

function changeRecordPrototype(label: string, holder: any, first: object) {
  const records: P[] = [];
  for (let i = 0; i < objectCount; i++) records.push(createRecordWithPrototype(first, i));
  console.log(label, "absent:", summarizeRecords(records));
  holder.other = 1;
  console.log(label, "other name:", summarizeRecords(records));
  holder.b = 7;
  records.push(createRecordWithPrototype(first, -1));
  console.log(label, "added:", summarizeRecords(records));
  delete holder.b;
  records.push(createRecordWithPrototype(first, -2));
  console.log(label, "deleted:", summarizeRecords(records));
  Object.setPrototypeOf(holder, { b: 8 });
  records.push(createRecordWithPrototype(first, -3));
  console.log(label, "replaced:", summarizeRecords(records));
}

function changeInstancePrototype(label: string, holder: any, value: number, create: () => HasX) {
  const instances: HasX[] = [];
  for (let i = 0; i < 100; i++) instances.push(create());
  console.log(label, "before:", summarizeInstances(instances));
  holder.x = value;
  instances.push(create());
  console.log(label, "added:", summarizeInstances(instances));
  delete holder.x;
  instances.push(create());
  console.log(label, "deleted:", summarizeInstances(instances));
  Object.setPrototypeOf(holder, { x: 8 });
  instances.push(create());
  console.log(label, "replaced:", summarizeInstances(instances));
}

function changeChain(depth: number) {
  const last: any = {};
  let first: any = last;
  for (let i = 1; i < depth; i++) first = Object.create(first);
  changeRecordPrototype(`chain of ${depth}`, last, first);
}

function changeClass(label: string, base: new () => HasX) {
  const Derived: any = new Function("Base", "return class D extends Base {}")(base);
  changeInstancePrototype(`${label} derived`, Derived.prototype, 1, () => new Derived());

  function F(this: any) {}
  F.prototype = { x: 2 };
  changeInstancePrototype(`${label} new target`, F.prototype, 3, () => Reflect.construct(base, [], F));
}

function readInheritedToString() {
  const o: HasToString = { a: 1 };
  const untypedRecord: any = { a: 2 };
  const withHelperPrototype: HasToString = untypedRecord;
  Object.setPrototypeOf(withHelperPrototype, { helper() {} });
  const withoutPrototype: HasToString = { a: 3 };
  Object.setPrototypeOf(withoutPrototype, null);
  console.log(o.toString === Object.prototype.toString, withHelperPrototype.toString === Object.prototype.toString, withoutPrototype.toString);
}

function changeEveryPrototype() {
  const prototype = { helper() {} };
  changeRecordPrototype("record", prototype, prototype);
  changeClass("class", C);
  changeClass("declared", DeclaredOnly);
  changeChain(8);
  changeChain(9);
  readInheritedToString();
}

changeEveryPrototype();
collect(true);
changeEveryPrototype();
console.log(createRecordWithPrototype(null, 1).b, createRecord(2).b);
