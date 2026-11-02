// Callbacks that left sight are called from the event loop. The stacks are taken before the callbacks get their first names.
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
const give = new Function("f", "name", "f.displayName = name;" + never);
const names = (error, count = 3) =>
  error.stack
    .split("\n")
    .slice(1, 1 + count)
    .map(line => line.trim().replace(/^at /, "").replace(/ ?\(.*\)$/, ""))
    .join(" < ");
const kept = [];

function make() {
  return handedBack(function callback(value) {
    kept.push(new Error(String(value)));
  });
}
const a = make(), b = make(), c = make(), d = make();
setTimeout(a, 0);
Promise.resolve(1).then(b);
queueMicrotask(c);
process.nextTick(d);
await new Promise(resolve => setTimeout(resolve, 20));
console.log(kept.length);
const lines = () => kept.map(error => names(error, 1)).sort().join(" . ");
give(a, "a"); give(b, "b"); give(c, "c"); give(d, "d");
console.log(lines());
