// A list of programs from ../generators/library-calls-near-stack-limit.ts, which describes them.
import { programs } from "../generators/library-calls-near-stack-limit";
import { family } from "../family";

// Clocks, counters and subscriber lists return something different at each call.
const answersChange = [
  "methods-of-channel",
  "methods-of-file",
  "module-diagnostics_channel",
  "module-os",
  "module-process",
  "static-Date",
];
// Plain Bun is just as slow: minutes for the two zlib parts, and up to the run time limit for the other.
const tooSlow = ["module-zlib part 0", "module-zlib part 1", "static-Error"];

export default family(
  "library calls near stack limit",
  programs.map(({ name, text }) => ({
    name,
    ...(answersChange.includes(name) ? { linesDepartToday: "what some entries answer changes from call to call" } : {}),
    ...(tooSlow.includes(name) ? { failsToday: "does not end in time" } : {}),
    make: () => ({ file: "main.js", text }),
  })),
);
