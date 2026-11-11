// The call is written out, with the function's own name, inside a `try`: what was stored in front of it is seen in the handler, what stands behind it is not run.
import { glob } from "node:fs/promises";
Object.defineProperty(glob, "prototype", {
  configurable: true,
  get() {
    throw new RangeError("no");
  },
});
function ask(pattern) {
  let step = 1;
  try {
    step = 2;
    glob(pattern);
    step = 3;
  } catch (error) {
    return error.name + " at step " + step;
  }
  return "no error, step " + step;
}
console.log(ask("*.nothing-here"), ask("*.nothing-there"));
