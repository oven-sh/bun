// Fixed seeds of fuzz/tail-calls-between-the-program-and-functions-made-from-text.ts: a ring of strict functions call one another in tail position.
// Some stand in the program, some are made from text at run time, some are reached through a Proxy without an apply trap. A ring of tail calls is
// walked a hundred thousand times and ends as it ends in plain Bun.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/tail-calls-between-the-program-and-functions-made-from-text";
import { generated } from "./generated/run-generated";

// Every run takes these, whatever else it takes.
const onceWrong = [1, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16];

generated(
  "tail calls between the program and functions made from text end as in plain Bun",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    flags: onceWrong.includes(index + 1)
      ? []
      : index % 4 === 3
        ? ["--aot-heat=everything-is-hot"]
        : index % 4 === 2
          ? ["--aot-heat=everything-is-cold"]
          : [],
    make: () => ({ file: "main.mjs", text: generate(new Random(index + 1)) }),
  })),
);
