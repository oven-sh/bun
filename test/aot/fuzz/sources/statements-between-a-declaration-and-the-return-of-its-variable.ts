// fuzz/statements-between-a-declaration-and-the-return-of-its-variable.ts: functions that declare a variable whose value a build may know, do something, and give the variable back.
import { endless } from "../family";
import { Random } from "../random";
import { generate } from "../statements-between-a-declaration-and-the-return-of-its-variable";

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

export default endless("statements between a declaration and the return of its variable", index => ({
  name: `seed ${index + 1}.`,
  // Every eighth is built so that it checks what the compiler took for granted.
  flags: index % 8 === 5 ? ["--aot-validate"] : [],
  make: () => generate(new Random(index + 1), dialects[index % dialects.length]),
}));
