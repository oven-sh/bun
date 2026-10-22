// Held from creation: each class here has a static Symbol.species getter that nothing in the program reads: one native method reads it, through `constructor` of an instance. A bit is set for each getter that ran.

let bits = 0;

function attempt(run: () => unknown): void {
  try {
    run();
  } catch {}
}

class OfMap extends Array<number> { static get [Symbol.species](): any { bits |= 1; return Array; } }
class OfFilter extends Array<number> { static get [Symbol.species](): any { bits |= 2; return Array; } }
class OfSlice extends Array<number> { static get [Symbol.species](): any { bits |= 4; return Array; } }
class OfSplice extends Array<number> { static get [Symbol.species](): any { bits |= 8; return Array; } }
class OfConcat extends Array<number> { static get [Symbol.species](): any { bits |= 16; return Array; } }
class OfFlat extends Array<number> { static get [Symbol.species](): any { bits |= 32; return Array; } }
class OfFlatMap extends Array<number> { static get [Symbol.species](): any { bits |= 64; return Array; } }
class OfThen extends Promise<number> { static get [Symbol.species](): any { bits |= 128; return Promise; } }
class OfCatch extends Promise<number> { static get [Symbol.species](): any { bits |= 256; return Promise; } }
class OfFinally extends Promise<number> { static get [Symbol.species](): any { bits |= 512; return Promise; } }
class OfTypedSlice extends Uint8Array { static get [Symbol.species](): any { bits |= 1024; return Uint8Array; } }
class OfTypedMap extends Uint8Array { static get [Symbol.species](): any { bits |= 2048; return Uint8Array; } }
class OfTypedFilter extends Uint8Array { static get [Symbol.species](): any { bits |= 4096; return Uint8Array; } }
class OfSubarray extends Uint8Array { static get [Symbol.species](): any { bits |= 8192; return Uint8Array; } }
class OfBufferSlice extends ArrayBuffer { static get [Symbol.species](): any { bits |= 16384; return ArrayBuffer; } }
class OfSplit extends RegExp { static get [Symbol.species](): any { bits |= 32768; return RegExp; } }
class OfMatchAll extends RegExp { static get [Symbol.species](): any { bits |= 65536; return RegExp; } }
class OfAwait extends Promise<number> { static get [Symbol.species](): any { bits |= 131072; return Promise; } }

attempt(() => OfMap.from([1]).map(one => one));
attempt(() => OfFilter.from([1]).filter(() => true));
attempt(() => OfSlice.from([1]).slice());
attempt(() => OfSplice.from([1]).splice(0));
attempt(() => OfConcat.from([1]).concat([]));
attempt(() => OfFlat.from([1]).flat());
attempt(() => OfFlatMap.from([1]).flatMap(one => one));
attempt(() => OfThen.resolve(1).then(() => 0));
attempt(() => OfCatch.resolve(1).catch(() => 0));
attempt(() => OfFinally.resolve(1).finally(() => 0));
attempt(() => new OfTypedSlice(1).slice());
attempt(() => new OfTypedMap(1).map(one => one));
attempt(() => new OfTypedFilter(1).filter(() => true));
attempt(() => new OfSubarray(1).subarray(0));
attempt(() => new OfBufferSlice(2).slice(1));
attempt(() => "a".split(new OfSplit("a")));
attempt(() => "a".matchAll(new OfMatchAll("a", "g")));
attempt(() => (async () => await OfAwait.resolve(1))());
setTimeout(() => console.log(bits.toString(2)), 5);
