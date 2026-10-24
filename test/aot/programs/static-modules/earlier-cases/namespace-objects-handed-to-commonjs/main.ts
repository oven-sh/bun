// Namespace objects of ES modules, handed to a CommonJS file that looks at them.
// @ts-nocheck
declare const console: { log(...values: unknown[]): void };
import { look } from "./reader.cjs";
import * as ns from "./t";
import { n } from "./t";
const value = [ns][0];
for (const line of look()) console.log(line);
console.log("import * as a value: " + value.n + " " + n + " " + Object.keys(value).join());
value.inc(); console.log("after inc: " + value.n + " " + n + " " + ns.n);
const dynamic = await import("./t");
console.log("import(): " + dynamic.n + " " + (dynamic === value) + " " + Object.keys(dynamic).join());
dynamic.inc(); console.log("after inc: " + dynamic.n + " " + value.n);
