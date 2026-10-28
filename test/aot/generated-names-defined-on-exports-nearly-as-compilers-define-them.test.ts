// Fixed seeds of fuzz/names-defined-on-exports-nearly-as-compilers-define-them.ts: a CommonJS file defines one name over a name of the file below it, as compilers emit it or nearly so: other words in the descriptor,
// another function to define it with, another name for `exports`, a variable that is assigned again, a condition, a loop, a value, a setter, a second definition, a store over it, a getter that does more than read,
// a file that is only required when the name is read. Another file takes the name in one of many ways, straight or through ES modules, and prints it ahead of and behind a change in the file below. TypeScript
// accepts every program, so every build succeeds, and the executable prints what plain Bun prints and ends as it ends. Every third program is built with its types erased.
import { corners, generate } from "./fuzz/names-defined-on-exports-nearly-as-compilers-define-them";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const overCommonJS = corners.length * 10;
const overAnESModule = corners.length * 4;

generated(
  "names defined on exports nearly as compilers define them",
  Array.from({ length: overCommonJS + overAnESModule }, (_, index) => {
    const corner = corners[index % corners.length];
    // In the last seeds the file below is an ES module.
    const isOverAnESModule = index >= overCommonJS;
    const isErased = index % 3 === 2;
    return {
      name: `seed ${index + 1}, ${corner}${isOverAnESModule ? ", over an ES module" : ""}${isErased ? ", types erased" : ""}.`,
      // Every run takes one seed of each corner; AOT_GENERATED=all takes all.
      isAlwaysRun: index < corners.length,
      isOnlyCompiled: true as const,
      // Nothing is put into the text: one more importer of the name would be one more road to it.
      keepsItsText: true as const,
      // Where the name is not there when the modules are linked, plain Bun ends with 1.
      exitsAsPlainBunDoes: true as const,
      ...(isErased && { flags: ["--aot-erase-types"] }),
      make: () => generate(new Random(index + 1), corner, isOverAnESModule),
    };
  }),
);
