// A list of programs from ../json-parse-with-excess-members.ts, which describes them.
import { generate, groupNames, typeNames, uses } from "../json-parse-with-excess-members";
import { family } from "../family";

const programs = typeNames.flatMap(type => groupNames.flatMap(group => uses.map(use => ({ type, group, use }))));

export default family(
  "json parse with excess members",
  programs.map(({ type, group, use }, index) => ({
    name: `seed ${index + 1}, ${type}, members ${group}, ${use}.`,
    make: () => generate(type, group, use),
  })),
);
