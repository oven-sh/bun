import { casesOfSource, namesOfSources, program, sample, ways } from "./generated/numbers-whose-bits-are-chosen";
import { generated, type Generated } from "./generated/run-generated";

const casesInOneProgram = 400;
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
    for (const source of namesOfSources) {
      const cases = casesOfSource(source);
      for (let first = 0; first < cases.length; first += casesInOneProgram)
        programs.push({
          name: `${source} from ${first}, ${way}${kind}`,
          isAlwaysRun: false,
          isOnlyCompiled: true,
          flags,
          make: () => program(cases.slice(first, first + casesInOneProgram), isOpened),
        });
    }
  }
}

generated("numbers whose bits are chosen", programs);
