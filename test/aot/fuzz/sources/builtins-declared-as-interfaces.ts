// A list of programs from ../generators/builtins-declared-as-interfaces.ts, which describes them.
import { members, places, program, values } from "../generators/builtins-declared-as-interfaces";
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
  "builtins declared as interfaces",
  values.flatMap(value =>
    members.flatMap(member =>
      places.map(place => ({
        name: `${value[0]}, ${member[0]}, ${place[0]}.`,
        make: () => program(value, member, place),
      })),
    ),
  ),
);
