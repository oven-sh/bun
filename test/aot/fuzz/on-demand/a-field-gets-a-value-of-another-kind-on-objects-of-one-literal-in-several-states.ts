// Fixed seeds of fuzz/a-field-gets-a-value-of-another-kind-on-objects-of-one-literal-in-several-states.ts. Objects of one literal get a value of another kind into one field, by a store or by the definition of a class field, each in another state. An executable prints what plain Bun prints.
import { generate } from "../../fuzz/a-field-gets-a-value-of-another-kind-on-objects-of-one-literal-in-several-states";
import { Random } from "../../fuzz/random";
import { generated } from "../../generated/run-generated";

const onceWrong = [272, 287, 300, 305, 316, 324];

generated(
  "a field gets a value of another kind on objects of one literal in several states",
  Array.from({ length: 480 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    // What the run time remembers of the objects of one program is the point.
    isBuiltAlone: true as const,
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
