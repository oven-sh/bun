// fuzz/decorators-of-every-kind-on-every-kind-of-member.ts: classes whose fields, methods, getters, setters and accessors carry decorators that look, replace, add initializers,
// keep the way to the member, throw or answer with what no decorator may answer with. Every second program has the decorators of `experimentalDecorators`, every fourth also `emitDecoratorMetadata`;
// every third assigns its fields (`useDefineForClassFields: false`).
import { generate } from "../decorators-of-every-kind-on-every-kind-of-member";
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

export default endless("decorators of every kind on every kind of member", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({
    file: "main.ts",
    text: generate(new Random(index + 1), index % 2 === 1, index % 4 === 3),
    files: { "tsconfig.json": tsconfig(index % 2 === 1, index % 4 === 3, index % 3 === 2) },
  }),
}));
