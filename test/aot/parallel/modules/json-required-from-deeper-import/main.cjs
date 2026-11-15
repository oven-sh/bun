// A control for json-required-by-early-commonjs. The CommonJS file is imported two levels down, and the required module imports the JSON file itself.
// The loader reaches the JSON file first, so the require() returns the namespace.
require("./app.mjs");
