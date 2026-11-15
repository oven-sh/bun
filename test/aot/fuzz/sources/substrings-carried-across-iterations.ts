// A fixed list of seeds of ../substrings-carried-across-iterations.ts, which describes the programs.
import { generate } from "../substrings-carried-across-iterations";
import { Random } from "../random";
import { family } from "../family";

export default family("substrings carried across iterations", [
  {
    name: "a piece returned behind an empty loop is read by position.",
    make: () => ({
      file: "main.js",
      text: `function make(n) { const s = "ab".slice(1); while (n--); return s; }\nmake(1);\nconsole.log(make(1)[0]);\n`,
    }),
  },
  ...Array.from({ length: 200 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    make: () =>
      index % 2 === 1
        ? { file: "main.ts", text: generate(new Random(index + 1), true) }
        : { file: "main.js", text: generate(new Random(index + 1)) },
  })),
]);
