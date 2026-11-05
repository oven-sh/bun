// A closure that was given a displayName is called by its sibling, and every call is inlined. Each stack names it as given, the later ones too.
// Flags: --aot-heat=everything-is-hot
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
const f1 = makeFamily(), f2 = makeFamily(), f3 = makeFamily();
rename(f1.leaf, "renamedLeaf");
rename(f2.middle, "renamedMiddle");
rename(f3.leaf, "thirdLeaf");
rename(f3.middle, "thirdMiddle");
console.log(f1.top(), "|", f2.top(), "|", f1.top());
console.log(f1.top(), "|", f1.top());
console.log(f3.top(), "|", f3.top());
