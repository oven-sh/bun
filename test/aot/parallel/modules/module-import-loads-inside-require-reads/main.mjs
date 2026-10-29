// A require() of an ES module that calls import(): the imported module runs before the require() returns and reads every kind of export of the module that called require().
require("./loads.mjs");
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
