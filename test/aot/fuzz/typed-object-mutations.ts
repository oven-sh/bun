// One point of the table in ./generators/typed-object-mutations.ts: a declared type and a value that satisfies it, a
// mutation that no type forbids, where the typed reference is held, when the mutation runs, and the inspection
// afterwards.
import { nameOf, pickCombination, textOf } from "./generators/typed-object-mutations";
import type { Random } from "./random";

export function generate(random: Random): string {
  const combination = pickCombination(items => random.pick(items));
  return `// ${nameOf(combination)}\n${textOf(combination)}`;
}
