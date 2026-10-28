// Fixed seeds of fuzz/a-conditional-yields-an-object-literal-or-an-empty-one.ts: `test ? { key: value } : {}`, spread, nested, returned, kept or given to a call, in TypeScript and in JavaScript.
import { generate } from "./fuzz/a-conditional-yields-an-object-literal-or-an-empty-one";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "a conditional yields an object literal or an empty one",
  Array.from({ length: 240 }, (_, index) => {
    const isTyped = index % 2 === 0;
    return {
      name: `seed ${index + 1}${isTyped ? ", typed" : ""}.`,
      // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
      isAlwaysRun: index < 24,
      isOnlyCompiled: true as const,
      // Each is compiled as it is written: what a build knows of each value is what it is about.
      keepsItsText: true as const,
      // Every second pair is built with every pass verified.
      flags: index % 4 >= 2 ? ["--aot-verify-each-pass", "--aot-check=validate-references"] : [],
      make: () => ({ file: isTyped ? "main.ts" : "main.mjs", text: generate(new Random(index + 1), isTyped) }),
    };
  }),
);
