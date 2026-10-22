// Methods found through instances: each class here is an iterator whose next(step: number) the program calls with a number and one native consumer calls without an argument. A bit is set for each such consumer.
import { Readable } from "node:stream";

let bits = 0;

function attempt(run: () => unknown): void {
  try {
    run();
  } catch {}
}

class ByArrayFrom { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 1; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class BySet { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 2; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class ByMap { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 4; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class ByWeakSet { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 8; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class BySpread { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 16; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class ByCallSpread { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 32; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class ByDestructuring { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 64; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class ByForOf { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 128; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class ByPromiseAll { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 256; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class ByPromiseRace { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 512; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class ByAllSettled { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 1024; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class ByPromiseAny { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 2048; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class ByFromEntries { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 4096; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class ByTypedArray { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 8192; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class ByTypedFrom { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 16384; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class ByAggregate { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 32768; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class ByGroupBy { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 65536; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class ByMapGroupBy { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 131072; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class ByYieldStar { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 262144; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class ByIteratorFrom { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 524288; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class ByHeaders { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 1048576; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class ByParams { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 2097152; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class ByBlob { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 4194304; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class ByFromAsync { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 8388608; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class ByReadableFrom { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 16777216; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class ByStreamFrom { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 33554432; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class ByBufferConcat { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 67108864; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }
class BySetUnion { left = 1; [Symbol.iterator]() { return this; } next(step: number): IteratorResult<number> { if (typeof step !== "number") bits |= 134217728; return this.left-- > 0 ? { done: false, value: 0 } : { done: true, value: undefined }; } }

new ByArrayFrom().next(1);
attempt(() => Array.from((new ByArrayFrom() as any)));
new BySet().next(1);
attempt(() => new Set((new BySet() as any)));
new ByMap().next(1);
attempt(() => new Map((new ByMap() as any)));
new ByWeakSet().next(1);
attempt(() => new WeakSet((new ByWeakSet() as any)));
new BySpread().next(1);
attempt(() => [...(new BySpread() as any)]);
new ByCallSpread().next(1);
attempt(() => Math.max(...(new ByCallSpread() as any)));
new ByDestructuring().next(1);
attempt(() => (([first]: any) => first)((new ByDestructuring() as any)));
new ByForOf().next(1);
attempt(() => { for (const one of (new ByForOf() as any)) return one; });
new ByPromiseAll().next(1);
attempt(() => Promise.all((new ByPromiseAll() as any)));
new ByPromiseRace().next(1);
attempt(() => Promise.race((new ByPromiseRace() as any)));
new ByAllSettled().next(1);
attempt(() => Promise.allSettled((new ByAllSettled() as any)));
new ByPromiseAny().next(1);
attempt(() => Promise.any((new ByPromiseAny() as any)).catch(() => 0));
new ByFromEntries().next(1);
attempt(() => Object.fromEntries((new ByFromEntries() as any)));
new ByTypedArray().next(1);
attempt(() => new Uint8Array((new ByTypedArray() as any)));
new ByTypedFrom().next(1);
attempt(() => Float64Array.from((new ByTypedFrom() as any)));
new ByAggregate().next(1);
attempt(() => new AggregateError((new ByAggregate() as any)));
new ByGroupBy().next(1);
attempt(() => Object.groupBy((new ByGroupBy() as any), () => "k"));
new ByMapGroupBy().next(1);
attempt(() => Map.groupBy((new ByMapGroupBy() as any), () => 1));
new ByYieldStar().next(1);
attempt(() => [...(function* () { yield* (new ByYieldStar() as any); })()]);
new ByIteratorFrom().next(1);
attempt(() => (Iterator as any).from((new ByIteratorFrom() as any)).toArray());
new ByHeaders().next(1);
attempt(() => new Headers((new ByHeaders() as any)));
new ByParams().next(1);
attempt(() => new URLSearchParams((new ByParams() as any)));
new ByBlob().next(1);
attempt(() => new Blob((new ByBlob() as any)));
new ByFromAsync().next(1);
attempt(() => Array.fromAsync((new ByFromAsync() as any)));
new ByReadableFrom().next(1);
attempt(() => Readable.from((new ByReadableFrom() as any)).on("data", () => {}));
new ByStreamFrom().next(1);
attempt(() => (ReadableStream as any).from((new ByStreamFrom() as any)).getReader().read());
new ByBufferConcat().next(1);
attempt(() => Buffer.from((new ByBufferConcat() as any)));
new BySetUnion().next(1);
attempt(() => new Set([1]).union({ size: 1, has: () => false, keys: () => (new BySetUnion() as any) } as any));
setTimeout(() => console.log(bits.toString(2)), 5);
