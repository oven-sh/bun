// `import type` and `import { type .. }` of an enum whose members are made of other members, named by a path that begins at the enum.
import type { Flags } from "./flags";
import { type Level } from "./level";
import type * as levels from "./level";
function describe(flags: Flags, level: Level, other: levels.Level): string {
  return flags + " " + level + " " + other;
}
console.log(describe(3, "low-high" as Level, "low" as levels.Level));
