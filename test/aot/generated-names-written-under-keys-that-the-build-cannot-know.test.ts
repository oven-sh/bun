import {
  isRefusedByEveryBuild,
  moments,
  program,
  targets,
  writes,
} from "./generated/names-written-under-keys-that-the-build-cannot-know";
import { generated, type Generated } from "./generated/run-generated";

const programs: Generated[] = [];
for (const target of Object.keys(targets))
  for (const write of Object.keys(writes))
    for (const moment of moments)
      if (!isRefusedByEveryBuild(target, write))
        programs.push({
          name: `${target}, by ${write}, ${moment}`,
          isAlwaysRun: moment === "between two uses in one function",
          wasOnceWrong:
            target === "prototype of a constructor function" && moment === "between two uses in one function",
          isOnlyCompiled: true,
          make: () => program(target, write, moment),
        });

generated("names written under keys that the build cannot know", programs);
