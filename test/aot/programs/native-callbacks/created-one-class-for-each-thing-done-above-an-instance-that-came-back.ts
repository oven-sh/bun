// Held from creation: an instance of each class here goes into an array that JSON.parse made and comes back as `any`. What lies above the instance was handed to nobody: the class, its static members, the prototype object, its methods. One thing is done to each of them through the value that came back. A bit is set where the program sees it done.

let bits = 0;

function attempt(run: () => unknown): void {
  try {
    run();
  } catch {}
}
const held: any[] = JSON.parse("[]");
function back(instance: object): any {
  held.push(instance);
  return held[held.length - 1];
}
const patched = (): string => "patched";

class Compared {}
class Constructed { constructor(label: number) { if (typeof label !== "number") bits |= 2; } }
class WithStaticMethod { static run(label: number): void { if (typeof label !== "number") bits |= 4; } }
class WithStaticGetter { static get mark(): number { bits |= 8; return 1; } }
class WithSpeciesGetter extends Array<number> { static get [Symbol.species](): any { bits |= 16; return Array; } }
class WithHasInstance { static [Symbol.hasInstance](value: unknown): boolean { bits |= 32; return value === 1; } }
class PatchedThroughGetPrototypeOf { m(): number | string { return 1; } }
class PatchedThroughDunderProto { m(): number | string { return 1; } }
class PatchedThroughConstructor { m(): number | string { return 1; } }
class WithPatchedStatic { static m(): number | string { return 1; } }
class WithTakenMethod { m(label: number): void { if (!(this instanceof WithTakenMethod) && typeof label !== "number") bits |= 1024; } }
class ConstructedBySlice extends Array<number> { constructor(label: string) { super(); if (typeof label !== "string") bits |= 2048; } }
class ConstructedBySplit extends RegExp { constructor(source: string, flags?: string) { super(source, flags); if (typeof source !== "string") bits |= 4096; } }
class Parent extends Array<number> { static get [Symbol.species](): any { bits |= 8192; return Array; } }
class Child extends Parent {}

attempt(() => { if (back(new Compared()).constructor === Compared) bits |= 1; });
attempt(() => new (back(new Constructed(1)).constructor)("text"));
WithStaticMethod.run(1);
attempt(() => back(new WithStaticMethod()).constructor.run("text"));
attempt(() => back(new WithStaticGetter()).constructor.mark);
attempt(() => back(new WithSpeciesGetter()).map((one: number) => one));
attempt(() => (1 as any) instanceof back(new WithHasInstance()).constructor);
attempt(() => { Object.getPrototypeOf(back(new PatchedThroughGetPrototypeOf())).m = patched; });
if (new PatchedThroughGetPrototypeOf().m() === "patched") bits |= 64;
attempt(() => { back(new PatchedThroughDunderProto()).__proto__.m = patched; });
if (new PatchedThroughDunderProto().m() === "patched") bits |= 128;
attempt(() => { back(new PatchedThroughConstructor()).constructor.prototype.m = patched; });
if (new PatchedThroughConstructor().m() === "patched") bits |= 256;
attempt(() => { back(new WithPatchedStatic()).constructor.m = patched; });
if (WithPatchedStatic.m() === "patched") bits |= 512;
new WithTakenMethod().m(1);
attempt(() => back(new WithTakenMethod()).m.call({}, "text"));
attempt(() => back(new ConstructedBySlice("mine")).slice());
attempt(() => "a,b".split(back(new ConstructedBySplit(","))));
attempt(() => back(new Child()).filter(() => true));
console.log(bits.toString(2));
