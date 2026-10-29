// A CommonJS file calls import() of the ES module that is being required and imports it, and then throws. The require() and the import() both fail with that error.
// `bun run` loses the error: the module runs as if the file had finished, or fails to link for a name that the file has set.
// Reference: bun build --compile
globalThis.say = (...words) => console.log(...words);
try {
  require("./bare/module.mjs");
  say("bare: required");
} catch (error) {
  say("bare: threw", error.message);
}
try {
  require("./named/module.mjs");
  say("named: required");
} catch (error) {
  say("named: threw", error.message);
}
