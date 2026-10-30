const base = key => require("node:path").basename(key);
const say = (what, value) => console.log(what, JSON.stringify(value));
const middle = require(["./middle", ".cjs"].join(""));
say("the parent of the middle one is this module", middle.parent === module);
say("the parent of the child is the middle one", middle.child.parent === middle.own);
say("children", [
  module.children.map(each => base(each.filename)),
  middle.own.children.map(each => base(each.filename)),
]);
