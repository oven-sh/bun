// The entry point calls import() on a module and then requires a second one, which calls import() on the entry point. The first module runs when the entry point has ended, and reads what the second one exports.
import("./imported.mjs");
require("./required.mjs");
