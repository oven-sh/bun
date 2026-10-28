import { generated, type Generated } from "./generated/run-generated";
import { everyCase, program, sample } from "./generated/typed-arrays-of-every-kind-below-any-class";

// AOT_GENERATED_FLAGS builds all of them another way.
const flagsOfSample: Record<string, string[]> = {
  "validating": ["--aot-validate"],
  "everything hot": ["--aot-heat=everything-is-hot"],
  "each pass verified": ["--aot-verify-each-pass"],
};
const sampled = sample(12);

const programs: Generated[] = everyCase.map(name => ({
  name,
  isAlwaysRun: sampled.includes(name),
  isOnlyCompiled: true,
  make: () => program(name),
}));
for (const [way, flags] of Object.entries(flagsOfSample))
  for (const name of sampled)
    programs.push({
      name: `${name}, ${way}`,
      isAlwaysRun: true,
      isOnlyCompiled: true,
      flags,
      make: () => program(name),
    });

generated("typed arrays of every kind below any class", programs);
