import {
  classesBeyondLatin1,
  groupsOfAlternatives,
  loopsAndGroups,
  outOfText,
  runsInFrontOfAssertions,
} from "./generated/regular-expressions";
import { generated } from "./generated/run-generated";

const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
const plainEnv = { BUN_JSC_useRegExpJIT: "0" };
// The interpreter, which is the reference, needs more than two minutes for an expression of these.
const tooSlowForTheInterpreter = [5, 11, 15, 17, 35];

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
          {
            name: `loops and groups out of text, seed ${seed}`,
            isAlwaysRun: seed === 2,
            plainEnv,
            make: () => outOfText(loopsAndGroups(seed, 300)),
          },
        ]),
    {
      name: `groups of alternatives, seed ${seed}`,
      isAlwaysRun: seed <= 1,
      plainEnv,
      make: () => groupsOfAlternatives(seed, 300),
    },
    {
      name: `groups of alternatives out of text, seed ${seed}`,
      isAlwaysRun: seed <= 1,
      plainEnv,
      make: () => outOfText(groupsOfAlternatives(seed, 300)),
    },
    {
      name: `runs in front of assertions, seed ${seed}`,
      isAlwaysRun: seed <= 1,
      plainEnv,
      make: () => runsInFrontOfAssertions(seed, 300),
    },
    {
      name: `runs in front of assertions out of text, seed ${seed}`,
      isAlwaysRun: seed === 2,
      plainEnv,
      make: () => outOfText(runsInFrontOfAssertions(seed, 300)),
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
    {
      name: `classes beyond Latin-1 out of text, seed ${seed}`,
      isAlwaysRun: false,
      plainEnv,
      make: () => outOfText(classesBeyondLatin1(seed, 150, false)),
    },
  ]),
);
