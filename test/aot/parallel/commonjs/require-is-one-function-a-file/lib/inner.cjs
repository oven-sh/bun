"use strict";
const first = require,
  second = require;
const say = (what, value) => console.log(__filename.slice(__filename.lastIndexOf("/") + 1), what, value);
say("the same twice", first === second && require === require);
first.stored = 1;
say("stored through one mention, read through another", require.stored);
function inAFunction() {
  return require;
}
say("the same in a function", inAFunction() === first);
say("module.require", module.require === require);
say("arguments[1]", arguments[1] === require);
say("resolve", require.resolve === require.resolve);
say(
  "cache, main, extensions",
  [require.cache === require.cache, require.main === require.main, require.extensions === require.extensions].join(),
);
Object.freeze(first);
say("frozen through one mention, asked through another", Object.isFrozen(require));
try {
  require.late = 2;
  say("a store after freezing", require.late);
} catch (error) {
  say("a store after freezing throws", error.name);
}
say("still requires", typeof require("node:path").join + " " + require("./data.json").k);
globalThis.requireOfInner = require;
