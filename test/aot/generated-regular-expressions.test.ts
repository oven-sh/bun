import { classesBeyondLatin1, groupsOfAlternatives, loopsAndGroups } from "./generated/regular-expressions";
import { generated } from "./generated/run-generated";

const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
const plainEnv = { BUN_JSC_useRegExpJIT: "0" };
// The interpreter, which is the reference, needs more than two minutes for an expression of these.
const tooSlowForTheInterpreter = [5, 11, 15, 35];

generated(
  "regular expressions",
  seeds.flatMap(seed => [
    ...(tooSlowForTheInterpreter.includes(seed)
      ? []
      : [
          {
            name: `loops and groups, seed ${seed}`,
            isAlwaysRun: seed <= 2,
            plainEnv,
            make: () => loopsAndGroups(seed, 300),
          },
        ]),
    {
      name: `groups of alternatives, seed ${seed}`,
      isAlwaysRun: seed <= 1,
      plainEnv,
      make: () => groupsOfAlternatives(seed, 300),
    },
    {
      name: `classes beyond Latin-1 under u and v, seed ${seed}`,
      isAlwaysRun: seed <= 1,
      plainEnv,
      make: () => classesBeyondLatin1(seed, 150, true),
    },
    {
      name: `classes beyond Latin-1, seed ${seed}`,
      isAlwaysRun: seed <= 1,
      plainEnv,
      make: () => classesBeyondLatin1(seed, 150, false),
    },
  ]),
);
