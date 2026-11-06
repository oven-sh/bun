// fuzz/this-of-functions-in-code-that-is-not-strict.ts: functions of a CommonJS file store into `this`, read it and hand it on.
// They are constructed, called plainly, called with every kind of value as `this`, used as methods and as callbacks of built-in functions.
// One seed in four has the same functions in strict code.
import { Random } from "../random";
import { generate } from "../this-of-functions-in-code-that-is-not-strict";
import { endless } from "../family";

export default endless("`this` is in every function what it is in plain Bun", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.cjs", text: generate(new Random(index + 1), index % 4 === 3) }),
}));
