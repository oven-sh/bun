// A `Schema` alias whose argument is not one literal of the right kind constrains nothing: the value is validated against the rest of its type, and the build counts each argument it dropped.
// STATISTIC: SchemaArgumentsDropped = 3
import type { Schema } from "bun";
interface Loose {
  unbounded: number & Schema.Min<number>;
  negative: string & Schema.MinLength<-1>;
  either: string & Schema.Format<"email" | "uuid">;
  bounded: number & Schema.Min<1>;
}
function accepts(change: Partial<Record<keyof Loose, unknown>>): string {
  try {
    JSON.parse<Loose>(JSON.stringify({ unbounded: -5, negative: "", either: "neither", bounded: 1, ...change }));
    return "accepted";
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return "rejected";
  }
}
console.log("what a dropped argument would have rejected: " + accepts({}));
console.log("the argument that stands: " + accepts({ bounded: 0 }));
console.log("the rest of each type: " + [accepts({ unbounded: "5" }), accepts({ negative: 1 }), accepts({ either: null })].join(", "));
