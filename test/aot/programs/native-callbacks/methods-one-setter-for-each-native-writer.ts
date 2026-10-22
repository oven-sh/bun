// Methods found through instances: each class here has a setter whose parameter says string, as the program's store does, and one native writer that stores a number through it. A bit is set for each such writer.

let bits = 0;

function attempt(run: () => unknown): void {
  try {
    run();
  } catch {}
}

class ByAssign { set k(value: string) { if (typeof value !== "string") bits |= 1; } }
class ByAssignParsed { set k(value: string) { if (typeof value !== "string") bits |= 2; } }
class ByReflectSet { set k(value: string) { if (typeof value !== "string") bits |= 4; } }
class ByHeir { set k(value: string) { if (typeof value !== "string") bits |= 8; } }
class ByReceiver { set k(value: string) { if (typeof value !== "string") bits |= 16; } }
class ByProxy { set k(value: string) { if (typeof value !== "string") bits |= 32; } }
class ByPush { set length(value: string) { if (typeof value !== "string") bits |= 64; } }
class ByPop { set length(value: string) { if (typeof value !== "string") bits |= 128; } }
class ByShift { set length(value: string) { if (typeof value !== "string") bits |= 256; } }
class ByUnshift { set length(value: string) { if (typeof value !== "string") bits |= 512; } }
class BySplice { set length(value: string) { if (typeof value !== "string") bits |= 1024; } }
class ByOf { set length(value: string) { if (typeof value !== "string") bits |= 2048; } }
class ByFrom { set length(value: string) { if (typeof value !== "string") bits |= 4096; } }
class ByPushIndex { set [0](value: string) { if (typeof value !== "string") bits |= 8192; } }
class ByFill { set [0](value: string) { if (typeof value !== "string") bits |= 16384; } }
class ByReverse { set [0](value: string) { if (typeof value !== "string") bits |= 32768; } }
class ByCopyWithin { set [0](value: string) { if (typeof value !== "string") bits |= 65536; } }
class BySort { set [0](value: string) { if (typeof value !== "string") bits |= 131072; } }
class ByAssignSymbol { set [Symbol.iterator](value: string) { if (typeof value !== "string") bits |= 262144; } }
class ByAssignGetter { set k(value: string) { if (typeof value !== "string") bits |= 524288; } }
class ByAssignString { set [0](value: string) { if (typeof value !== "string") bits |= 1048576; } }

(new ByAssign() as any).k = "s";
attempt(() => Object.assign((new ByAssign() as any), { k: 1 }));
(new ByAssignParsed() as any).k = "s";
attempt(() => Object.assign((new ByAssignParsed() as any), JSON.parse('{"k":1}')));
(new ByReflectSet() as any).k = "s";
attempt(() => Reflect.set((new ByReflectSet() as any), "k", 1));
(new ByHeir() as any).k = "s";
attempt(() => Reflect.set(Object.create((new ByHeir() as any)), "k", 1));
(new ByReceiver() as any).k = "s";
attempt(() => Reflect.set((new ByReceiver() as any), "k", 1, {}));
(new ByProxy() as any).k = "s";
attempt(() => (new Proxy((new ByProxy() as any), {}).k = 1));
(new ByPush() as any).length = "s";
attempt(() => Array.prototype.push.call((new ByPush() as any), 1));
(new ByPop() as any).length = "s";
attempt(() => Array.prototype.pop.call((new ByPop() as any)));
(new ByShift() as any).length = "s";
attempt(() => Array.prototype.shift.call((new ByShift() as any)));
(new ByUnshift() as any).length = "s";
attempt(() => Array.prototype.unshift.call((new ByUnshift() as any), 1));
(new BySplice() as any).length = "s";
attempt(() => (Array.prototype.splice as any).call((new BySplice() as any), 0));
(new ByOf() as any).length = "s";
attempt(() => (Array.of as any).call(ByOf, 1));
(new ByFrom() as any).length = "s";
attempt(() => (Array.from as any).call(ByFrom, [1]));
(new ByPushIndex() as any)[0] = "s";
attempt(() => Array.prototype.push.call((new ByPushIndex() as any), 1));
(new ByFill() as any)[0] = "s";
attempt(() => Array.prototype.fill.call(Object.assign(Object.create((new ByFill() as any)), { length: 1 }), 1));
(new ByReverse() as any)[0] = "s";
attempt(() => Array.prototype.reverse.call(Object.assign(Object.create((new ByReverse() as any)), { length: 2, 1: 1 })));
(new ByCopyWithin() as any)[0] = "s";
attempt(() => Array.prototype.copyWithin.call(Object.assign(Object.create((new ByCopyWithin() as any)), { length: 2, 1: 1 }), 0, 1));
(new BySort() as any)[0] = "s";
attempt(() => Array.prototype.sort.call(Object.assign(Object.create((new BySort() as any)), { length: 2, 1: 1 })));
(new ByAssignSymbol() as any)[Symbol.iterator] = "s";
attempt(() => Object.assign((new ByAssignSymbol() as any), { [Symbol.iterator]: 1 }));
(new ByAssignGetter() as any).k = "s";
attempt(() => Object.assign((new ByAssignGetter() as any), { get k() { return 1; } }));
(new ByAssignString() as any)[0] = "s";
attempt(() => Object.assign((new ByAssignString() as any), [1]));
console.log(bits.toString(2));
