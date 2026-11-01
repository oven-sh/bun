// A CommonJS file defines getters that return names of a second file. The second file never stores one of them, stores one under a condition that does
// not hold, one under a condition that holds, and one only when a function is called. The file that defines the getters has all of the names.
import { absent, fill, held, later, never, present, read } from "./lib.cjs";
import * as all from "./lib.cjs";
import { absent as throughStar } from "./star.mjs";
import { absent as byName, never as neverByName } from "./by-name.mjs";
import { absent as throughTwoGetters, later as laterThroughTwoGetters } from "./outer.cjs";
import { absent as asTypeScriptWritesIt, present as presentAsTypeScriptWritesIt } from "./typescript.cjs";
import { absent as unused } from "./unused.cjs";

function show() {
  console.log(absent, never, held, later, present, read());
  console.log(all.absent, all.never, all.later, throughStar, byName, neverByName, throughTwoGetters, laterThroughTwoGetters);
  console.log(asTypeScriptWritesIt, presentAsTypeScriptWritesIt);
}
show();
fill();
show();
try {
  absent();
} catch (error) {
  console.log(error instanceof TypeError);
}
