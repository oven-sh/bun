// Methods found through instances: each class here has a field that the program only stores numbers into, and one native writer that puts a string there, removes the field or turns it into an accessor. A bit is set where a later read finds no number.

let bits = 0;

function attempt(run: () => unknown): void {
  try {
    run();
  } catch {}
}

class ByAssign { x = 1; static it = new ByAssign(); }
class ByAssignParsed { x = 1; static it = new ByAssignParsed(); }
class ByReflectSet { x = 1; static it = new ByReflectSet(); }
class ByDefine { x = 1; static it = new ByDefine(); }
class ByDefineMany { x = 1; static it = new ByDefineMany(); }
class ByReflectDefine { x = 1; static it = new ByReflectDefine(); }
class ByGetter { x = 1; static it = new ByGetter(); }
class ByDelete { x = 1; static it = new ByDelete(); }
class ByProxy { x = 1; static it = new ByProxy(); }
class ByProxyDelete { x = 1; static it = new ByProxyDelete(); }
class ByReceiver { x = 1; static it = new ByReceiver(); }
class ByHeirReceiver { x = 1; static it = new ByHeirReceiver(); }
class ByEntries { x = 1; static it = new ByEntries(); }
class ByReviver { x = 1; static it = new ByReviver(); }
class ByEmit { x = 1; static it = new ByEmit(); }
class ByTimer { x = 1; static it = new ByTimer(); }
class ByThen { x = 1; static it = new ByThen(); }
class ByMapValue { x = 1; static it = new ByMapValue(); }
class ByValues { x = 1; static it = new ByValues(); }
class BySpreadHolder { x = 1; static it = new BySpreadHolder(); }
class ByThrown { x = 1; static it = new ByThrown(); }
class ByPrototype { x = 1; static it = new ByPrototype(); }

ByAssign.it.x = ByAssign.it.x + 1;
attempt(() => Object.assign(ByAssign.it, { x: "s" }));
ByAssignParsed.it.x = ByAssignParsed.it.x + 1;
attempt(() => Object.assign(ByAssignParsed.it, JSON.parse('{"x":"s"}')));
ByReflectSet.it.x = ByReflectSet.it.x + 1;
attempt(() => Reflect.set(ByReflectSet.it, "x", "s"));
ByDefine.it.x = ByDefine.it.x + 1;
attempt(() => Object.defineProperty(ByDefine.it, "x", { value: "s" }));
ByDefineMany.it.x = ByDefineMany.it.x + 1;
attempt(() => Object.defineProperties(ByDefineMany.it, { x: { value: "s" } }));
ByReflectDefine.it.x = ByReflectDefine.it.x + 1;
attempt(() => Reflect.defineProperty(ByReflectDefine.it, "x", { value: "s" }));
ByGetter.it.x = ByGetter.it.x + 1;
attempt(() => Object.defineProperty(ByGetter.it, "x", { get: () => "s" }));
ByDelete.it.x = ByDelete.it.x + 1;
attempt(() => Reflect.deleteProperty(ByDelete.it, "x"));
ByProxy.it.x = ByProxy.it.x + 1;
attempt(() => ((new Proxy(ByProxy.it, {}) as any).x = "s"));
ByProxyDelete.it.x = ByProxyDelete.it.x + 1;
attempt(() => delete (new Proxy(ByProxyDelete.it, {}) as any).x);
ByReceiver.it.x = ByReceiver.it.x + 1;
attempt(() => Reflect.set({}, "x", "s", ByReceiver.it));
ByHeirReceiver.it.x = ByHeirReceiver.it.x + 1;
attempt(() => Reflect.set(Object.create(ByHeirReceiver.it), "x", "s", ByHeirReceiver.it));
ByEntries.it.x = ByEntries.it.x + 1;
attempt(() => Object.entries({ x: "s" }).forEach(([key, value]) => ((ByEntries.it as any)[key] = value)));
ByReviver.it.x = ByReviver.it.x + 1;
attempt(() => JSON.parse('{"x":"s"}', function (key, value) { if (key) (ByReviver.it as any)[key] = value; return value; }));
ByEmit.it.x = ByEmit.it.x + 1;
attempt(() => process.nextTick((target: any, value: unknown) => (target.x = value), ByEmit.it, "s"));
ByTimer.it.x = ByTimer.it.x + 1;
attempt(() => setTimeout((target: any, value: unknown) => (target.x = value), 0, ByTimer.it, "s"));
ByThen.it.x = ByThen.it.x + 1;
attempt(() => Promise.resolve(ByThen.it as any).then(target => (target.x = "s")));
ByMapValue.it.x = ByMapValue.it.x + 1;
attempt(() => (new Map<number, any>([[1, ByMapValue.it]]).get(1).x = "s"));
ByValues.it.x = ByValues.it.x + 1;
attempt(() => ((Object.values({ it: ByValues.it }) as any)[0].x = "s"));
BySpreadHolder.it.x = BySpreadHolder.it.x + 1;
attempt(() => (({ ...{ it: BySpreadHolder.it } }) as any).it.x = "s");
ByThrown.it.x = ByThrown.it.x + 1;
attempt(() => { try { [1].forEach(() => { throw ByThrown.it; }); } catch (caught) { (caught as any).x = "s"; } });
ByPrototype.it.x = ByPrototype.it.x + 1;
attempt(() => Reflect.deleteProperty(Object.setPrototypeOf(ByPrototype.it, { x: "s" }), "x"));
setTimeout(() => {
  if (typeof ByAssign.it.x !== "number") bits |= 1;
  if (typeof ByAssignParsed.it.x !== "number") bits |= 2;
  if (typeof ByReflectSet.it.x !== "number") bits |= 4;
  if (typeof ByDefine.it.x !== "number") bits |= 8;
  if (typeof ByDefineMany.it.x !== "number") bits |= 16;
  if (typeof ByReflectDefine.it.x !== "number") bits |= 32;
  if (typeof ByGetter.it.x !== "number") bits |= 64;
  if (typeof ByDelete.it.x !== "number") bits |= 128;
  if (typeof ByProxy.it.x !== "number") bits |= 256;
  if (typeof ByProxyDelete.it.x !== "number") bits |= 512;
  if (typeof ByReceiver.it.x !== "number") bits |= 1024;
  if (typeof ByHeirReceiver.it.x !== "number") bits |= 2048;
  if (typeof ByEntries.it.x !== "number") bits |= 4096;
  if (typeof ByReviver.it.x !== "number") bits |= 8192;
  if (typeof ByEmit.it.x !== "number") bits |= 16384;
  if (typeof ByTimer.it.x !== "number") bits |= 32768;
  if (typeof ByThen.it.x !== "number") bits |= 65536;
  if (typeof ByMapValue.it.x !== "number") bits |= 131072;
  if (typeof ByValues.it.x !== "number") bits |= 262144;
  if (typeof BySpreadHolder.it.x !== "number") bits |= 524288;
  if (typeof ByThrown.it.x !== "number") bits |= 1048576;
  if (typeof ByPrototype.it.x !== "number") bits |= 2097152;
  console.log(bits.toString(2));
}, 5);
