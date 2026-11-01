// Function objects are handed, in a loop that runs often, to functions that came back out of code made at run time: one only calls what it is handed, one gives it a displayName first, one looks at its name, one keeps it. Each frame shows the name of its function object.
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
function nameInFrame() {
  return new Error("x").stack.split("\n")[2].trim().split(" ")[1];
}
const keptOnes = [];
const collects = { now: false };
function calls(callback, x) {
  return callback(x);
}
function displays(callback, x) {
  callback.displayName = "displayed" + (x & 1);
  return callback(x);
}
function defines(callback, x) {
  Object.defineProperty(callback, "displayName", { value: "defined" + (x & 1) });
  return callback(x);
}
function looks(callback, x) {
  return callback.name + callback.length + (callback.displayName ?? "") + callback(x);
}
function keeps(callback, x) {
  keptOnes.push(callback);
  return callback(x);
}
const callees = [calls, displays, defines, looks, keeps].map(callee => handedBack(callee));
function hand(callee, base, x) {
  return callee(function handed(y) {
    if (y === 3 && collects.now) Bun.gc(true);
    return nameInFrame() + (base + y);
  }, x);
}
const seen = new Set();
function rounds() {
  for (let i = 0; i < 4_000; i++) {
    collects.now = i % 200 < callees.length * 4;
    seen.add((i % callees.length) + ":" + hand(callees[i % callees.length], i & 1, i & 3));
  }
}
rounds();
console.log([...seen].sort().join(" "));
console.log(keptOnes.length, new Set(keptOnes.map(kept => kept(1))).size);
for (const kept of keptOnes.slice(0, 4)) handedBack(kept).displayName = "kept";
console.log([...new Set(keptOnes.map(kept => kept(1)))].sort().join(" "));
seen.clear();
rounds();
console.log([...seen].sort().join(" "));
