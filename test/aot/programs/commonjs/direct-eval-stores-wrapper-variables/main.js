// The text of a direct eval stores to `exports`, `module`, `require`, `__filename`, `__dirname` and, in sloppy code, to `arguments`: code after the eval, inner functions and later evals read the stored value. Plain Bun takes arguments.cjs, whose own code names none of the five, for an ES module, which is strict, and has no fixed order for imported CommonJS files, so the output is stored: the files in import order.
import "./exports.cjs";
import "./module.cjs";
import "./paths.cjs";
import "./arguments.cjs";
