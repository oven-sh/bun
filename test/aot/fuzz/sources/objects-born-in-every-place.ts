import { everyCase, program, sample, ways } from "../generators/objects-born-in-every-place";
import { family, type Member } from "../family";

const casesInOneProgram = 120;
let sampled: string[] | undefined;
const kinds = [
  { kind: "", isOpened: false },
  { kind: ", everything seen by evaluated text", isOpened: true },
];

const programs: Member[] = [];
for (const [way, flags] of Object.entries(ways)) {
  for (const { kind, isOpened } of kinds) {
    programs.push({
      name: `a sample, ${way}${kind}`,
      flags,
      make: () => program((sampled ??= sample(casesInOneProgram)), isOpened),
    });
    for (let first = 0; first < everyCase.length; first += casesInOneProgram)
      programs.push({
        name: `from ${first}, ${way}${kind}`,
        flags,
        make: () => program(everyCase.slice(first, first + casesInOneProgram), isOpened),
      });
  }
}

export default family("objects born in every place", programs);
