// HTMLRewriter with an async handler behind an import(): transform() runs the waiting jobs, so the imported module runs before it returns.
import("./reader.mjs");
new HTMLRewriter()
  .on("p", {
    async element() {
      await 0;
    },
  })
  .transform("<p>x</p>");
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
