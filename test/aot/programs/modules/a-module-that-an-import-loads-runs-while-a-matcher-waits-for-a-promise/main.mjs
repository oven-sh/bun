// expect() of bun:test on a pending promise behind an import(): the matcher waits for the promise, so the imported module runs before it returns.
// The timer of the imported module settles the promise, so all that the module does comes before the last line here.
import { expect } from "bun:test";
import("./reader.mjs");
expect(new Promise(resolve => (globalThis.timerHasLooked = resolve))).resolves.toBe(undefined);
export var text = "a" + process.argv.length;
export var count = process.argv.length * 2;
export var record = { x: process.argv.length };
export let changing = "b" + process.argv.length;
export const fixed = { y: process.argv.length };
export class Kind {
  static z = process.argv.length;
}
export function call() {
  return process.argv.length;
}
export default "c" + process.argv.length;
console.log("main ends");
