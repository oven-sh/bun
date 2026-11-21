// A direct eval of a text that the build cannot know reads two named imports of node:path that compiled code has read before.
import { sep, join } from "node:path";
function evaluate(code) {
  return eval(code);
}
console.log(sep, join("c", "d"));
// Zero, which the build cannot know: a text that is cut there is made at the run.
const cut = process.argv.length - process.argv.length;
console.log(evaluate("sep".slice(cut)), evaluate("typeof sep".slice(cut)), evaluate("join('a', 'b')".slice(cut)));
