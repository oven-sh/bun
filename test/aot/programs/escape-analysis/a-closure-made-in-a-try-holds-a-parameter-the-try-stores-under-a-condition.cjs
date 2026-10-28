// A closure made inside a `try` reads a parameter, which the same `try` stores only under a condition.
const say = (...all) => console.log(...all);
let fuse = 0;
function step(value) {
  if (--fuse === 0) throw new Error("fuse at " + value);
  return value;
}
function work(b) {
  let f0 = 0,
    f1 = 0;
  {
    let peek = () => "none yet";
    try {
      f0 = step(1);
      b ??= step("b8");
      peek = () => b;
      f1 = step(1);
      b ??= step("b9");
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
    work("b0");
  } catch (e) {
    say("escaped", e.message);
  }
}
