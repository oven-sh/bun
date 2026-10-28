// Fixed seeds of fuzz/records-with-open-members-around-rings-written-as-json.ts: JSON.stringify is given records that have members of unknown type beside a member whose type names itself,
// once, twice and three times in one list. Each call prints its answer or its error, and what ran before it, in order.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/records-with-open-members-around-rings-written-as-json";
import { generated } from "./generated/run-generated";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    allowJs: true,
    noEmit: true,
    strict: true,
    types: [],
  },
});

generated(
  "a ring below a record with open members is refused as often as it is written",
  Array.from({ length: 12 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    isAlwaysRun: index % 6 < 1,
    isOnlyCompiled: true as const,
    flags: [],
    make: () => ({
      file: "main.ts",
      text: generate(new Random(index + 1)),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
