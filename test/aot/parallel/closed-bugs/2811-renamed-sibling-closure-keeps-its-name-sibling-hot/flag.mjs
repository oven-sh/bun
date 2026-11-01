// Flags: --aot-heat=everything-is-hot
// Under --aot-heat=everything-is-hot: the third answer must be the first again.
const names = (stack, count) => stack.split("\n").slice(1, 1 + count).map(line => line.trim().replace(/ ?\(.*\)$/, "").replace(/^at /, "")).join(" < ");
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
const rename = (f, name) => void (handedBack(f).displayName = name);
function makeFamily() {
  function leaf() { return new Error("x").stack; }
  function middle() { return leaf() + ""; }
  function top() { return names(middle(), 3); }
  return { leaf, middle, top };
}
const f1 = makeFamily(), f2 = makeFamily();
rename(f1.leaf, "renamedLeaf");
rename(f2.middle, "renamedMiddle");
console.log(f1.top(), "|", f2.top(), "|", f1.top());
