// What stands in the place of the list is asked about a file at every `require` of it that returns, not only at the first. Where its `push` throws, the call throws, and the next call asks again.
// Entry points: ./child.cjs
const seen = [];
let throws = false;
module.children = {
  indexOf(child) {
    seen.push("indexOf " + child.exports.name);
    return -1;
  },
  push(child) {
    seen.push("push " + child.exports.name);
    if (throws) throw new RangeError("from push");
  },
};
function load(name) {
  try {
    return typeof (name === "child" ? require("./child.cjs") : require("./other.cjs"));
  } catch (error) {
    return error.name + ": " + error.message;
  }
}
for (const name of ["child", "child", "other", "child"]) seen.push(load(name));
throws = true;
for (const name of ["child", "other", "other"]) seen.push(load(name));
throws = false;
seen.push(load("child"), typeof require("./other.cjs"));
const computed = ["./chi", "ld.cjs"].join("");
seen.push(typeof require(computed), typeof require(computed));
console.log(seen.join("\n"));
