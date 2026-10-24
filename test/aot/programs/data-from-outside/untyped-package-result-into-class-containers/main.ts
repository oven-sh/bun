// What a package without types makes comes in as `any`. Held to an array, a Map, a Set, a Promise, a tuple or a record OF a class whose members it has, it is read as in plain Bun, by an annotation, as the result of a function, and as what a function of the package yields that stands in for a method. Each row has a class of its own.
import { functionOfAnUntypedPackage, madeByAnUntypedPackage } from "./package.js";
class A1 { field: string = "made"; }
class A2 { field: string = "made"; }
class A3 { field: string = "made"; }
class A4 { field: string = "made"; }
class A5 { field: string = "made"; }
class A6 { field: string = "made"; }
class A7 { field: string = "made"; }
const array: A1[] = madeByAnUntypedPackage("array");
console.log("annotated, an array:", array[0].field, new A1().field);
const map: Map<string, A2> = madeByAnUntypedPackage("map");
console.log("annotated, a Map:", map.get("k")!.field, new A2().field);
const set: Set<A3> = madeByAnUntypedPackage("set");
console.log("annotated, a Set:", [...set][0].field, new A3().field);
const promise: Promise<A4> = madeByAnUntypedPackage("promise");
console.log("annotated, a Promise:", (await promise).field, new A4().field);
const property: { inner: A5 } = madeByAnUntypedPackage("property");
console.log("annotated, a property:", property.inner.field, new A5().field);
const record: Record<string, A6> = madeByAnUntypedPackage("record");
console.log("annotated, a record:", record.k.field, new A6().field);
const tuple: [A7, number] = madeByAnUntypedPackage("tuple");
console.log("annotated, a tuple:", tuple[0].field, new A7().field);

class B1 { field: string = "made"; }
class B2 { field: string = "made"; }
class B3 { field: string = "made"; }
class B4 { field: string = "made"; }
function arrayResult(): B1[] { return madeByAnUntypedPackage("array"); }
function mapResult(): Map<string, B2> { return madeByAnUntypedPackage("map"); }
function propertyResult(): { inner: B3 } { return madeByAnUntypedPackage("property"); }
function recordResult(): Record<string, B4> { return madeByAnUntypedPackage("record"); }
console.log("a result:", arrayResult()[0].field, mapResult().get("k")!.field, propertyResult().inner.field, recordResult().k.field, new B1().field, new B2().field, new B3().field, new B4().field);

class C1 { field: string = "made"; }
class C2 { field: string = "made"; }
class C3 { field: string = "made"; }
class C4 { field: string = "made"; }
class Service {
  array(): C1[] { return [new C1()]; }
  async promise(): Promise<C2> { return new C2(); }
  map(): Map<string, C3> { return new Map([["k", new C3()]]); }
  property(): { inner: C4 } { return { inner: new C4() }; }
}
const real = new Service();
const standIn: Service = { array: functionOfAnUntypedPackage("array"), promise: functionOfAnUntypedPackage("promise"), map: functionOfAnUntypedPackage("map"), property: functionOfAnUntypedPackage("property") };
for (const service of [real, standIn]) console.log("a method:", service.array()[0].field, (await service.promise()).field, service.map().get("k")!.field, service.property().inner.field);
