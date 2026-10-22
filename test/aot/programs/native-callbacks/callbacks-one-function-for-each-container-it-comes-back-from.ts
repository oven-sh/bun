// Callbacks handed over: each function here is called by the program with a number, is put into one container of native code, comes back out of it as `any`, and is then called with a string. A bit is set for each one that saw the string.
import { EventEmitter, getEventListeners } from "node:events";
import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";

let bits = 0;

function attempt(run: () => unknown): void {
  try {
    run();
  } catch {}
}

function fromValues(value: number): void { if (typeof value !== "number") bits |= 1; }
function fromEntries(value: number): void { if (typeof value !== "number") bits |= 2; }
function fromReflectGet(value: number): void { if (typeof value !== "number") bits |= 4; }
function fromDescriptor(value: number): void { if (typeof value !== "number") bits |= 8; }
function fromAt(value: number): void { if (typeof value !== "number") bits |= 16; }
function fromPop(value: number): void { if (typeof value !== "number") bits |= 32; }
function fromFind(value: number): void { if (typeof value !== "number") bits |= 64; }
function fromFlat(value: number): void { if (typeof value !== "number") bits |= 128; }
function fromConcat(value: number): void { if (typeof value !== "number") bits |= 256; }
function fromArrayFrom(value: number): void { if (typeof value !== "number") bits |= 512; }
function fromSet(value: number): void { if (typeof value !== "number") bits |= 1024; }
function fromMap(value: number): void { if (typeof value !== "number") bits |= 2048; }
function fromWeakMap(value: number): void { if (typeof value !== "number") bits |= 4096; }
function fromWeakRef(value: number): void { if (typeof value !== "number") bits |= 8192; }
function fromFromEntries(value: number): void { if (typeof value !== "number") bits |= 16384; }
function fromAssign(value: number): void { if (typeof value !== "number") bits |= 32768; }
function fromDetail(value: number): void { if (typeof value !== "number") bits |= 65536; }
function fromCause(value: number): void { if (typeof value !== "number") bits |= 131072; }
function fromReason(value: number): void { if (typeof value !== "number") bits |= 262144; }
function fromListeners(value: number): void { if (typeof value !== "number") bits |= 524288; }
function fromRawListeners(value: number): void { if (typeof value !== "number") bits |= 1048576; }
function fromStore(value: number): void { if (typeof value !== "number") bits |= 2097152; }
function fromProxy(value: number): void { if (typeof value !== "number") bits |= 4194304; }
function fromBind(value: number): void { if (typeof value !== "number") bits |= 8388608; }
function fromReflectApply(value: number): void { if (typeof value !== "number") bits |= 16777216; }
function fromCallCall(value: number): void { if (typeof value !== "number") bits |= 33554432; }
function fromResourceBind(value: number): void { if (typeof value !== "number") bits |= 67108864; }
function fromSnapshot(value: number): void { if (typeof value !== "number") bits |= 134217728; }
function fromTargetListeners(value: number): void { if (typeof value !== "number") bits |= 268435456; }
function fromGroupBy(value: number): void { if (typeof value !== "number") bits |= 536870912; }
function fromStructuredHolder(value: number): void { if (typeof value !== "number") bits |= 1073741824; }

fromValues(1);
attempt(() => (Object.values({ f: fromValues }) as any)[0]("s"));
fromEntries(1);
attempt(() => (Object.entries({ f: fromEntries }) as any)[0][1]("s"));
fromReflectGet(1);
attempt(() => Reflect.get({ f: fromReflectGet } as any, "f")("s"));
fromDescriptor(1);
attempt(() => Object.getOwnPropertyDescriptor({ f: fromDescriptor } as any, "f")!.value("s"));
fromAt(1);
attempt(() => ([fromAt] as any[]).at(0)("s"));
fromPop(1);
attempt(() => ([fromPop] as any[]).pop()("s"));
fromFind(1);
attempt(() => ([fromFind] as any[]).find(() => true)("s"));
fromFlat(1);
attempt(() => ([[fromFlat]] as any[]).flat()[0]("s"));
fromConcat(1);
attempt(() => ([] as any[]).concat([fromConcat])[0]("s"));
fromArrayFrom(1);
attempt(() => (Array.from([fromArrayFrom]) as any[])[0]("s"));
fromSet(1);
attempt(() => (new Set([fromSet]).values().next().value as any)("s"));
fromMap(1);
attempt(() => (new Map([[1, fromMap]]).get(1) as any)("s"));
fromWeakMap(1);
attempt(() => (new WeakMap([[fromWeakMap, fromWeakMap]]).get(fromWeakMap) as any)("s"));
fromWeakRef(1);
attempt(() => (new WeakRef(fromWeakRef).deref() as any)("s"));
fromFromEntries(1);
attempt(() => (Object.fromEntries([["f", fromFromEntries]]) as any).f("s"));
fromAssign(1);
attempt(() => (Object.assign({}, { f: fromAssign }) as any).f("s"));
fromDetail(1);
attempt(() => new CustomEvent("e", { detail: fromDetail as any }).detail("s"));
fromCause(1);
attempt(() => (new Error("e", { cause: fromCause }).cause as any)("s"));
fromReason(1);
attempt(() => AbortSignal.abort(fromReason).reason("s"));
fromListeners(1);
attempt(() => (new EventEmitter().on("e", fromListeners).listeners("e")[0] as any)("s"));
fromRawListeners(1);
attempt(() => (new EventEmitter().once("e", fromRawListeners).rawListeners("e")[0] as any).listener("s"));
fromStore(1);
attempt(() => { const storage = new AsyncLocalStorage<any>(); return storage.run(fromStore, () => storage.getStore()("s")); });
fromProxy(1);
attempt(() => (new Proxy(fromProxy, {}) as any)("s"));
fromBind(1);
attempt(() => (fromBind.bind(null) as any)("s"));
fromReflectApply(1);
attempt(() => Reflect.apply(fromReflectApply, null, ["s"]));
fromCallCall(1);
attempt(() => Function.prototype.call.call(fromCallCall, null, "s"));
fromResourceBind(1);
attempt(() => (AsyncResource.bind(fromResourceBind) as any)("s"));
fromSnapshot(1);
attempt(() => AsyncLocalStorage.snapshot()(fromSnapshot as any, "s"));
fromTargetListeners(1);
attempt(() => { const target = new EventTarget(); target.addEventListener("e", fromTargetListeners as any); return (getEventListeners(target, "e")[0] as any)("s"); });
fromGroupBy(1);
attempt(() => (Object.groupBy([fromGroupBy], () => "k") as any).k[0]("s"));
fromStructuredHolder(1);
attempt(() => (([fromStructuredHolder] as any[]).toSpliced(0, 0)[0])("s"));
console.log(bits.toString(2));
