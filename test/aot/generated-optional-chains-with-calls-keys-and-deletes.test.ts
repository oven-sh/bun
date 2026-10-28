// Fixed seeds of fuzz/optional-chains-with-calls-keys-and-deletes.ts: chains of members, computed keys and calls, with and without `?.`, over objects that tell of every read and every call.
// Where a chain ends early nothing behind that link runs. They print the order of everything, the receiver of every call, and what `delete` has left.
import { generate } from "./fuzz/optional-chains-with-calls-keys-and-deletes";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "optional chains with calls, keys and deletes",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
  })),
);
