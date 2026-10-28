// Every read of the namespace object finds a constant, so nobody asks the package for anything.
import * as all from "pkg";
import { inner } from "pkg";
if (all.debug) console.log("never");
console.log(all.used + 1, all.text, inner.used);
