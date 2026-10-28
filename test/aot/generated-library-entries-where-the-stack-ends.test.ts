import { programs } from "./generated/library-entries-where-the-stack-ends";
import { generated } from "./generated/run-generated";

const alwaysRun = ["module-util part 0", "statics-on-function", "views-of-bytes"];
// Clocks, counters and lists of subscribers answer otherwise from one call to the next.
const answersChange = [
  "methods-of-channel",
  "methods-of-file",
  "module-diagnostics_channel",
  "module-os",
  "module-process",
  "static-Date",
];
// TODO: an error made near the end of the stack takes about seven times as long as in plain Bun.
const tooSlow = [
  "module-assert",
  "module-assert-strict",
  "module-fs",
  "module-zlib part 0",
  "module-zlib part 1",
  "static-Error",
];

generated(
  "library entries are called where the stack ends",
  programs.map(({ name, text }) => ({
    name,
    isAlwaysRun: alwaysRun.includes(name),
    isOnlyCompiled: true as const,
    ...(answersChange.includes(name) ? { linesDepartToday: "what some entries answer changes from call to call" } : {}),
    ...(tooSlow.includes(name) ? { failsToday: "does not end in time" } : {}),
    make: () => ({ file: "main.js", text }),
  })),
);
