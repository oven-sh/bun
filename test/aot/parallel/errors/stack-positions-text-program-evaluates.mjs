// `new Function` and an indirect eval run texts that the program writes out. Each text throws or calls a function that throws. Each row prints the frames down to `show`, with the folders taken out of their places.
const framesOf = error => {
  const frames = error.stack
    .split("\n")
    .filter(line => line.startsWith("    at "))
    .map(line => line.trim().replace(/(file:\/\/)?[^\s()]*[\\/]/, "$1"));
  return frames.slice(0, frames.findIndex(frame => frame.startsWith("at show ")) + 1).join(" | ");
};
function thrower(n) {
  throw new Error("thrown with " + n);
}
globalThis.thrower = thrower;
function show(label, run, ...rest) {
  try {
    const result = run(thrower, ...rest);
    console.log(label + ": returned", result);
  } catch (error) {
    console.log(label + ":", error.name, "|", framesOf(error));
  }
}

show("call", new Function("thrower", "n", "const result = thrower(n); return result;"), 1);
show("method", new Function("thrower", "n", "const o = { thrower }; const result = o.thrower(n); return result;"), 1);
show("call in a list", new Function("thrower", "n", "const result = [thrower(n), 1]; return result;"), 1);
show("new", new Function("thrower", "n", "const result = new thrower(n); return result;"), 1);
show("throw", new Function("thrower", "n", "const e = 1;   throw new Error('here');"), 1);
show("member of null", new Function("thrower", "n", "const o = null; return   o.x.y;"), 1);
show("method that is missing", new Function("thrower", "n", "const o = {}; return   o.x();"), 1);
show(
  "function in evaluated text",
  (t, n) => (0, eval)("(function inner(thrower, n) { const result = thrower(n); return result; })")(t, n),
  1,
);
show("tagged template", new Function("thrower", "n", "const result = thrower`a`; return result;"), 1);
show("tagged template behind a space", new Function("thrower", "n", "const result = thrower  `a`; return result;"), 1);
show("optional call", new Function("thrower", "n", "const result = thrower?.(n); return result;"), 1);
show("spread", new Function("thrower", "n", "const result = thrower(...[n]); return result;"), 1);

show("callee in parentheses", new Function("thrower", "n", "const result = (thrower)(n); return result;"), 1);
show(
  "comment behind the callee",
  new Function("thrower", "n", "const result = thrower /* c */ (n); return result;"),
  1,
);
show(
  "method on the next line",
  new Function("thrower", "n", "const o = { thrower }; const result = o\n  .thrower(n); return result;"),
  1,
);
show("member of null on the next line", new Function("thrower", "n", "const o = null; return o\n  .x;"), 1);
show("element of null", new Function("thrower", "n", "const o = null; return o [0];"), 1);
show("member behind a chain", new Function("thrower", "n", "const o = {}; return o?.x.y;"), 1);
show("member behind an element in a chain", new Function("thrower", "n", "const o = {}; return o ?. [0].y;"), 1);
show("new without arguments", new Function("thrower", "n", "const result =  new thrower; return result;"), 1);
show(
  "new of a callee in parentheses",
  new Function("thrower", "n", "const result = new (thrower)(n); return result;"),
  1,
);
show("name that is missing", new Function("thrower", "n", "return  missing;"), 1);
show("name read before its declaration", new Function("thrower", "n", "const early =  late; let late = 1;"), 1);
show("store to a member of null", new Function("thrower", "n", "const o = null;  o.x = 1;"), 1);
show("list pattern", new Function("thrower", "n", "const [a] =  n;"), 1);
show("loop over a number", new Function("thrower", "n", "for (const a of  n) { }"), 1);
show("number that is called", new Function("thrower", "n", "return  n();"), 1);
show("in", new Function("thrower", "n", "return  n in  n;"), 1);
show("instanceof", new Function("thrower", "n", "return  n instanceof  n;"), 1);
show("default of a parameter", new Function("thrower", "n =  thrower(2)", "return n;"));
show("call of a result", new Function("thrower", "n", "const result = (() => thrower)()(n); return result;"), 1);
show("call of an element", new Function("thrower", "n", "const result = [thrower][0](n); return result;"), 1);
show(
  "letters outside ASCII",
  new Function("thrower", "n", "const é = 'é'; const result = thrower(é); return result;"),
  1,
);
show("evaluated call", () => {
  const result = (0, eval)("  thrower(1)");
  return result;
});
show("evaluated call on the second line", () => {
  const result = (0, eval)("\n  thrower(1)");
  return result;
});
show("evaluated member of null", () => {
  const result = (0, eval)("null.x");
  return result;
});
