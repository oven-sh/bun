// `feature` of "bun:bundle" is no variable when the program runs. A `--define` whose value is its name reads the global of that name, and a path below it finds nothing.
// Flags: --define NAME=feature --define LABEL=feature.name
import { feature } from "bun:bundle";
function attempt(read) {
  try {
    return read();
  } catch (error) {
    return error.constructor.name;
  }
}
console.log(
  typeof NAME,
  attempt(() => NAME),
  attempt(() => LABEL),
  feature("ON") ? "on" : "off",
);
