// A frozen array is the `prototype` of a function, of a base class or of a generator function. The first construction makes it a prototype, between two reads of one function. Each function is called where the compiler sees the call.
let kept: unknown;
function attempt(f: () => string): string { try { return f(); } catch (e) { return (e as Error).constructor.name; } }
const which = process.argv[2];

const a1 = Object.freeze([1, 2, 3, 4]);
function Made1(this: any) { this.own = 1; }
Made1.prototype = a1;
function construct(a: readonly number[]): string { const x = a[0]; kept = new (Made1 as any)(); return x + "|" + a[0] + "|" + a[1] + "|" + a[3] + "|" + a.length; }

const a2 = Object.freeze([1, 2, 3, 4]);
function Base2() {}
Base2.prototype = a2;
function classOver(a: readonly number[]): string { const x = a[0]; class Derived extends (Base2 as any) {} kept = Derived; return x + "|" + a[0] + "|" + a[1] + "|" + a[3] + "|" + a.length; }

const a3 = Object.freeze([1, 2, 3, 4]);
function* generator3() { yield 1; }
generator3.prototype = a3;
function generate(a: readonly number[]): string { const x = a[0]; kept = generator3(); return x + "|" + a[0] + "|" + a[1] + "|" + a[3] + "|" + a.length; }

const a4 = Object.freeze([1, 2, 3, 4]);
function Made4() {}
Made4.prototype = a4;
function reflectConstruct(a: readonly number[]): string { const x = a[0]; kept = Reflect.construct(Object, [], Made4); return x + "|" + a[0] + "|" + a[1] + "|" + a[3] + "|" + a.length; }

const a5 = Object.freeze([1, 2, 3, 4]);
class Base5 { own = 1; }
function Target5() {}
Target5.prototype = a5;
function reflectConstructClass(a: readonly number[]): string { const x = a[0]; kept = Reflect.construct(Base5, [], Target5); return x + "|" + a[0] + "|" + a[1] + "|" + a[3] + "|" + a.length; }

const a6 = Object.freeze([1, 2, 3, 4]);
async function* asyncGenerator6() { yield 1; }
asyncGenerator6.prototype = a6;
function generateAsync(a: readonly number[]): string { const x = a[0]; kept = asyncGenerator6(); return x + "|" + a[0] + "|" + a[1] + "|" + a[3] + "|" + a.length; }

const a7 = Object.freeze([1, 2, 3, 4]);
function createNull(a: readonly number[]): string { const x = a[0]; kept = Object.create(a); return x + "|" + a[0] + "|" + a[1] + "|" + a[3] + "|" + a.length; }

const a8 = Object.freeze([1, 2, 3, 4]);
function Made8() {}
function storePrototype(a: readonly number[]): string { const x = a[0]; Made8.prototype = a; return x + "|" + a[0] + "|" + a[1] + "|" + a[3] + "|" + a.length; }

const a9 = Object.freeze([1, 2, 3, 4]);
function bound(a: readonly number[]): string { const x = a[0]; const f = function () {}; Object.setPrototypeOf(f, a); kept = f.bind(null); return x + "|" + a[0] + "|" + a[1] + "|" + a[3] + "|" + a.length; }

if (!which || which === "construct") console.log("construct", attempt(() => construct(a1)), attempt(() => construct(a1)));
if (!which || which === "classOver") console.log("classOver", attempt(() => classOver(a2)), attempt(() => classOver(a2)));
if (!which || which === "generate") console.log("generate", attempt(() => generate(a3)), attempt(() => generate(a3)));
if (!which || which === "reflectConstruct") console.log("reflectConstruct", attempt(() => reflectConstruct(a4)), attempt(() => reflectConstruct(a4)));
if (!which || which === "reflectConstructClass") console.log("reflectConstructClass", attempt(() => reflectConstructClass(a5)), attempt(() => reflectConstructClass(a5)));
if (!which || which === "generateAsync") console.log("generateAsync", attempt(() => generateAsync(a6)), attempt(() => generateAsync(a6)));
if (!which || which === "createNull") console.log("createNull", attempt(() => createNull(a7)), attempt(() => createNull(a7)));
if (!which || which === "storePrototype") console.log("storePrototype", attempt(() => storePrototype(a8)), attempt(() => storePrototype(a8)));
if (!which || which === "bound") console.log("bound", attempt(() => bound(a9)), attempt(() => bound(a9)));
