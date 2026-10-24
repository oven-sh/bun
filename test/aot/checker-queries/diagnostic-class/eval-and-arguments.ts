// `eval` and `arguments` as the name of a class and as a target that is not itself the operand of an assignment are EarlyError in strict mode code and are not reported in sloppy mode code.
import "./eval-and-arguments-sloppy.cjs";
import "./eval-and-arguments-strict.mjs";
