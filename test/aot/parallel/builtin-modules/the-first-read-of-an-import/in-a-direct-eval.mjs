// A direct eval of a text that the build cannot know is the first read of two named imports of node:path.
import { sep, join } from "node:path";
function evaluate(code) {
  return eval(code);
}
// Zero, which the build cannot know: a text that is cut there is made at the run.
const cut = process.argv.length - process.argv.length;
console.log(evaluate("sep".slice(cut)), evaluate("typeof sep".slice(cut)), evaluate("join('a', 'b')".slice(cut)));
console.log(sep, join("c", "d"));
