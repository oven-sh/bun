// A CommonJS file defines getters over variables that it declares further down, as compilers emit them, and then requires a file that requires an
// ES module with `export *` of it: the file is linked while it runs. Whoever imports a name holds what its getter answered at that moment,
// `undefined` where the getter threw.
import { early, fixed, loose, hoisted, made } from "./star.mjs";
import * as all from "./star.mjs";

function show(when) {
  console.log(when, typeof early, typeof fixed, typeof loose, typeof hoisted, typeof made);
  console.log(when, Object.keys(all).join(), typeof all.early, typeof all.fixed, typeof all.loose, typeof all.hoisted, typeof all.made);
}
show("now");
setTimeout(show, 0, "later");
