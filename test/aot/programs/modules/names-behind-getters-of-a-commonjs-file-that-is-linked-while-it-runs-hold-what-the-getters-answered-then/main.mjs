// A CommonJS file defines getters over variables that it declares further down, as compilers emit them, and then requires a file that requires an
// ES module which hands the names on: the file is linked while it runs. Whoever imports a name holds what its getter answered at that moment,
// `undefined` where the getter threw; whoever required the file runs the getter at each read.
import { early, fixed, loose, hoisted, made } from "./hands-on.mjs";
import * as all from "./hands-on.mjs";

function show(when) {
  console.log(when, typeof early, typeof fixed, typeof loose, typeof hoisted, typeof made);
  console.log(when, typeof all.early, typeof all.fixed, typeof all.loose, typeof all.hoisted, typeof all.made);
  console.log(when, readRequired());
}
show("now");
setTimeout(show, 0, "later");
