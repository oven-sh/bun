"use strict";
// A control: in strict code the function stays in its block.
var uses = {
  one(found) {
    return found.name;
  },
  two(found) {
    return found.name;
  },
};
{
  function uses() {}
  uses.extra = found => found.name;
}
for (const name in uses) console.log("SAID", name, uses[name](require(`./${name}.cjs`)));
