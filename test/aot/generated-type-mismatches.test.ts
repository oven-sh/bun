import { generated } from "./generated/run-generated";
import { places, program } from "./generated/type-mismatches";

generated(
  "values that do not fit",
  places.map(({ place, isAlwaysRun, modeFailsToday }) => ({
    name: place,
    isAlwaysRun,
    modeFailsToday,
    make: () => program(place),
  })),
);
