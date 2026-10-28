// createRequire() loads a CommonJS file that requires an ES module that calls import(): the imported module runs before the first call returns and reads typed exports through `export *`.
import { createRequire } from "node:module";
createRequire(import.meta.url)("./between.cjs");
export var text: string = "a" + process.argv.length;
export var count: number = process.argv.length * 2;
export let record: { x: number } = { x: process.argv.length };
export const fixed: { y: number } = { y: process.argv.length };
export class Kind {
  static z: number = process.argv.length;
}
console.log("main ends");
