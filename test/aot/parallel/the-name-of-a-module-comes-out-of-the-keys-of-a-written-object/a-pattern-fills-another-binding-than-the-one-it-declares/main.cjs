const other = process.argv[9] || "./other.cjs";
if (process.argv[10]) require("./other.cjs");
const caught = { entry: { path: "./first.cjs" } };
try {
  throw 0;
} catch (entry) {
  var { entry } = caught;
  entry.path = other;
}
const copied = { part: { path: "./first.cjs" } };
function change({ part }, more = typeof part) {
  var part;
  part.path = other;
  return more;
}
console.log("SAID", typeof entry, change(copied), require(caught.entry.path), require(copied.part.path));
