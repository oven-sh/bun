// A text that the build cannot read loads node:path and stores into it, then a direct eval is the first read of the named imports: it reads what the link found.
import { sep, join } from "node:path";
function evaluate(code) {
  return eval(code);
}
// Zero, which the build cannot know: a text that is cut there is made at the run.
const cut = process.argv.length - process.argv.length;
new Function(
  `const path = process.getBuiltinModule("node:path"); path.sep = "!"; path.join = () => "patched";`.slice(cut),
)();
console.log(evaluate("sep".slice(cut)), evaluate("join('a', 'b')".slice(cut)));
console.log(sep, join("c", "d"));
