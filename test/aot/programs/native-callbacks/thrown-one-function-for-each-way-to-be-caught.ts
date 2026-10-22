// Thrown values: each function here is called by the program with a number, is thrown, passes through one kind of native frame, and is called with a string by whoever catches it. A bit is set for each one that saw the string.
import { EventEmitter } from "node:events";

let bits = 0;

function attempt(run: () => unknown): void {
  try {
    run();
  } catch {}
}
const call = (caught: any): void => caught("s");
function caughtFrom(run: () => unknown): void {
  try {
    run();
  } catch (caught) {
    (caught as any)("s");
  }
}

function directly(value: number): void { if (typeof value !== "number") bits |= 1; }
function throughForEach(value: number): void { if (typeof value !== "number") bits |= 2; }
function throughSort(value: number): void { if (typeof value !== "number") bits |= 4; }
function throughStringify(value: number): void { if (typeof value !== "number") bits |= 8; }
function throughToString(value: number): void { if (typeof value !== "number") bits |= 16; }
function throughProxy(value: number): void { if (typeof value !== "number") bits |= 32; }
function throughReflect(value: number): void { if (typeof value !== "number") bits |= 64; }
function throughConstruct(value: number): void { if (typeof value !== "number") bits |= 128; }
function throughIterator(value: number): void { if (typeof value !== "number") bits |= 256; }
function throughReplace(value: number): void { if (typeof value !== "number") bits |= 512; }
function throughEmit(value: number): void { if (typeof value !== "number") bits |= 1024; }
function throughReject(value: number): void { if (typeof value !== "number") bits |= 2048; }
function throughAsync(value: number): void { if (typeof value !== "number") bits |= 4096; }
function throughExecutor(value: number): void { if (typeof value !== "number") bits |= 8192; }
function throughThen(value: number): void { if (typeof value !== "number") bits |= 16384; }
function throughThenable(value: number): void { if (typeof value !== "number") bits |= 32768; }
function throughAllSettled(value: number): void { if (typeof value !== "number") bits |= 65536; }
function throughAny(value: number): void { if (typeof value !== "number") bits |= 131072; }
function throughGenerator(value: number): void { if (typeof value !== "number") bits |= 262144; }
function throughStreamError(value: number): void { if (typeof value !== "number") bits |= 524288; }
function throughStreamPull(value: number): void { if (typeof value !== "number") bits |= 1048576; }
function throughAbort(value: number): void { if (typeof value !== "number") bits |= 2097152; }
function throughCancel(value: number): void { if (typeof value !== "number") bits |= 4194304; }
function throughSinkAbort(value: number): void { if (typeof value !== "number") bits |= 8388608; }
function throughStructuredClone(value: number): void { if (typeof value !== "number") bits |= 16777216; }
function throughSpecies(value: number): void { if (typeof value !== "number") bits |= 33554432; }
function throughFinally(value: number): void { if (typeof value !== "number") bits |= 67108864; }
function throughAsyncIterator(value: number): void { if (typeof value !== "number") bits |= 134217728; }
function throughTimerPromise(value: number): void { if (typeof value !== "number") bits |= 268435456; }
function throughErrorEvent(value: number): void { if (typeof value !== "number") bits |= 536870912; }

directly(1);
attempt(() => caughtFrom(() => { throw directly; }));
throughForEach(1);
attempt(() => caughtFrom(() => [1].forEach(() => { throw throughForEach; })));
throughSort(1);
attempt(() => caughtFrom(() => [1, 2].sort(() => { throw throughSort; })));
throughStringify(1);
attempt(() => caughtFrom(() => JSON.stringify({ get a() { throw throughStringify; } })));
throughToString(1);
attempt(() => caughtFrom(() => String({ toString() { throw throughToString; } })));
throughProxy(1);
attempt(() => caughtFrom(() => (new Proxy({}, { get() { throw throughProxy; } }) as any).x));
throughReflect(1);
attempt(() => caughtFrom(() => Reflect.apply(() => { throw throughReflect; }, null, [])));
throughConstruct(1);
attempt(() => caughtFrom(() => Reflect.construct(function () { throw throughConstruct; }, [])));
throughIterator(1);
attempt(() => caughtFrom(() => Array.from({ [Symbol.iterator]() { throw throughIterator; } } as any)));
throughReplace(1);
attempt(() => caughtFrom(() => "a".replace("a", () => { throw throughReplace; })));
throughEmit(1);
attempt(() => caughtFrom(() => new EventEmitter().on("e", () => { throw throughEmit; }).emit("e")));
throughReject(1);
attempt(() => Promise.reject(throughReject).catch(call));
throughAsync(1);
attempt(() => (async () => { throw throughAsync; })().catch(call));
throughExecutor(1);
attempt(() => new Promise(() => { throw throughExecutor; }).catch(call));
throughThen(1);
attempt(() => Promise.resolve().then(() => { throw throughThen; }).catch(call));
throughThenable(1);
attempt(() => Promise.resolve({ then() { throw throughThenable; } }).catch(call));
throughAllSettled(1);
attempt(() => Promise.allSettled([Promise.reject(throughAllSettled)]).then(([outcome]: any) => outcome.reason("s")));
throughAny(1);
attempt(() => Promise.any([Promise.reject(throughAny)]).catch(error => error.errors[0]("s")));
throughGenerator(1);
attempt(() => caughtFrom(() => (function* () {})().throw(throughGenerator)));
throughStreamError(1);
attempt(() => new ReadableStream({ start(controller) { controller.error(throughStreamError); } }).getReader().read().catch(call));
throughStreamPull(1);
attempt(() => new ReadableStream({ pull() { throw throughStreamPull; } }).getReader().read().catch(call));
throughAbort(1);
attempt(() => caughtFrom(() => AbortSignal.abort(throughAbort).throwIfAborted()));
throughCancel(1);
attempt(() => new ReadableStream({ cancel: call }).cancel(throughCancel));
throughSinkAbort(1);
attempt(() => new WritableStream({ abort: call }).abort(throughSinkAbort));
throughStructuredClone(1);
attempt(() => caughtFrom(() => structuredClone({ get a() { throw throughStructuredClone; } })));
throughSpecies(1);
attempt(() => caughtFrom(() => (class extends Array { static get [Symbol.species](): any { throw throughSpecies; } }).from([1]).map(one => one)));
throughFinally(1);
attempt(() => Promise.reject(throughFinally).finally(() => {}).catch(call));
throughAsyncIterator(1);
attempt(() => (async () => { for await (const one of { [Symbol.asyncIterator]() { throw throughAsyncIterator; } } as any) return one; })().catch(call));
throughTimerPromise(1);
attempt(() => new Promise((resolve, reject) => setTimeout(reject, 0, throughTimerPromise)).catch(call));
throughErrorEvent(1);
attempt(() => new EventEmitter().on("error", call).emit("error", throughErrorEvent));
setTimeout(() => console.log(bits.toString(2)), 10);
