// fuzz/what-require-answers-for-an-es-module.ts: a CommonJS file requires an ES module that exports names, a default, an export named `__esModule` or "module.exports", a star over another file,
// or nothing, straight or through the helpers that TypeScript, Babel and esbuild put around `require`, and prints what it got: its kind, its keys, its members, what a store, a new member and a removal do to it, and what it shows behind
// a change in the module. The executable prints what plain Bun prints and ends as it ends.
import { Random } from "../random";
import { corners, generate } from "../what-require-answers-for-an-es-module";
import { endless } from "../family";

export default endless("what require answers for an ES module", index => {
  const corner = corners[index % corners.length];
  return {
    name: `seed ${index + 1}, ${corner}.`,
    make: () => generate(new Random(index + 1), corner),
  };
});
