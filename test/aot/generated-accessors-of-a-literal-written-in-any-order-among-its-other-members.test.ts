// Fixed seeds of fuzz/accessors-of-a-literal-written-in-any-order-among-its-other-members.ts: small programs about one object literal with a getter and a setter among two or three other members: values,
// methods, computed keys and spreads of the same name or another. The members take effect in the order in which they are written, and every evaluation of the literal makes new functions.
import { generate } from "./fuzz/accessors-of-a-literal-written-in-any-order-among-its-other-members";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "accessors of a literal written in any order among its other members",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more use of the object would be one more thing known about it.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
