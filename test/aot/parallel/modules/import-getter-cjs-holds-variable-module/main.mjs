// A CommonJS file defines a getter that returns a variable which an ES module exports and stores to later. Whoever imports the name holds what the
// getter returned when the file was loaded; whoever required the file runs the getter at each read.
import { count } from "./lib.cjs";
import * as all from "./lib.cjs";
import { count as throughStar } from "./star.mjs";
import { count as byName } from "./by-name.mjs";
import { count as throughTwoGetters } from "./outer.cjs";
import { read } from "./reader.cjs";
import { change, count as live } from "./counter.mjs";

function show() {
  console.log(count, all.count, throughStar, byName, throughTwoGetters, read(), live);
}
show();
change();
show();
