// ES importers of CommonJS files whose names are stored sometimes, again, or by computed keys, also through a star.
declare const console: { log(...values: unknown[]): void };
import * as sometimes from "./sometimes.cjs";
import { s, own } from "./star";
import * as again from "./again.cjs";
import * as value from "./value.cjs";
import valueDefault from "./value.cjs";
export { again };
console.log("sometimes", (sometimes as any).maybe, sometimes.always, Object.keys(sometimes).sort().join());
console.log("star", s, own);
console.log("value", Object.keys(value).sort().join(), Object.keys(valueDefault).sort().join(), valueDefault === value.default);
const dynamic = await import("./dynamic.cjs");
console.log("dynamic", dynamic.d, Object.keys(dynamic).sort().join());
