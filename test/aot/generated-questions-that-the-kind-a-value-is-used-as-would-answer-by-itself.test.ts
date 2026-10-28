// Fixed seeds of fuzz/questions-that-the-kind-a-value-is-used-as-would-answer-by-itself.ts: small programs about values out of `JSON.parse` that the program uses as one kind (numbers, texts, objects of one
// shape, lists). One value is of another kind, and the program asks a question about it whose answer would be the same for every value of the usual kind, and does nothing else with it.
import { generate } from "./fuzz/questions-that-the-kind-a-value-is-used-as-would-answer-by-itself";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const onceWrong = [9, 25, 30, 60, 123, 136, 145, 155, 169, 188, 194, 212, 223, 228];

generated(
  "questions that the kind a value is used as would answer by itself",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more use of the value would keep it alive.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
