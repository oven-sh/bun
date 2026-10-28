import { members, places, program, values } from "../../generated/built-in-values-declared-as-interfaces";
import { generated } from "../../generated/run-generated";

const objects = [
  "the keys of an object",
  "a written list",
  "a map",
  "a set",
  "a date",
  "a regular expression",
  "bytes",
  "a buffer",
];

generated(
  "built-in values declared as interfaces",
  values.flatMap(value =>
    members.flatMap(member =>
      places.map(place => ({
        name: `${value[0]}, ${member[0]}, ${place[0]}.`,
        isAlwaysRun: member[0] === "then" && place === places[0],
        wasOnceWrong: member[0] === "then" && place === places[0] && objects.includes(value[0]),
        isOnlyCompiled: true as const,
        // Each is compiled as it is written: what a build knows of each value is what it is about.
        keepsItsText: true as const,
        make: () => program(value, member, place),
      })),
    ),
  ),
);
