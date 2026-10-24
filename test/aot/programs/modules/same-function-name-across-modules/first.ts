import named, { bound, clamp, countArguments, describe, each, Meter } from "./lib";
import { join, pick, tally } from "./loose.js";

export function first(): string[] {
  const seen: string[] = [];
  each(["a", "b"], (value, index) => seen.push(value + index));
  const meter = Meter.of("m", 2).add(1.5);
  return [String(clamp(12)), describe({ depth: 1 }), seen.join(""), String((countArguments as (...all: unknown[]) => number)(1, 2, 3)), String(bound.call({ base: 4 }, 5)), named("one"), meter.reading, join(1, "x"), String(pick([7, 8], 1)), String((tally as (...all: number[]) => number)(1, 2, 3))];
}
