import { family, type Member } from "../family";
import { everyCase, program, sample } from "../generators/typed-arrays-of-every-kind-below-any-class";

const flagsOfSample: Record<string, string[]> = {
  "validating": ["--aot-validate"],
  "everything hot": ["--aot-heat=everything-is-hot"],
  "each pass verified": ["--aot-verify-each-pass"],
};
const sampled = sample(12);

const programs: Member[] = everyCase.map(name => ({
  name,
  make: () => program(name),
}));
for (const [way, flags] of Object.entries(flagsOfSample))
  for (const name of sampled)
    programs.push({
      name: `${name}, ${way}`,
      flags,
      make: () => program(name),
    });

export default family("typed arrays of every kind below any class", programs);
