// Built-ins applied by native code: functions of node:util, which the library implements, are handed to map, replace, then, sort and a timer, so their later parameters get an index, an array, an offset or nothing.
import { format, inspect, isDeepStrictEqual, types } from "node:util";

const nested = { a: { b: { c: { d: 1 } } } };
const results: unknown[] = [
  [nested, nested, nested].map(inspect as any).map((one: any) => one.length),
  ["%s", "%d", "x"].map(format as any),
  "a-b".replace(/-(\w)/, format),
  await Promise.resolve(nested).then(inspect),
  await Promise.resolve("%s!").then(format),
  [1, 1].every(isDeepStrictEqual as any),
  [new Map(), {}].map(types.isMap as any),
  await new Promise(resolve => setTimeout((...all: unknown[]) => resolve((format as any)(...all)), 1, "%s+%s", 1, 2)),
  JSON.parse('{"k":1}', format as any),
  Reflect.apply(format, null, ["%o", [1]]),
  format.call("this", "%j", { a: 1 }),
  format.bind(null, "%s-%s", "bound")("late"),
];
console.log(results.map(one => String(one)).join(" | "));
