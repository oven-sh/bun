// A store into `module.parent` that is no module object leaves the file without a parent: `bun run` reads undefined from then on.
// The getter went back to asking the compiled program who had required the file first.
require("./lib.cjs");
