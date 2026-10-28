import { generated } from "./generated/run-generated";
import { program, types, ways } from "./generated/values-stored-outside-the-type-of-a-field";

const bornUndefinedInSlotsOfNumbersAndBooleans = [
  "a number or undefined",
  "a boolean or undefined",
  "a number, a boolean or undefined",
  "one of two numbers or undefined",
  "undefined",
];

generated(
  "values stored outside the type of a field",
  types.flatMap(type =>
    ways.map(way => ({
      name: `${type[0]}, ${way[0]}.`,
      isAlwaysRun: way === ways[0] || bornUndefinedInSlotsOfNumbersAndBooleans.includes(type[0]),
      wasOnceWrong:
        (way === ways[0] && bornUndefinedInSlotsOfNumbersAndBooleans.includes(type[0])) ||
        (type[0] === "a function or undefined" && way[0] === "a spread"),
      isOnlyCompiled: true as const,
      // Each is compiled as it is written: what a build knows of each field is what it is about.
      keepsItsText: true as const,
      make: () => program(type, way),
    })),
  ),
);
