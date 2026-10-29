// fuzz/values-thrown-on-every-road-and-changed-where-they-are-caught.ts: a function keeps a value in a local and throws it
// straight, through calls, callbacks of built-ins, accessors, conversions, proxies, iterators, generators, constructors or rejected promises.
// Where it is caught it is tested, read and changed, and behind the catch the function reads it again through its local.
import { Random } from "../random";
import { generate } from "../values-thrown-on-every-road-and-changed-where-they-are-caught";
import { endless } from "../family";

export default endless("a value that was thrown, caught and changed reads as in plain Bun", index => ({
  name: `seed ${index + 1}.`,
  flags: index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : index % 4 === 2 ? ["--aot-heat=everything-is-cold"] : [],
  make: () => ({ file: "main.mjs", text: generate(new Random(index + 1)) }),
}));
