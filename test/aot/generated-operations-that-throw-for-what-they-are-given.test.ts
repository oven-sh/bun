// Fixed seeds of fuzz/operations-that-throw-for-what-they-are-given.ts: operations that throw, or run code of the program, for some operands and not for others. The operand's type names the kind for which
// nothing happens, and the other kind arrives: the error and the code come all the same. Then the same at the top of modules that are loaded one after the other.
import { everyModuleScene, generate, writeModules } from "./fuzz/operations-that-throw-for-what-they-are-given";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    allowJs: true,
    noEmit: true,
    strict: true,
    types: [],
  },
});
const scenes = everyModuleScene();

generated("an operation does what it does for the operand that arrives", [
  ...Array.from({ length: 48 }, (_, index) => ({
    name: `seed ${(index >> 1) + 1}${index & 1 ? ", every function hot." : "."}`,
    isAlwaysRun: index % 6 < 2,
    isOnlyCompiled: true as const,
    flags: index & 1 ? ["--aot-heat=everything-is-hot"] : [],
    make: () => ({
      file: "main.ts",
      text: generate(new Random((index >> 1) + 1)),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
  ...Array.from({ length: 12 }, (_, index) => ({
    name: `modules ${index + 1}.`,
    isAlwaysRun: index % 6 < 2,
    isOnlyCompiled: true as const,
    flags: [],
    make: () => {
      const random = new Random(index + 1);
      const { "main.ts": text, ...files } = writeModules(
        Array.from({ length: 16 }, () => random.pick(scenes)),
        "main",
      );
      return { file: "main.ts", text, files: { ...files, "tsconfig.json": tsconfig } };
    },
  })),
]);
