// Callbacks handed over and thrown values: an abort listener gets an Event, and the reason that comes back from the signal, by a read, a throw or a rejection, is whatever abort was given, or a DOMException that native code made.
export {};

class Failure extends Error {
  code = 7;
}

let total = 0;

function weigh(reason: Failure): number {
  return reason instanceof Failure ? reason.code : typeof reason === "string" ? 100 : typeof reason === "number" ? 10000 : (reason as any) instanceof DOMException ? 1000000 + (reason as Error).name.length : 100000000;
}

total += weigh(new Failure("mine"));
for (const given of [new Failure("given"), "text", 5, undefined] as any[]) {
  const controller = new AbortController();
  controller.signal.onabort = event => void (total += event instanceof Event ? 1000000000 : 0);
  controller.abort(given);
  total += weigh(controller.signal.reason);
  try {
    controller.signal.throwIfAborted();
  } catch (error) {
    total += weigh(error as Failure);
  }
}
const late = AbortSignal.timeout(1);
await new Promise<void>(resolve => late.addEventListener("abort", () => resolve()));
total += weigh(late.reason);
total += weigh(AbortSignal.any([AbortSignal.abort(9)]).reason);
console.log(total);
