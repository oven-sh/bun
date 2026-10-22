// Methods found through instances: each class here has a then(priority: number) that the program calls with a number and that one native caller calls with a resolving function. A bit is set for each such caller.

let bits = 0;

function attempt(run: () => unknown): void {
  try {
    run();
  } catch {}
}

class ByAwait { then(priority: number): void { if (typeof priority !== "number") bits |= 1; } }
class ByResolve { then(priority: number): void { if (typeof priority !== "number") bits |= 2; } }
class ByExecutor { then(priority: number): void { if (typeof priority !== "number") bits |= 4; } }
class ByAsyncReturn { then(priority: number): void { if (typeof priority !== "number") bits |= 8; } }
class ByThenResult { then(priority: number): void { if (typeof priority !== "number") bits |= 16; } }
class ByCatchResult { then(priority: number): void { if (typeof priority !== "number") bits |= 32; } }
class ByFinallyResult { then(priority: number): void { if (typeof priority !== "number") bits |= 64; } }
class ByAll { then(priority: number): void { if (typeof priority !== "number") bits |= 128; } }
class ByRace { then(priority: number): void { if (typeof priority !== "number") bits |= 256; } }
class ByAllSettled { then(priority: number): void { if (typeof priority !== "number") bits |= 512; } }
class ByAny { then(priority: number): void { if (typeof priority !== "number") bits |= 1024; } }
class ByWithResolvers { then(priority: number): void { if (typeof priority !== "number") bits |= 2048; } }
class ByForAwait { then(priority: number): void { if (typeof priority !== "number") bits |= 4096; } }
class ByAsyncGenerator { then(priority: number): void { if (typeof priority !== "number") bits |= 8192; } }
class ByFromAsync { then(priority: number): void { if (typeof priority !== "number") bits |= 16384; } }
class ByStreamPull { then(priority: number): void { if (typeof priority !== "number") bits |= 32768; } }
class ByStreamStart { then(priority: number): void { if (typeof priority !== "number") bits |= 65536; } }
class ByTimerPromise { then(priority: number): void { if (typeof priority !== "number") bits |= 131072; } }
class ByTry { then(priority: number): void { if (typeof priority !== "number") bits |= 262144; } }
class ByTickResolve { then(priority: number): void { if (typeof priority !== "number") bits |= 524288; } }
class ByMicrotask { then(priority: number): void { if (typeof priority !== "number") bits |= 1048576; } }

new ByAwait().then(1);
attempt(() => (async () => await (new ByAwait() as any))());
new ByResolve().then(1);
attempt(() => Promise.resolve((new ByResolve() as any)));
new ByExecutor().then(1);
attempt(() => new Promise(resolve => resolve((new ByExecutor() as any))));
new ByAsyncReturn().then(1);
attempt(() => (async () => (new ByAsyncReturn() as any))());
new ByThenResult().then(1);
attempt(() => Promise.resolve().then(() => (new ByThenResult() as any)));
new ByCatchResult().then(1);
attempt(() => Promise.reject().catch(() => (new ByCatchResult() as any)));
new ByFinallyResult().then(1);
attempt(() => Promise.resolve().finally(() => (new ByFinallyResult() as any)));
new ByAll().then(1);
attempt(() => Promise.all([(new ByAll() as any)]));
new ByRace().then(1);
attempt(() => Promise.race([(new ByRace() as any)]));
new ByAllSettled().then(1);
attempt(() => Promise.allSettled([(new ByAllSettled() as any)]));
new ByAny().then(1);
attempt(() => Promise.any([(new ByAny() as any)]));
new ByWithResolvers().then(1);
attempt(() => Promise.withResolvers().resolve((new ByWithResolvers() as any)));
new ByForAwait().then(1);
attempt(() => (async () => { for await (const one of [(new ByForAwait() as any)]) return one; })());
new ByAsyncGenerator().then(1);
attempt(() => (async function* () { yield (new ByAsyncGenerator() as any); })().next());
new ByFromAsync().then(1);
attempt(() => Array.fromAsync([(new ByFromAsync() as any)]));
new ByStreamPull().then(1);
attempt(() => new ReadableStream({ pull: () => (new ByStreamPull() as any) }).getReader().read());
new ByStreamStart().then(1);
attempt(() => new ReadableStream({ start: () => (new ByStreamStart() as any) }));
new ByTimerPromise().then(1);
attempt(() => new Promise(resolve => setTimeout(resolve, 0, (new ByTimerPromise() as any))));
new ByTry().then(1);
attempt(() => (Promise as any).try(() => (new ByTry() as any)));
new ByTickResolve().then(1);
attempt(() => new Promise(resolve => process.nextTick(resolve, (new ByTickResolve() as any))));
new ByMicrotask().then(1);
attempt(() => new Promise(resolve => queueMicrotask(() => resolve((new ByMicrotask() as any)))));
setTimeout(() => console.log(bits.toString(2)), 10);
