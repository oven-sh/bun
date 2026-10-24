// CommonJS bodies that threw, required again at the top of modules that are loaded later. Under `bun run` such a body runs again. In an executable it runs at most once and the require throws the same error, so the expected output is written down.
const show = (f) => { try { return String(f()); } catch (e) { return e.constructor.name; } };
const catches = require("./catches");
console.log(catches.thrown, "|", catches.always, "|", show(() => require("./second").thrown), "|", show(() => require("./third").always), "|", globalThis.runsOfThrown, globalThis.runsOfAlways);
