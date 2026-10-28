import { nameOf, pickCombination, programOf } from "../generated/where-the-stack-ends";
import type { Random } from "./random";

export function generate(random: Random): string {
  const combinations = Array.from({ length: random.between(1, 4) }, () => pickCombination(items => random.pick(items)));
  return `// ${combinations.map(nameOf).join(" ")}\n${programOf(combinations)}`;
}
