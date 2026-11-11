// React's enqueueTask() reads `require` off the module object under a key that it puts together, "to get around the bundlers". A text of the file is the name, so the name is spelled.
const name = ("require" + Math.random()).slice(0, 7);
const say = (what, f) => {
  try {
    console.log(what, f());
  } catch (error) {
    console.log(what, "threw", error.constructor.name);
  }
};
require("./other.cjs");
say("as React", () => typeof (module && module[name]).call(module, "timers").setImmediate);
say("called directly", () => typeof module[name]("timers").setImmediate);
say("optional", () => typeof module?.[name]?.("timers").setImmediate);
say("held", () => {
  const held = module[name];
  return typeof held.call(module, "node:path").join;
});
say("the same function", () => module[name] === module.require);
say("other keys", () =>
  [typeof module["ex" + "ports".slice(0, 5)], module[("id" + Math.random()).slice(0, 2)] === module.id].join(),
);
say("a file that a require() names too", () => module[name]("./other.cjs").other);
say("typeof", () => typeof module[name]);
say("in", () => name in module);
function inner(module) {
  return module[name];
}
say("a parameter of that name", () => inner({ require: "mine" }));
