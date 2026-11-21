// node:path is required and stored into before a file with a default and two named imports of it is linked: the named imports hold what was stored.
const path = require("node:path");
path.sep = "!";
path.join = () => "patched";
await import("./late.mjs");
