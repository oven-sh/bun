// `name in heir`, where heir is a plain object whose prototype is a typed object: Object.create(typed). The heir's entry in the table of `in` says only "not mine: ask my prototype", and the stub looks the prototype up in the same table, so what a typed object answers for itself (always there; read this optional field; ask above) is asked anew each time, without entering the runtime. Every change below is made AFTER the entries are there.
// Env: JSC_aotCountsPath=/dev/null
declare const aotOperationCount: undefined | ((name: string) => number);
interface Step { op: string; weight: number; inner: { a: number }; run(this: any, x: number): number; note?: string; size?: number }
function makeStep(op: string, weight: number): Step { return { op, weight, inner: { a: weight }, run(this: any, x: number): number { return x + this.weight; } }; }
const steps: Step[] = [makeStep("add", 1.5), makeStep("sub", 2.5), makeStep("mul", 3.5)];
let typedSum = 0;
for (const step of steps) typedSum += step.weight + step.op.length + step.inner.a + step.run(1) + (step.note ?? "").length + (step.size ?? 0);
console.log(typedSum);
class Shape { sides: number; label?: string; constructor(sides: number) { this.sides = sides; } area(): number { return this.sides * 2; } }
const shapes: Shape[] = [new Shape(3), new Shape(4)];
let shapeSum = 0;
for (const shape of shapes) shapeSum += shape.area() + (shape.label ?? "").length;
console.log(shapeSum);
const entered = (): number => typeof aotOperationCount === "function" ? aotOperationCount("operationAOTInByValAndCache") : 0;
const has = function (o: any, key: any): any { return key in o; };
const mark = Symbol("mark");
const names: any[] = ["op", "weight", "inner", "run", "note", "size", "missing", "toString", "value", "later", "0", mark];
const all = (o: any): string => names.map(name => String(name) + "=" + (has(o, name) ? 1 : 0)).join(" ");
const base: any = (function (x: any): any { return x; })(steps[0]);
const heir: any = Object.create(base);
heir.value = 1;
const below: any = Object.create(heir);
const deeper: any = Object.create(below);
console.log("heir  ", all(heir));
console.log("below ", all(below));
console.log("deeper", all(deeper));
for (const [what, o] of [["heir", heir], ["below", below], ["deeper", deeper]] as [string, any][]) {
  for (const name of ["op", "run", "note", "missing", "toString", mark]) {
    const first = has(o, name);
    const before = entered();
    let same = 0;
    for (let i = 0; i < 2000; i++) same += has(o, name) === first ? 1 : 0;
    console.log(what, String(name), first, same, entered() - before < 20);
  }
}
base.note = "now";
console.log("an optional field is set on the prototype:", all(heir), "|", has(below, "note"), has(deeper, "note"));
delete base.note;
console.log("and deleted:", all(heir), "|", has(below, "note"), has(deeper, "note"));
base.size = 3;
console.log("another is set:", has(heir, "size"), has(below, "size"), has(deeper, "size"));
base.later = 1;
console.log("a property beyond the layout:", all(heir), "|", has(below, "later"), has(deeper, "later"));
delete base.later;
console.log("and deleted:", has(heir, "later"), has(below, "later"), has(deeper, "later"));
base[mark] = 1;
console.log("a symbol:", has(heir, mark), has(below, mark), has(deeper, mark));
delete base[mark];
console.log("and deleted:", has(heir, mark), has(below, mark), has(deeper, mark));
heir.missing = 1;
console.log("the heir gets it itself:", has(heir, "missing"), has(below, "missing"), has(deeper, "missing"));
delete heir.missing;
console.log("and loses it:", has(heir, "missing"), has(below, "missing"), has(deeper, "missing"));
below.missing = undefined;
console.log("the one below gets it:", has(heir, "missing"), has(below, "missing"), has(deeper, "missing"));
const above: any = { far: 1 };
console.log("before the prototype gets another prototype:", has(heir, "far"), has(deeper, "far"), has(heir, "toString"));
try { Object.setPrototypeOf(base, above); console.log("after:", has(heir, "far"), has(deeper, "far"), has(heir, "toString")); above.farther = 1; console.log("and a name added there:", has(heir, "farther"), has(deeper, "farther")); } catch (error: any) { console.log("after:", error.constructor.name); }
const second: any = (function (x: any): any { return x; })(steps[1]);
const moved: any = Object.create(second);
console.log("another heir:", all(moved));
Object.setPrototypeOf(moved, { only: 1 });
console.log("moved under a plain object:", all(moved), has(moved, "only"));
Object.setPrototypeOf(moved, second);
console.log("and back:", all(moved), has(moved, "only"));
Object.setPrototypeOf(moved, null);
console.log("and under nothing:", all(moved));
const instance: any = (function (x: any): any { return x; })(shapes[0]);
const ofInstance: any = Object.create(instance);
const shapeNames = ["sides", "label", "area", "constructor", "missing"];
const allOfShape = (o: any): string => shapeNames.map(name => name + "=" + (has(o, name) ? 1 : 0)).join(" ");
console.log("heir of an instance:", allOfShape(ofInstance));
for (const name of shapeNames) { const first = has(ofInstance, name); const before = entered(); let same = 0; for (let i = 0; i < 2000; i++) same += has(ofInstance, name) === first ? 1 : 0; console.log("heir of an instance", name, first, same, entered() - before < 20); }
instance.label = "three";
console.log("its optional field is set:", allOfShape(ofInstance));
delete instance.label;
console.log("and deleted:", allOfShape(ofInstance));
const frozen: any = Object.freeze((function (x: any): any { return x; })(steps[2]));
const ofFrozen: any = Object.create(frozen);
console.log("heir of a frozen one:", all(ofFrozen));
const many: any[] = [];
for (let i = 0; i < 60; i++) { const o = Object.create(i % 2 ? base : second); o["k" + (i % 7)] = i; many.push(o); }
let count = 0;
for (let round = 0; round < 20; round++) for (const o of many) count += (has(o, "op") ? 1 : 0) + (has(o, "k3") ? 2 : 0) + (has(o, "nowhere") ? 4 : 0);
console.log(count);
for (const bad of [1, "text", undefined, null]) { try { console.log(has(bad, "op")); } catch (error: any) { console.log(error.constructor.name); } }
if (typeof (globalThis as any).gc === "function") (globalThis as any).gc();
console.log("after a collection:", all(heir), "|", all(deeper));
