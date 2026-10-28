import { generated, type Generated } from "./generated/run-generated";
import {
  knowledge,
  methodsWithCallback,
  program,
  programOfOneCall,
  waysToCall,
} from "./generated/wrappers-that-built-ins-hand-on";

const programs: Generated[] = [];
for (const way of Object.keys(waysToCall)) {
  for (const known of Object.keys(knowledge))
    programs.push({
      name: `${way}, ${known}`,
      isAlwaysRun: true,
      isOnlyCompiled: true,
      make: () => program(way, known),
    });
  for (const name of methodsWithCallback)
    programs.push({
      name: `${way}, ${name} alone`,
      isAlwaysRun: true,
      isOnlyCompiled: true,
      make: () => programOfOneCall(way, name),
    });
}

generated("wrappers that built-ins hand on", programs);
