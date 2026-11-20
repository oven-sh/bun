// One point of the table in ./generators/object-mutations.ts: a kind of object, a mutation of it or of a prototype, the
// key, when and where the mutation runs, and how the object is inspected before and after.
import { nameOf, pickCombination, textOf } from "./generators/object-mutations";
import type { Random } from "./random";

export function generate(random: Random, _typed: boolean, profile: { library: boolean } = { library: true }): string {
  const combination = pickCombination(items => random.pick(items), { hasLibrary: profile.library });
  return `// ${nameOf(combination)}\n${textOf(combination, profile.library ? "console.log" : "print")}`;
}
