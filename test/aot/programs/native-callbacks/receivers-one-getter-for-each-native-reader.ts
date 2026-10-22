// Receivers below an accessor: each class here has an accessor that the program reads on an instance, and one native reader that reads it on an object which merely inherits from an instance, so `this` has no field of its own. A bit is set for each such reader.

let bits = 0;

function attempt(run: () => unknown): void {
  try {
    run();
  } catch {}
}
let sum = 0;
const heir = (instance: object): any => Object.create(instance);

class ByReflectGet { held = 1; get value(): any { if (!Object.hasOwn(this, "held")) bits |= 1; sum += this.held; return undefined; } }
class ByErrorCause { held = 1; get cause(): any { if (!Object.hasOwn(this, "held")) bits |= 2; sum += this.held; return undefined; } }
class ByEventDetail { held = 1; get detail(): any { if (!Object.hasOwn(this, "held")) bits |= 4; sum += this.held; return undefined; } }
class ByArrayFrom { held = 1; get length(): any { if (!Object.hasOwn(this, "held")) bits |= 8; sum += this.held; return undefined; } }
class ByJoin { held = 1; get length(): any { if (!Object.hasOwn(this, "held")) bits |= 16; sum += this.held; return undefined; } }
class ByStringify { held = 1; get toJSON(): any { if (!Object.hasOwn(this, "held")) bits |= 32; sum += this.held; return undefined; } }
class ByString { held = 1; get toString(): any { if (!Object.hasOwn(this, "held")) bits |= 64; sum += this.held; return undefined; } }
class ByResolve { held = 1; get then(): any { if (!Object.hasOwn(this, "held")) bits |= 128; sum += this.held; return undefined; } }
class ByConcat { held = 1; get [Symbol.isConcatSpreadable](): any { if (!Object.hasOwn(this, "held")) bits |= 256; sum += this.held; return undefined; } }
class ByTag { held = 1; get [Symbol.toStringTag](): any { if (!Object.hasOwn(this, "held")) bits |= 512; sum += this.held; return undefined; } }
class ByDefine { held = 1; get enumerable(): any { if (!Object.hasOwn(this, "held")) bits |= 1024; sum += this.held; return undefined; } }
class ByErrorToString { held = 1; get name(): any { if (!Object.hasOwn(this, "held")) bits |= 2048; sum += this.held; return undefined; } }
class ByRegExpToString { held = 1; get source(): any { if (!Object.hasOwn(this, "held")) bits |= 4096; sum += this.held; return undefined; } }
class ByFromEntries { held = 1; get [0](): any { if (!Object.hasOwn(this, "held")) bits |= 8192; sum += this.held; return undefined; } }
class ByMap { held = 1; get [1](): any { if (!Object.hasOwn(this, "held")) bits |= 16384; sum += this.held; return undefined; } }
class ByApply { held = 1; get length(): any { if (!Object.hasOwn(this, "held")) bits |= 32768; sum += this.held; return undefined; } }
class ByDecoder { held = 1; get fatal(): any { if (!Object.hasOwn(this, "held")) bits |= 65536; sum += this.held; return undefined; } }
class ByProxy { held = 1; get get(): any { if (!Object.hasOwn(this, "held")) bits |= 131072; sum += this.held; return undefined; } }
class BySpread { held = 1; get [Symbol.iterator](): any { if (!Object.hasOwn(this, "held")) bits |= 262144; sum += this.held; return undefined; } }
class ByDateJSON { held = 1; get [Symbol.toPrimitive](): any { if (!Object.hasOwn(this, "held")) bits |= 524288; sum += this.held; return undefined; } }
class ByStrategy { held = 1; get highWaterMark(): any { if (!Object.hasOwn(this, "held")) bits |= 1048576; sum += this.held; return undefined; } }
class ByStream { held = 1; get start(): any { if (!Object.hasOwn(this, "held")) bits |= 2097152; sum += this.held; return undefined; } }
class ByInstanceOf { held = 1; get [Symbol.hasInstance](): any { if (!Object.hasOwn(this, "held")) bits |= 4194304; sum += this.held; return undefined; } }
class ByInspect { held = 1; get [Symbol.for("nodejs.util.inspect.custom")](): any { if (!Object.hasOwn(this, "held")) bits |= 8388608; sum += this.held; return undefined; } }
class ByAssign { held = 1; get kept(): any { if (!Object.hasOwn(this, "held")) bits |= 16777216; sum += this.held; return undefined; } }
class ByIn { held = 1; get seen(): any { if (!Object.hasOwn(this, "held")) bits |= 33554432; sum += this.held; return undefined; } }

(new ByReflectGet() as any).value;
attempt(() => Reflect.get(new ByReflectGet(), "value", heir(new ByReflectGet())));
(new ByErrorCause() as any).cause;
attempt(() => new Error("e", heir(new ByErrorCause())));
(new ByEventDetail() as any).detail;
attempt(() => new CustomEvent("e", heir(new ByEventDetail())));
(new ByArrayFrom() as any).length;
attempt(() => Array.from(heir(new ByArrayFrom())));
(new ByJoin() as any).length;
attempt(() => Array.prototype.join.call(heir(new ByJoin())));
(new ByStringify() as any).toJSON;
attempt(() => JSON.stringify(heir(new ByStringify())));
(new ByString() as any).toString;
attempt(() => String(heir(new ByString())));
(new ByResolve() as any).then;
attempt(() => Promise.resolve(heir(new ByResolve())));
(new ByConcat() as any)[Symbol.isConcatSpreadable];
attempt(() => ([] as any[]).concat(heir(new ByConcat())));
(new ByTag() as any)[Symbol.toStringTag];
attempt(() => Object.prototype.toString.call(heir(new ByTag())));
(new ByDefine() as any).enumerable;
attempt(() => Object.defineProperty({}, "k", heir(new ByDefine())));
(new ByErrorToString() as any).name;
attempt(() => Error.prototype.toString.call(heir(new ByErrorToString())));
(new ByRegExpToString() as any).source;
attempt(() => RegExp.prototype.toString.call(heir(new ByRegExpToString())));
(new ByFromEntries() as any)[0];
attempt(() => Object.fromEntries([heir(new ByFromEntries())]));
(new ByMap() as any)[1];
attempt(() => new Map([heir(new ByMap())]));
(new ByApply() as any).length;
attempt(() => Reflect.apply(() => 0, null, heir(new ByApply())));
(new ByDecoder() as any).fatal;
attempt(() => new TextDecoder("utf-8", heir(new ByDecoder())));
(new ByProxy() as any).get;
attempt(() => (new Proxy({}, heir(new ByProxy())) as any).x);
(new BySpread() as any)[Symbol.iterator];
attempt(() => [...heir(new BySpread())]);
(new ByDateJSON() as any)[Symbol.toPrimitive];
attempt(() => Date.prototype.toJSON.call(heir(new ByDateJSON())));
(new ByStrategy() as any).highWaterMark;
attempt(() => new CountQueuingStrategy(heir(new ByStrategy())));
(new ByStream() as any).start;
attempt(() => new ReadableStream(heir(new ByStream())));
(new ByInstanceOf() as any)[Symbol.hasInstance];
attempt(() => ({}) instanceof heir(new ByInstanceOf()));
(new ByInspect() as any)[Symbol.for("nodejs.util.inspect.custom")];
attempt(() => Bun.inspect(heir(new ByInspect())));
(new ByAssign() as any).kept;
attempt(() => Object.assign({}, Object.defineProperty(heir(new ByAssign()), "own", { enumerable: true, get: Object.getOwnPropertyDescriptor(ByAssign.prototype, "kept")!.get })));
(new ByIn() as any).seen;
attempt(() => Reflect.get(heir(heir(new ByIn())), "seen"));
console.log(bits.toString(2), sum);
