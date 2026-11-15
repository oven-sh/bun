// Programs of ../decorators-on-all-members.ts, one per seed. That file describes them.
import { generate } from "../decorators-on-all-members";
import { Random } from "../random";
import { endless } from "../family";

const tsconfig = (isLegacy: boolean, emitsMetadata: boolean, assignsFields: boolean) =>
  JSON.stringify({
    compilerOptions: {
      target: "esnext",
      module: "preserve",
      moduleResolution: "bundler",
      noEmit: true,
      strict: true,
      types: [],
      ...(isLegacy ? { experimentalDecorators: true, emitDecoratorMetadata: emitsMetadata } : {}),
      ...(assignsFields ? { useDefineForClassFields: false } : {}),
    },
  });

export default endless("decorators on all members", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({
    file: "main.ts",
    text: generate(new Random(index + 1), index % 2 === 1, index % 4 === 3),
    files: { "tsconfig.json": tsconfig(index % 2 === 1, index % 4 === 3, index % 3 === 2) },
  }),
}));
