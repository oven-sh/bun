// One point of the table in ../generated/typed-object-mutations.ts: a declared type and what satisfies it, a change of the object that no type forbids, where the typed reference is held and when the change runs, the look through it afterwards.
import { nameOf, pickCombination, textOf } from "../generated/typed-object-mutations";
import type { Random } from "./random";

export function generate(random: Random): string {
  const combination = pickCombination(items => random.pick(items));
  return `// ${nameOf(combination)}\n${textOf(combination)}`;
}
