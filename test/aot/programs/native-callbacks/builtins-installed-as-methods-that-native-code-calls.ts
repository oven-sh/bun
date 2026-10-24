// Built-ins applied by native code: functions of the library are stored under toJSON, toString, then, get and Symbol.toPrimitive of the program's objects, so native code applies them with a key, a hint or two resolving functions.
import { format, inspect } from "node:util";

const results: unknown[] = [
  JSON.stringify({ key: { toJSON: format } }),
  JSON.stringify([{ toJSON: inspect }]),
  String({ toString: format }),
  `${{ [Symbol.toPrimitive]: format }}`,
  typeof (await ({ then: process.nextTick } as any)),
  await ({ then: queueMicrotask } as any),
  typeof (await ({ then: setImmediate } as any)),
  (Object.defineProperty({}, "x", { get: format } as any) as any).x,
  typeof (Object.defineProperty({ a: 1 }, "x", { get: inspect } as any) as any).x,
  [3, 1, 2].sort({ compare: Math.min }.compare as any).join(""),
  new Proxy<any>({}, { get: format as any }).name,
  new Proxy<any>({}, { has: Boolean as any, get: String as any }).name,
  "a".replace({ [Symbol.replace]: format } as any, "b"),
];
console.log(results.map(one => String(one)).join(" | "));
