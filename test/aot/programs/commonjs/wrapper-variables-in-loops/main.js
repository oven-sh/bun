// `exports`, `module`, `require`, `__filename` and `__dirname` are variables of a CommonJS module: a store inside a loop or a `try` is seen by the next iteration, after the statement and by inner functions. Imported CommonJS files are evaluated in import order. Plain Bun has no fixed order for them, so the output is stored.
import "./exports.cjs";
import "./module.cjs";
import "./require.cjs";
import "./paths.cjs";
import "./shared.cjs";
