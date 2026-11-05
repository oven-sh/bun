// The warning for an event with more listeners than the emitter allows. node:events calls it, and so do the native
// add methods of `process`, which do not evaluate node:events for it.
// https://github.com/nodejs/node/blob/v26.3.0/lib/events.js#L588-L594
let inspect: ((value: unknown, options?: object) => string) | undefined;

interface MaxListenersExceededWarning extends Error {
  emitter?: unknown;
  type?: unknown;
  count?: number;
}

export default function warnOfTooManyListeners(emitter: unknown, type: unknown, count: number, limit: unknown) {
  // node's printer calls `process` [process]. Here its constructor is named EventEmitter, and the printer is a large module.
  const label =
    emitter === process ? "[process]" : (inspect ??= require("internal/util/inspect").inspect)(emitter, { depth: -1 });
  const warning: MaxListenersExceededWarning = new Error(
    `Possible EventEmitter memory leak detected. ${count} ${String(type)} listeners added to ${label}. MaxListeners is ${limit}. Use emitter.setMaxListeners() to increase limit`,
  );
  warning.name = "MaxListenersExceededWarning";
  warning.emitter = emitter;
  warning.type = type;
  warning.count = count;
  process.emitWarning(warning);
}
