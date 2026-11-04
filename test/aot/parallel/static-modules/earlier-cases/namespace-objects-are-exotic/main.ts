// What a namespace object is: its tag, that it is not extensible, that it refuses stores.
// @ts-nocheck
declare const console: { log(...values: unknown[]): void };
import { odd } from "./reader.cjs";
import * as ns from "./t";
const value = [ns][0];
for (const line of odd()) console.log(line);
console.log("tag of ns: " + String(value[Symbol.toStringTag]) + " extensible: " + Object.isExtensible(value) + " require === ns: " + (require("./t") === value));

