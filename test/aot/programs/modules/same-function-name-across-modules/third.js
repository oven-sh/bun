import named, { clamp, describe, Meter } from "./lib";
import { join, tally } from "./loose.js";

export function third() {
  return [clamp(5, 6, 7), describe({ depth: 3, label: "three" }), named("three"), Meter.of("kg", 1).reading, join(null, undefined), tally(0.5, 0.25), Meter.made].map(String);
}
