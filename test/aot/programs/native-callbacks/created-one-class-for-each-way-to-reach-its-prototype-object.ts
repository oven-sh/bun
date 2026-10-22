// Held from creation: the prototype object of each class here is handed to nobody; one native function answers with it, and the program stores another method into what it got. A bit is set where a later call on a typed instance finds the new method.

let bits = 0;

function attempt(run: () => unknown): void {
  try {
    run();
  } catch {}
}
const patch = (prototype: any): void => {
  prototype.m = () => "patched";
};

class ByGetPrototypeOf { m(): number | string { return 1; } }
class ByReflect { m(): number | string { return 1; } }
class ByDunderProto { m(): number | string { return 1; } }
class ByDunderGetter { m(): number | string { return 1; } }
class ByReflectGet { m(): number | string { return 1; } }
class ByDescriptor { m(): number | string { return 1; } }
class ByConstructor { m(): number | string { return 1; } }
class ByValues { m(): number | string { return 1; } }
class ByAt { m(): number | string { return 1; } }
class ByHeir { m(): number | string { return 1; } }
class BySubclass { m(): number | string { return 1; } }
class BySubclassStatic { m(): number | string { return 1; } }
class ByThen { m(): number | string { return 1; } }
class ByTimer { m(): number | string { return 1; } }
class ByAssign { m(): number | string { return 1; } }
class ByDefine { m(): number | string { return 1; } }
class ByReflectSet { m(): number | string { return 1; } }
class ByNewTarget { m(): number | string { return 1; } }
class ByIsPrototypeOf { m(): number | string { return 1; } }
class ByThrown { m(): number | string { return 1; } }
class BySpreadHolder { m(): number | string { return 1; } }

new ByGetPrototypeOf().m();
attempt(() => patch(Object.getPrototypeOf(new ByGetPrototypeOf())));
new ByReflect().m();
attempt(() => patch(Reflect.getPrototypeOf(new ByReflect())));
new ByDunderProto().m();
attempt(() => patch((new ByDunderProto() as any).__proto__));
new ByDunderGetter().m();
attempt(() => patch(Object.getOwnPropertyDescriptor(Object.prototype, "__proto__")!.get!.call(new ByDunderGetter())));
new ByReflectGet().m();
attempt(() => patch(Reflect.get(ByReflectGet, "prototype")));
new ByDescriptor().m();
attempt(() => patch(Object.getOwnPropertyDescriptor(ByDescriptor, "prototype")!.value));
new ByConstructor().m();
attempt(() => patch(Reflect.get(new ByConstructor(), "constructor").prototype));
new ByValues().m();
attempt(() => patch((Object.values({ ByValues }) as any)[0].prototype));
new ByAt().m();
attempt(() => patch(([ByAt] as any[]).at(0).prototype));
new ByHeir().m();
attempt(() => patch(Object.getPrototypeOf(Object.getPrototypeOf(Object.create(new ByHeir())))));
new BySubclass().m();
attempt(() => patch(Object.getPrototypeOf((class extends BySubclass {}).prototype)));
new BySubclassStatic().m();
attempt(() => patch(Object.getPrototypeOf(class extends BySubclassStatic {}).prototype));
new ByThen().m();
attempt(() => Promise.resolve(new ByThen()).then(one => patch(Object.getPrototypeOf(one))));
new ByTimer().m();
attempt(() => setTimeout((one: object) => patch(Object.getPrototypeOf(one)), 0, new ByTimer()));
new ByAssign().m();
attempt(() => Object.assign(Object.getPrototypeOf(new ByAssign()), { m: () => "patched" }));
new ByDefine().m();
attempt(() => Object.defineProperty(Reflect.getPrototypeOf(new ByDefine())!, "m", { value: () => "patched" }));
new ByReflectSet().m();
attempt(() => Reflect.set(Reflect.getPrototypeOf(new ByReflectSet())!, "m", () => "patched"));
new ByNewTarget().m();
attempt(() => Reflect.construct(function (this: any) { patch(new.target.prototype); }, [], ByNewTarget));
new ByIsPrototypeOf().m();
attempt(() => [Object.getPrototypeOf(new ByIsPrototypeOf())].filter(one => one.isPrototypeOf(new ByIsPrototypeOf())).forEach(patch));
new ByThrown().m();
attempt(() => { try { throw Object.getPrototypeOf(new ByThrown()); } catch (caught) { patch(caught); } });
new BySpreadHolder().m();
attempt(() => patch(({ ...{ p: Object.getPrototypeOf(new BySpreadHolder()) } }).p));
setTimeout(() => {
  if (new ByGetPrototypeOf().m() !== 1) bits |= 1;
  if (new ByReflect().m() !== 1) bits |= 2;
  if (new ByDunderProto().m() !== 1) bits |= 4;
  if (new ByDunderGetter().m() !== 1) bits |= 8;
  if (new ByReflectGet().m() !== 1) bits |= 16;
  if (new ByDescriptor().m() !== 1) bits |= 32;
  if (new ByConstructor().m() !== 1) bits |= 64;
  if (new ByValues().m() !== 1) bits |= 128;
  if (new ByAt().m() !== 1) bits |= 256;
  if (new ByHeir().m() !== 1) bits |= 512;
  if (new BySubclass().m() !== 1) bits |= 1024;
  if (new BySubclassStatic().m() !== 1) bits |= 2048;
  if (new ByThen().m() !== 1) bits |= 4096;
  if (new ByTimer().m() !== 1) bits |= 8192;
  if (new ByAssign().m() !== 1) bits |= 16384;
  if (new ByDefine().m() !== 1) bits |= 32768;
  if (new ByReflectSet().m() !== 1) bits |= 65536;
  if (new ByNewTarget().m() !== 1) bits |= 131072;
  if (new ByIsPrototypeOf().m() !== 1) bits |= 262144;
  if (new ByThrown().m() !== 1) bits |= 524288;
  if (new BySpreadHolder().m() !== 1) bits |= 1048576;
  console.log(bits.toString(2));
}, 5);
