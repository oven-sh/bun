// A closure made inside a `try` reads the parameter of the `catch` around it, which the same `try` stores behind a test for null.
const say = (...all) => console.log(...all);
let fuse = 0;
function step(value) {
  if (--fuse === 0) throw new Error("fuse at " + value);
  return value;
}
function work() {
  let f0 = 0,
    f1 = 0;
  try {
    throw "b0";
  } catch (b) {
    let peek = () => "none yet";
    try {
      f0 = step(1);
      if (b == null) b = step("b8");
      peek = () => b;
      f1 = step(1);
      if (b == null) b = step("b9");
    } catch (e) {
      say("caught", e.message, b, f0 + f1, peek());
    }
    say("after", b, f0 + f1, peek());
  }
}
for (const k of [0, 1, 2, 3, 4, 5, 6, 12, 22, 23]) {
  fuse = k;
  say("fuse", k);
  try {
    work();
  } catch (e) {
    say("escaped", e.message);
  }
}
