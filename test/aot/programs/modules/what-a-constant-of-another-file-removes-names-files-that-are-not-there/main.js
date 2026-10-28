// The arm that is never taken names a file and a package that do not exist.
import { debug } from "./flags.js";
if (debug) {
  require("./not-there.cjs");
  await import("no-such-package");
}
console.log("done");
