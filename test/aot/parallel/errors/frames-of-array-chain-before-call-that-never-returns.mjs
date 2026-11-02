// A callback of a chain of array methods throws, and the chain stands in a block that ends in a call of a function that always throws. The stack lists the method that called the callback.
const frames = e =>
  String(e && e.stack)
    .split("\n")
    .slice(1, 6)
    .map(l =>
      l
        .trim()
        .replace(/^at /, "")
        .replace(/\(?[^ (]*[\\/]/, "("),
    )
    .join(" < ");
let count = 0,
  limit = 0;
function take(x) {
  if (++count > limit) throw new Error("x");
  return true;
}
const keep = x => x;
function fail(n) {
  throw new Error("n" + n);
}
function failDeep(n) {
  fail(n + 1);
}
function wholeBody(list) {
  const n = list.map(keep).filter(take).length;
  fail(n);
}
function wholeBodyDeep(list) {
  const n = list.map(keep).filter(take).length;
  failDeep(n);
}
function made() {
  const n = Array.from({ length: 3 }, (_, i) => i + 1)
    .map(keep)
    .filter(take).length;
  fail(n);
}
function inArm(list) {
  if (list.length > 2) {
    const n = list.map(keep).filter(take).length;
    fail(n);
  }
  return 0;
}
function inArmDeep(list) {
  if (list.length > 2) {
    const n = list.filter(take).map(keep).length;
    failDeep(n);
  }
  return 0;
}
function asArgument(list) {
  if (list.length > 2) fail(list.map(keep).filter(take).length);
}
function some(list) {
  if (list.length > 2) fail(list.map(keep).some(x => !take(x)));
}
for (const run of [wholeBody, wholeBodyDeep, made, inArm, inArmDeep, asArgument, some]) {
  for (limit = 0; limit < 5; limit++) {
    count = 0;
    try {
      run([1, 2, 3]);
      console.log(run.name, limit, "did not throw");
    } catch (e) {
      console.log(run.name, limit, frames(e));
    }
  }
}
