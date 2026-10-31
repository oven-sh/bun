import { nameOf, pickCombination, programOf } from "./generators/where-the-stack-ends";
import * as writes from "./generators/writes-where-the-stack-ends";
import type { Random } from "./random";

export function generate(random: Random): string {
  if (random.between(0, 2) === 0) {
    let drawn = writes.pickCase(items => random.pick(items));
    while (drawn.call.text.includes("./leaf.mjs")) drawn = writes.pickCase(items => random.pick(items));
    return `// @ts-nocheck\n// ${writes.nameOf(drawn)}\n${writes.programOf(drawn)}`;
  }
  const combinations = Array.from({ length: random.between(1, 4) }, () => pickCombination(items => random.pick(items)));
  return `// ${combinations.map(nameOf).join(" ")}\n${programOf(combinations)}`;
}
