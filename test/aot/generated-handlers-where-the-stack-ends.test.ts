import { isASAN } from "harness";
import { dropsPromises, namesOfGuards, program, ways } from "./generated/handlers-where-the-stack-ends";
import { generated, type Generated } from "./generated/run-generated";

const programs: Generated[] = [];
for (const [way, flags] of Object.entries(ways)) {
  for (const guard of namesOfGuards) {
    programs.push({
      name: `${guard}, ${way}`,
      isAlwaysRun: true,
      isOnlyCompiled: true,
      ...(dropsPromises(guard) ? { leavesAnError: true as const } : {}),
      // The pinned engine, built with assertions, walks the whole stack at every handler to compare one pointer.
      ...(isASAN ? { failsToday: "does not end in time" } : {}),
      flags,
      make: () => program(guard),
    });
  }
}

generated("handlers where the stack ends", programs);
