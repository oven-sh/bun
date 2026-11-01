// Programs of ../statements-between-declare-and-return.ts, one per seed. That file describes them.
import { endless } from "../family";
import { Random } from "../random";
import { generate } from "../statements-between-declare-and-return";

const dialects = [
  "module",
  "commonjs",
  "typescript",
  "module",
  "module",
  "commonjs",
  "typescript",
  "typescript that nobody checks",
] as const;

export default endless("statements between declare and return", index => ({
  name: `seed ${index + 1}.`,
  flags: index % 8 === 5 ? ["--aot-validate"] : [],
  make: () => generate(new Random(index + 1), dialects[index % dialects.length]),
}));
