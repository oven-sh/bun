// The default import of a CommonJS file with the marker, from an .mjs file and from TypeScript.
// @ts-nocheck
declare const console: { log(...values: unknown[]): void };
import { inNodeMode } from "./node.mjs";
import { notInNodeMode } from "./bundler";
console.log(inNodeMode);
console.log(notInNodeMode);
