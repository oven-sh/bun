import { everyCase, program, sample, ways, written } from "./generated/bytes-whoever-holds-them";
import { generated, type Generated } from "./generated/run-generated";

const casesInOneProgram = 70;
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
      written,
      make: () => program((sampled ??= sample(casesInOneProgram)), isOpened),
    });
    for (let first = 0; first < everyCase.length; first += casesInOneProgram)
      programs.push({
        name: `from ${first}, ${way}${kind}`,
        isAlwaysRun: false,
        isOnlyCompiled: true,
        flags,
        written,
        make: () => program(everyCase.slice(first, first + casesInOneProgram), isOpened),
      });
  }
}

generated("bytes whoever holds them", programs);
