// Fixed seeds of fuzz/results-of-awaited-steps-used-behind-a-test.ts: the result of an awaited step is an ordinary object behind every test of
// it, as in plain Bun. Each program is built beside another one, which keeps the compiler from knowing every object of the program.
import { readFileSync } from "fs";
import { join } from "path";
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/results-of-awaited-steps-used-behind-a-test";
import { generated } from "./generated/run-generated";

const company = readFileSync(
  join(import.meta.dir, "programs/type-rules/plain-type-descriptions-not-in-image.ts"),
  "utf8",
);

// Every run takes these, whatever else it takes.
const onceWrong = [123, 132, 160, 165, 227, 277];

generated(
  "results of awaited steps are ordinary objects behind a test",
  Array.from({ length: 320 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    flags: index % 2 === 1 ? ["--aot-heat=everything-is-hot"] : [],
    make: () => ({
      file: "main.mjs",
      text: generate(new Random(index + 1)) + 'await import("./company.ts");\n',
      files: { "company.ts": company },
    }),
  })),
);
