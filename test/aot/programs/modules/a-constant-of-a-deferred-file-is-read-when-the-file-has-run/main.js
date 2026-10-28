// `import defer` runs the file at the first read of a member of its namespace object.
import defer * as flags from "./flags.js";
console.log("main begins");
if (flags.debug) console.log("never");
console.log("main ends");
