// One row of the table in ./generators/typed-instances-mutated-by-builtins.ts: an instance of a typed class, and one
// way in which a built-in, a protocol or a callback mutates it or creates another object that passes for one.
import { changes, textOf } from "./generators/typed-instances-mutated-by-builtins";
import type { Random } from "./random";

export function generate(random: Random): string {
  const change = random.pick(Object.keys(changes));
  return `// ${change}\n${textOf(change)}`;
}
