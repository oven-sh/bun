// TypeScript's classes are structural: plain data with all the members of a class is of its type. Parsed data that is held to an array, a Map, a Set, a Promise, a tuple or a record OF such a class is read as in plain Bun, as data held to the class itself is. Each row has a class of its own, so that what enters in one row shows in the types of that class alone. A class with a private or protected member or a #name is compared by its declaration: only its own instances are of its type, and it stays as it is.
// IR+ ^layout (L\d+) .*name="InAnnotatedArray" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
// IR+ ^layout (L\d+) .*name="InResultArray" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
// IR+ ^layout (L\d+) .*name="InCastArrayPassedOn" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
// IR+ ^layout (L\d+) .*name="InCastArrayStored" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
// IR+ ^layout (L\d+) .*name="InFieldOfAClass" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
// IR- ^layout (L\d+) .*name="NeverGiven" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
// IR- ^layout (L\d+) .*name="WithAPrivateField" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
// IR- ^layout (L\d+) .*name="WithAPrivateName" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
class InAnnotatedArray { field: string = "made"; }
class InResultArray { field: string = "made"; }
class InCastArrayPassedOn { field: string = "made"; }
class InCastArrayStored { field: string = "made"; }
class InMap { field: string = "made"; }
class InSet { field: string = "made"; }
class InPromise { field: string = "made"; }
class InTuple { field: string = "made"; }
class InRecord { field: string = "made"; }
class InProperty { field: string = "made"; }
class InArrayInProperty { field: string = "made"; }
class InArrayOfArrays { field: string = "made"; }
class InFieldOfAClass { field: string = "made"; }
class InArrayInFieldOfAClass { field: string = "made"; }
class NeverGiven { field: string = "made"; }
const one = '{"field":"given"}';

const annotated: InAnnotatedArray[] = JSON.parse(`[${one}]`);
console.log("an annotated array:", annotated[0].field, new InAnnotatedArray().field);

function result(text: string): InResultArray[] { return JSON.parse(text); }
console.log("the result of a function:", result(`[${one}]`)[0].field, new InResultArray().field);

function first(list: InCastArrayPassedOn[]): string { return list[0].field; }
console.log("a cast, passed on:", first(JSON.parse(`[${one}]`) as InCastArrayPassedOn[]), first([new InCastArrayPassedOn()]));

class Store { items: InCastArrayStored[] = [new InCastArrayStored()]; names(): string { return this.items.map(item => item.field).join(); } }
const store = new Store();
console.log("a field, before:", store.names());
store.items = JSON.parse(`[${one},${one}]`) as InCastArrayStored[];
console.log("a cast, stored to a field:", store.names());

const entries: any = JSON.parse(`[["k",${one}]]`);
const map: Map<string, InMap> = new Map(entries) as any;
console.log("a Map:", map.get("k")!.field, new InMap().field);

const members: any = JSON.parse(`[${one}]`);
const set: Set<InSet> = new Set(members) as any;
for (const member of set) console.log("a Set:", member.field, new InSet().field);

const settled: any = Promise.resolve(JSON.parse(one));
const promise: Promise<InPromise> = settled;
console.log("a Promise:", (await promise).field, new InPromise().field);

const tuple: [InTuple, number] = JSON.parse(`[${one},1]`);
console.log("a tuple:", tuple[0].field, tuple[1], new InTuple().field);

const record: Record<string, InRecord> = JSON.parse(`{"k":${one}}`);
console.log("a record:", record.k.field, new InRecord().field);

const holder: { inner: InProperty } = JSON.parse(`{"inner":${one}}`);
console.log("a property:", holder.inner.field, new InProperty().field);

const page: { items: InArrayInProperty[] } = JSON.parse(`{"items":[${one}]}`);
console.log("an array in a property:", page.items[0].field, new InArrayInProperty().field);

const rows: InArrayOfArrays[][] = JSON.parse(`[[${one}]]`);
console.log("an array of arrays:", rows[0][0].field, new InArrayOfArrays().field);

class Outer { id: number = 0; inner: InFieldOfAClass = new InFieldOfAClass(); all: InArrayInFieldOfAClass[] = [new InArrayInFieldOfAClass()]; }
const outer: Outer = JSON.parse(`{"id":1,"inner":${one},"all":[${one}]}`);
console.log("a field of a class:", outer.id, outer.inner.field, new Outer().inner.field);
console.log("an array in a field of a class:", outer.all[0].field, new Outer().all[0].field);

const own: NeverGiven[] = [new NeverGiven()];
console.log("nothing untyped:", own[0].field);

class WithAPrivateField { field: string = "made"; private hidden: number = 1; sum(): number { return this.hidden + 1; } }
class WithAPrivateName { field: string = "made"; #hidden: number = 1; sum(): number { return this.#hidden + 1; } }
const compared: WithAPrivateField[] = JSON.parse("[]");
const named: Map<string, WithAPrivateName> = new Map(JSON.parse("[]"));
compared.push(new WithAPrivateField());
named.set("k", new WithAPrivateName());
console.log("classes that only their own instances satisfy:", compared[0].sum(), named.get("k")!.sum());
