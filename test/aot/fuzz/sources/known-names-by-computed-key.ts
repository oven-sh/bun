// A list of programs from ../generators/known-names-by-computed-key.ts, which describes them.
import {
  isRefusedByEveryBuild,
  moments,
  program,
  targets,
  writes,
} from "../generators/known-names-by-computed-key";
import { family, type Member } from "../family";

const programs: Member[] = [];
for (const target of Object.keys(targets))
  for (const write of Object.keys(writes))
    for (const moment of moments)
      if (!isRefusedByEveryBuild(target, write))
        programs.push({
          name: `${target}, by ${write}, ${moment}`,
          make: () => program(target, write, moment),
        });

export default family("known names by computed key", programs);
