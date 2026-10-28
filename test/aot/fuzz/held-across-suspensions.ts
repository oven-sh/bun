import { largeProgramOf, nameOf, nameOfLarge, pickCombination, pickLarge, programOf } from "../generated/held-across-suspensions";
import type { Random } from "./random";

export function generate(random: Random): string {
  if (random.chance(0.3)) {
    const large = pickLarge(items => random.pick(items), random.between(4, 40));
    return `// ${nameOfLarge(large)}\n${largeProgramOf(large)}`;
  }
  const combinations = Array.from({ length: random.between(1, 5) }, () => pickCombination(items => random.pick(items)));
  return `// ${combinations.map(nameOf).join(" ")}\n${programOf(combinations)}`;
}
