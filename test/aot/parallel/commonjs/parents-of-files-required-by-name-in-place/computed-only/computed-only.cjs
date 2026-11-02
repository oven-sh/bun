const base = key => require("node:path").basename(key);
const say = (what, value) => console.log(what, JSON.stringify(value));
const names = ["./child", "./other"].map(name => name + ".cjs");
const [child, other] = names.map(name => require(name));
say("parents", [child.parent === module, other.parent === module]);
say(
  "children",
  module.children.map(each => base(each.filename)),
);
