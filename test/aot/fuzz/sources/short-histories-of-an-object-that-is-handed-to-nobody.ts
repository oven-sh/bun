// fuzz/short-histories-of-an-object-that-is-handed-to-nobody.ts: small programs about one object that no function of the program is handed, changed in a few of a hundred ways and read
// beside each change: in one call, one sum, one template, on both sides, in a loop, in the next statement. Every line is printed at once. Half of the programs have written types.
import { Random } from "../random";
import { generate } from "../short-histories-of-an-object-that-is-handed-to-nobody";
import { endless } from "../family";

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

export default endless("short histories of an object that is handed to nobody", index => {
  const isTyped = index % 2 === 1;
  return {
    name: `seed ${index + 1}, ${isTyped ? "with types" : "without types"}.`,
    make: () => ({
      file: isTyped ? "main.ts" : "main.js",
      text: generate(new Random(index + 1), isTyped),
      files: isTyped ? { "tsconfig.json": tsconfig } : undefined,
    }),
  };
});
