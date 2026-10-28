// One point of the table in ../generated/object-mutations.ts: a kind of object, a change of it or of a prototype above it, the key, when and where the change runs, how the object is looked at before and after.
import { nameOf, pickCombination, textOf } from "../generated/object-mutations";
import type { Random } from "./random";

export function generate(random: Random, _typed: boolean, profile: { library: boolean } = { library: true }): string {
  const combination = pickCombination(items => random.pick(items), { hasLibrary: profile.library });
  return `// ${nameOf(combination)}\n${textOf(combination, profile.library ? "console.log" : "print")}`;
}
