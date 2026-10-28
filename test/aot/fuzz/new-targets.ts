// One point of the table in ../generated/new-targets.ts: the form of a base constructor, how another new.target reaches it, what it does with `this`, where the construction runs, what is observed afterwards.
import { nameOf, pickCombination, textOf } from "../generated/new-targets";
import type { Random } from "./random";

export function generate(random: Random, _typed: boolean, profile: { library: boolean } = { library: true }): string {
  const combination = pickCombination(items => random.pick(items), { hasLibrary: profile.library, hasOutsideHelpers: false });
  return `// ${nameOf(combination)}\n${textOf(combination, profile.library ? "console.log" : "print")}`;
}
