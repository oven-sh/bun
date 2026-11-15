// A renamed function object takes more arguments than fit in registers, is called by value and leaves by a tail call into a sibling that passes arguments on the stack.
// A stack captured before the tail call names the frame after the function object that was called, not after the sibling that the last iteration left into.
const names = stack =>
  stack
    .split("\n")
    .slice(1, 3)
    .map(line =>
      line
        .trim()
        .replace(/ ?\(.*\)$/, "")
        .replace(/^at /, "")
        .replace(/^.*\.mjs:.*$/, "module"),
    )
    .join(" < ");
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
const turns = handedBack(3);
let before = "";
let last = "";
let watched = false;

const makers = {
  "four parameters": () =>
    function four(next, a, b, c) {
      if (next && watched) before = new Error("x").stack;
      if (next) return next(null, a, b, c);
      last = new Error("x").stack;
      return 0;
    },
  "five parameters": () =>
    function five(next, a, b, c, d) {
      if (next && watched) before = new Error("x").stack;
      if (next) return next(null, a, b, c, d);
      last = new Error("x").stack;
      return 0;
    },
  "eight parameters": () =>
    function eight(next, a, b, c, d, e, f, g) {
      if (next && watched) before = new Error("x").stack;
      if (next) return next(null, a, b, c, d, e, f, g);
      last = new Error("x").stack;
      return 0;
    },
  "eight parameters, one passed on": () =>
    function passesOne(next, a, b, c, d, e, f, g) {
      if (next && watched) before = new Error("x" + a + b + c + d + e + f + g).stack;
      if (next) return next(null);
      last = new Error("x").stack;
      return 0;
    },
  "eight parameters, six passed on": () =>
    function passesSix(next, a, b, c, d, e, f, g) {
      if (next && watched) before = new Error("x" + f + g).stack;
      if (next) return next(null, a, b, c, d, e);
      last = new Error("x").stack;
      return 0;
    },
  "eight parameters, twelve passed on": () =>
    function passesTwelve(next, a, b, c, d, e, f, g) {
      if (next && watched) before = new Error("x").stack;
      if (next) return next(null, a, b, c, d, e, f, g, a, b, c, d);
      last = new Error("x").stack;
      return 0;
    },
};

for (const [label, make] of Object.entries(makers)) {
  const renamed = make(),
    plain = make();
  renamed.displayName = "renamed";
  const renamedUnknown = handedBack(renamed),
    plainUnknown = handedBack(plain);
  for (const [first, second] of [
    [renamedUnknown, plainUnknown],
    [plainUnknown, renamedUnknown],
  ]) {
    for (let i = 0; i < turns; i++) {
      watched = i === turns - 1;
      first(second, 1, 2, 3, 4, 5, 6, i);
    }
    console.log(label, "|", names(before), "|", names(last));
  }
}
