// Fixed seeds of fuzz/questions-about-a-member-that-the-kind-it-is-used-as-would-answer.ts: small programs about objects out of `JSON.parse` whose members the program uses as one kind. One member is of
// another kind, is missing, or the members come in another order, and the program asks a question about it whose answer would be the same for every value of the usual kind, and does nothing else with it.
import { generate } from "./fuzz/questions-about-a-member-that-the-kind-it-is-used-as-would-answer";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "questions about a member that the kind it is used as would answer",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more use of the member would keep it alive.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
