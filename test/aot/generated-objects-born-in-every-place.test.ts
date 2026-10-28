import { everyCase, program, sample, ways } from "./generated/objects-born-in-every-place";
import { generated, type Generated } from "./generated/run-generated";

const casesInOneProgram = 120;
let sampled: string[] | undefined;
const kinds = [
  { kind: "", isOpened: false },
  { kind: ", everything seen by evaluated text", isOpened: true },
];

const programs: Generated[] = [];
for (const [way, flags] of Object.entries(ways)) {
  for (const { kind, isOpened } of kinds) {
    programs.push({
      name: `a sample, ${way}${kind}`,
      isAlwaysRun: true,
      isOnlyCompiled: true,
      flags,
      make: () => program((sampled ??= sample(casesInOneProgram)), isOpened),
    });
    for (let first = 0; first < everyCase.length; first += casesInOneProgram)
      programs.push({
        name: `from ${first}, ${way}${kind}`,
        isAlwaysRun: false,
        isOnlyCompiled: true,
        flags,
        make: () => program(everyCase.slice(first, first + casesInOneProgram), isOpened),
      });
  }
}

generated("objects born in every place", programs);
