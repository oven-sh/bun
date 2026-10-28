// Fixed seeds of fuzz/objects-that-may-be-missing-hold-one-another.ts: two to four objects, each of which may be missing, hold one
// another, and the last one leaves its function on some ways only. The caller sees what it sees in plain Bun.
import { generate } from "./fuzz/objects-that-may-be-missing-hold-one-another";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

// Every run takes these, whatever else it takes.
const onceWrong = [32, 44, 64, 65, 201, 211, 214, 215, 230, 236, 248, 255, 270, 306, 315];

generated(
  "objects that may be missing and hold one another arrive as in plain Bun",
  Array.from({ length: 320 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.mjs", text: generate(new Random(index + 1)) }),
  })),
);
