// The keys of a namespace object are sorted by code unit.
// @ts-nocheck
declare const console: { log(...values: unknown[]): void };
import { look } from "./reader.cjs";
for (const line of look()) console.log(line);
