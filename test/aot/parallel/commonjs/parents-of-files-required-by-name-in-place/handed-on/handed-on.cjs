const base = key => require("node:path").basename(key);
const say = (what, value) => console.log(what, JSON.stringify(value));
const load = (ask, name) => ask(name);
const child = load(require, ["./child", ".cjs"].join(""));
say("the parent of the child is this module", child.parent === module);
say("module.require is require", module.require === require);
say("by module.require", module.require(["./other", ".cjs"].join("")).parent === module);
say(
  "children",
  module.children.map(each => base(each.filename)),
);
say("resolve", base(require.resolve(["./other", ".cjs"].join(""))));
say("what require has", [
  typeof require.resolve,
  typeof require.cache,
  typeof require.extensions,
  require.main === module,
]);
