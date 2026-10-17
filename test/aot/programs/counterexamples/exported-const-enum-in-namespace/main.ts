// An exported const enum is among the keys of its module's namespace object, as in plain Bun.
declare const console: { log(...a: unknown[]): void };
import * as ns from "./a";
console.log("K" in ns);
