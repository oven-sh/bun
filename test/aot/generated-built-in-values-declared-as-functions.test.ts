import { declarations, program, values } from "./generated/built-in-values-declared-as-functions";
import { generated } from "./generated/run-generated";

const followedToTheValue = [
  "a constant of type unknown and a cast",
  "a constant of type any",
  "a type guard that accepts everything",
];

generated(
  "built-in values declared as functions",
  values.flatMap(value =>
    declarations.map(declaration => ({
      name: `${value}, ${declaration[0]}.`,
      isAlwaysRun: declaration === declarations[0] || value === "Symbol.iterator",
      wasOnceWrong: value === "Symbol.iterator" && followedToTheValue.includes(declaration[0]),
      isOnlyCompiled: true as const,
      // Each is compiled as it is written: what a build knows of each value is what it is about.
      keepsItsText: true as const,
      make: () => program(value, declaration),
    })),
  ),
);
