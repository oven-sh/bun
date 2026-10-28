// One row of the table in ../generated/typed-instances-changed-through-built-ins.ts: an instance of a typed class, and one way in which a built-in, a protocol or a callback changes it or makes another object that passes for one.
import { changes, textOf } from "../generated/typed-instances-changed-through-built-ins";
import type { Random } from "./random";

export function generate(random: Random): string {
  const change = random.pick(Object.keys(changes));
  return `// ${change}\n${textOf(change)}`;
}
