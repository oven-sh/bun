// Fixed seeds of fuzz/members-removed-at-shared-sites-from-many-kinds-of-objects.ts: three functions remove a member under a written name or a
// key, and objects of many kinds and shapes go through them for a hundred rounds and more. After each removal the program lists and reads what
// is left. One seed in four is a CommonJS file that is not strict.
import { generate } from "./fuzz/members-removed-at-shared-sites-from-many-kinds-of-objects";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const listsArgumentsOtherwise: number[] = [158];

generated(
  "what is left behind a removal is what is left in plain Bun",
  Array.from({ length: 160 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    isOnlyCompiled: true as const,
    ...(listsArgumentsOtherwise.includes(index + 1)
      ? { linesDepartToday: "a member added to the arguments of a strict function is listed behind callee" }
      : {}),
    make: () => ({ file: index % 4 === 3 ? "main.cjs" : "main.mjs", text: generate(new Random(index + 1)) }),
  })),
);
