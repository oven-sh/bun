// A store through a defined name whose `--define` value names an import throws a TypeError where the store runs, behind the value, and so does a store through a path below a namespace import.
// Flags: --define NAME=named --define STAR=star --define MEMBER=star.named
import { named } from "./exports.mjs";
import * as star from "./exports.mjs";
const seen = [];
function attempt(store) {
  try {
    store();
    seen.push("no error");
  } catch (error) {
    seen.push(error.constructor.name);
  }
}
attempt(() => (NAME = (seen.push("the value"), 1)));
attempt(() => NAME++);
attempt(() => ([NAME] = [2]));
attempt(() => (STAR = 3));
attempt(() => (MEMBER = 4));
console.log(seen.join(" "), named, star.named);
