const base = key => require("node:path").basename(key);
const say = (what, value) => console.log(what, JSON.stringify(value));
const name = ["./child", ".cjs"].join("");
const child = require(name);
require("./child.cjs");
say("the parent of the child is this module", child.parent === module);
say(
  "children",
  module.children.map(each => base(each.filename)),
);
say("it is the main one", require.main === module);
