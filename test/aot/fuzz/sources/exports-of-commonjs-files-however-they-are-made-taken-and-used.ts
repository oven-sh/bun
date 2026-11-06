// fuzz/exports-of-commonjs-files-however-they-are-made-taken-and-used.ts: a CommonJS file makes its exports by stores, by a literal,
// by definitions of values and getters or by the helpers that TypeScript and esbuild write; another module takes them as the default, by name, as a
// namespace, under a key, by `import()`, by `require` or through a module that hands them on, and reads, calls, lists and hands them on.
import { generate } from "../exports-of-commonjs-files-however-they-are-made-taken-and-used";
import { endless } from "../family";
import { Random } from "../random";

export default endless("exports of CommonJS files are the same however they are made, taken and used", index => ({
  name: `seed ${index + 1}.`,
  flags: index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : index % 4 === 2 ? ["--aot-heat=everything-is-cold"] : [],
  make: () => generate(new Random(index + 1)),
}));
