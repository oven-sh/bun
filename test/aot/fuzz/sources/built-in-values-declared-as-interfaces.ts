import { members, places, program, values } from "../generators/built-in-values-declared-as-interfaces";
import { family } from "../family";

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

export default family(
  "built-in values declared as interfaces",
  values.flatMap(value =>
    members.flatMap(member =>
      places.map(place => ({
        name: `${value[0]}, ${member[0]}, ${place[0]}.`,
        make: () => program(value, member, place),
      })),
    ),
  ),
);
