// A fixed list of seeds of ../suspension-inside-expressions.ts, which describes the programs.
import { Random } from "../random";
import { generate, kinds } from "../suspension-inside-expressions";
import { family } from "../family";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    noEmit: true,
    strict: true,
    types: [],
  },
});

export default family(
  "suspension inside expressions",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}, ${kinds[index % kinds.length]}.`,
    make: () => ({
      file: "main.ts",
      text: generate(new Random(index + 1), kinds[index % kinds.length]),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
