// The program has stored a require of its own, as loaders and instrumentation do. It answers for three names by itself and hands every other name on to the one that it replaced.
// The names are made at run time. What the stored function answers is the program's own and is no load of a built-in module: it is asked first.
const Module = require("node:module");
const original = Module.prototype.require;
const own = { punycode: "mine", buffer: "mine", tty: "mine" };
Module.prototype.require = function (request) {
  return Object.hasOwn(own, request) ? own[request] : original.call(this, request);
};
process.stdout.write("");
for (const text of ['"punycode"', '"buffer"', '"tty"']) {
  const name = JSON.parse(process.env.NOBODY_SETS_THIS_ONE ?? text);
  console.log(name, require(name));
}
