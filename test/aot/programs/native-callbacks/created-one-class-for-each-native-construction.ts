// Held from creation: each class here extends Array with a constructor whose parameter says string, as the one `new` in the program does, and one native caller constructs it, through `constructor` and Symbol.species or as its receiver, with a number or nothing. A bit is set for each such caller.

let bits = 0;

function attempt(run: () => unknown): void {
  try {
    run();
  } catch {}
}

class ByMap extends Array<number> { constructor(label: string) { super(); if (typeof label !== "string") bits |= 1; } static one(): ByMap { const made = new ByMap("mine"); made.push(1); return made; } }
class ByFilter extends Array<number> { constructor(label: string) { super(); if (typeof label !== "string") bits |= 2; } static one(): ByFilter { const made = new ByFilter("mine"); made.push(1); return made; } }
class BySlice extends Array<number> { constructor(label: string) { super(); if (typeof label !== "string") bits |= 4; } static one(): BySlice { const made = new BySlice("mine"); made.push(1); return made; } }
class BySplice extends Array<number> { constructor(label: string) { super(); if (typeof label !== "string") bits |= 8; } static one(): BySplice { const made = new BySplice("mine"); made.push(1); return made; } }
class ByConcat extends Array<number> { constructor(label: string) { super(); if (typeof label !== "string") bits |= 16; } static one(): ByConcat { const made = new ByConcat("mine"); made.push(1); return made; } }
class ByFlat extends Array<number> { constructor(label: string) { super(); if (typeof label !== "string") bits |= 32; } static one(): ByFlat { const made = new ByFlat("mine"); made.push(1); return made; } }
class ByFlatMap extends Array<number> { constructor(label: string) { super(); if (typeof label !== "string") bits |= 64; } static one(): ByFlatMap { const made = new ByFlatMap("mine"); made.push(1); return made; } }
class ByFrom extends Array<number> { constructor(label: string) { super(); if (typeof label !== "string") bits |= 128; } static one(): ByFrom { const made = new ByFrom("mine"); made.push(1); return made; } }
class ByFromLike extends Array<number> { constructor(label: string) { super(); if (typeof label !== "string") bits |= 256; } static one(): ByFromLike { const made = new ByFromLike("mine"); made.push(1); return made; } }
class ByOf extends Array<number> { constructor(label: string) { super(); if (typeof label !== "string") bits |= 512; } static one(): ByOf { const made = new ByOf("mine"); made.push(1); return made; } }
class ByFromAsync extends Array<number> { constructor(label: string) { super(); if (typeof label !== "string") bits |= 1024; } static one(): ByFromAsync { const made = new ByFromAsync("mine"); made.push(1); return made; } }
class ByReflect extends Array<number> { constructor(label: string) { super(); if (typeof label !== "string") bits |= 2048; } static one(): ByReflect { const made = new ByReflect("mine"); made.push(1); return made; } }
class ByReflectLike extends Array<number> { constructor(label: string) { super(); if (typeof label !== "string") bits |= 4096; } static one(): ByReflectLike { const made = new ByReflectLike("mine"); made.push(1); return made; } }
class ByNewTarget extends Array<number> { constructor(label: string) { super(); if (typeof label !== "string") bits |= 8192; } static one(): ByNewTarget { const made = new ByNewTarget("mine"); made.push(1); return made; } }
class ByProxy extends Array<number> { constructor(label: string) { super(); if (typeof label !== "string") bits |= 16384; } static one(): ByProxy { const made = new ByProxy("mine"); made.push(1); return made; } }
class ByBound extends Array<number> { constructor(label: string) { super(); if (typeof label !== "string") bits |= 32768; } static one(): ByBound { const made = new ByBound("mine"); made.push(1); return made; } }
class ByConstructorRead extends Array<number> { constructor(label: string) { super(); if (typeof label !== "string") bits |= 65536; } static one(): ByConstructorRead { const made = new ByConstructorRead("mine"); made.push(1); return made; } }
class ByPrototypeRead extends Array<number> { constructor(label: string) { super(); if (typeof label !== "string") bits |= 131072; } static one(): ByPrototypeRead { const made = new ByPrototypeRead("mine"); made.push(1); return made; } }
class ByDescriptor extends Array<number> { constructor(label: string) { super(); if (typeof label !== "string") bits |= 262144; } static one(): ByDescriptor { const made = new ByDescriptor("mine"); made.push(1); return made; } }
class ByGenericMap extends Array<number> { constructor(label: string) { super(); if (typeof label !== "string") bits |= 524288; } static one(): ByGenericMap { const made = new ByGenericMap("mine"); made.push(1); return made; } }
class ByGenericSlice extends Array<number> { constructor(label: string) { super(); if (typeof label !== "string") bits |= 1048576; } static one(): ByGenericSlice { const made = new ByGenericSlice("mine"); made.push(1); return made; } }

ByMap.one();
attempt(() => ByMap.one().map(one => one));
ByFilter.one();
attempt(() => ByFilter.one().filter(() => true));
BySlice.one();
attempt(() => BySlice.one().slice());
BySplice.one();
attempt(() => BySplice.one().splice(0));
ByConcat.one();
attempt(() => ByConcat.one().concat([]));
ByFlat.one();
attempt(() => ByFlat.one().flat());
ByFlatMap.one();
attempt(() => ByFlatMap.one().flatMap(one => one));
ByFrom.one();
attempt(() => ByFrom.from([1]));
ByFromLike.one();
attempt(() => ByFromLike.from({ length: 1 }));
ByOf.one();
attempt(() => ByOf.of(1));
ByFromAsync.one();
attempt(() => ByFromAsync.fromAsync([1]));
ByReflect.one();
attempt(() => Reflect.construct(ByReflect, [1]));
ByReflectLike.one();
attempt(() => Reflect.construct(ByReflectLike, { length: 1, 0: 1 } as any));
ByNewTarget.one();
attempt(() => Reflect.construct(Array, [1], ByNewTarget));
ByProxy.one();
attempt(() => new (new Proxy(ByProxy, {}) as any)(1));
ByBound.one();
attempt(() => new (ByBound.bind(null, 1 as any) as any)());
ByConstructorRead.one();
attempt(() => new (Reflect.get(ByConstructorRead.one(), "constructor") as any)(1));
ByPrototypeRead.one();
attempt(() => new (Object.getPrototypeOf(ByPrototypeRead.one()).constructor as any)(1));
ByDescriptor.one();
attempt(() => new (Object.getOwnPropertyDescriptor(ByDescriptor.prototype, "constructor")!.value as any)(1));
ByGenericMap.one();
attempt(() => Array.prototype.map.call(ByGenericMap.one(), one => one));
ByGenericSlice.one();
attempt(() => Array.prototype.slice.call(ByGenericSlice.one()));
setTimeout(() => console.log(bits.toString(2)), 5);
