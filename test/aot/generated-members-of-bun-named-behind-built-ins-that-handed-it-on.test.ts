// Fixed seeds of fuzz/members-of-bun-named-behind-built-ins-that-handed-it-on.ts: `Bun` goes through a row of promises, lists, maps, generators,
// copies, descriptors, proxies and objects that inherit from it, and behind the row a member is read, called, constructed, stored or asked for.
import { generate } from "./fuzz/members-of-bun-named-behind-built-ins-that-handed-it-on";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const lacksAMember: number[] = [18, 71, 78, 131, 148];

generated(
  "a member of Bun that is named behind built-ins answers as in plain Bun",
  Array.from({ length: 160 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    isOnlyCompiled: true as const,
    ...(lacksAMember.includes(index + 1)
      ? { linesDepartToday: "a member that the program names behind a built-in is not in the executable" }
      : {}),
    make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
  })),
);
