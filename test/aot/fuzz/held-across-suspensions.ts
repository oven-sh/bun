import { nameOf, pickCombination, programOf } from "../generated/held-across-suspensions";
import type { Random } from "./random";

export function generate(random: Random): string {
  const combinations = Array.from({ length: random.between(1, 5) }, () => pickCombination(items => random.pick(items)));
  return `// ${combinations.map(nameOf).join(" ")}\n${programOf(combinations)}`;
}
