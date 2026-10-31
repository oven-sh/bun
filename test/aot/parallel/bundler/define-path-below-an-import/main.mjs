// A `--define` whose value is a dotted path reads a member of an import that nothing else names, from inside a function.
// Flags: --define ROOT=holder.value
import { holder } from "./exports.mjs";
function read() {
  return ROOT;
}
console.log(read());
