// What a TypeScript module exports is read through `require()` of the module itself.
declare const console: { log(...a: unknown[]): void };
declare function require(path: string): any;
import "./main.ts";
const make = () => ({ m: () => 1 });
export const r1 = make(), r2 = make();
console.log(require("./main.ts").r1.m === require("./main.ts").r2.m);
