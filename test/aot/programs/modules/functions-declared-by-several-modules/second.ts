import named, { clamp, describe, each, later, Meter, upTo } from "./lib";
import { join, pick, tally } from "./loose.js";

export async function second(): Promise<string[]> {
  let sum = 0;
  each([1, 2, 3], value => { sum += value; });
  const meter = new Meter("s");
  meter.reading = "2.5";
  const steps = [...upTo(3)];
  return [String(clamp(-3, -1)), describe({ depth: 2, label: "two" }, "p", "q"), String(sum), await later("soon"), steps.join(","), named("two"), meter.add(1).reading, join("y", 2), String(pick("abc", 2)), String(tally())];
}
