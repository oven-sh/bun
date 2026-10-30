import {
  isRefusedByEveryBuild,
  moments,
  program,
  targets,
  writes,
} from "../generators/names-written-under-keys-that-the-build-cannot-know";
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

export default family("names written under keys that the build cannot know", programs);
