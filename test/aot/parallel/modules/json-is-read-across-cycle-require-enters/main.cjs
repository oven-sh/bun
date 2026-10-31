// A CommonJS file requires reader.mjs, which imports caller.mjs and is imported by it. caller.mjs runs first and has reader.mjs read data.json.
require("./reader.mjs");
