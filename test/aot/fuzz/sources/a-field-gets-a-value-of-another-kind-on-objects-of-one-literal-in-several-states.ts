// Fixed seeds of fuzz/a-field-gets-a-value-of-another-kind-on-objects-of-one-literal-in-several-states.ts. Objects of one literal get a value of another kind into one field, by a store or by the definition of a class field, each in another state. An executable prints what plain Bun prints.
import { generate } from "../a-field-gets-a-value-of-another-kind-on-objects-of-one-literal-in-several-states";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "a field gets a value of another kind on objects of one literal in several states",
  Array.from({ length: 480 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // What the run time remembers of the objects of one program is the point.
    isBuiltAlone: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
