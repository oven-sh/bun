// Fixed seeds of fuzz/a-short-loop-whose-every-turn-reads-what-one-rare-turn-changes.ts: small programs about one short loop of a hundred turns. Every turn reads one piece of state, in a test, a sum, the
// bound of the loop or a call; on one turn, or a few, an arm that is seldom taken changes that state by one road. The turns behind it see the change.
import { generate } from "./fuzz/a-short-loop-whose-every-turn-reads-what-one-rare-turn-changes";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "a short loop whose every turn reads what one rare turn changes",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more store to the state would be one more thing known about it.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
