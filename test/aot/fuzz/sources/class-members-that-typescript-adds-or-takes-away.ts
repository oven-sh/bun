// Fixed seeds of fuzz/class-members-that-typescript-adds-or-takes-away.ts: classes with parameter properties, `accessor` fields, fields with and without values, abstract members, overloads and
// everything else that is only a type. They print the order in which everything runs, the keys and attributes of the classes and their instances, and what each member answers.
import { generate, options } from "../class-members-that-typescript-adds-or-takes-away";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "class members that TypeScript adds or takes away",
  Array.from({ length: 120 }, (_, index) => {
    // Programs share an executable with those of the same tsconfig.json, so the options come in runs of six.
    const option = options[Math.floor(index / 6) % options.length];
    return {
      name: `seed ${index + 1}, a field ${option}.`,
      make: () => ({ file: "main.ts", ...generate(new Random(index + 1), option) }),
    };
  }),
);
