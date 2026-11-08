// Prints where errors are reported that come of using a constant which holds `undefined`: it is called, read, stored to, spread and tested. The constants are declared at the top of the file, at the top of a
// function and behind other statements, with `undefined` and with `void 0`.
const one = 1;
const nothing = undefined;
const voided = void 0;
const wrapped = /** @type {any} */ (undefined);
let changing = undefined;
function placeOf(error) {
  return error.stack
    .split("\n")[1]
    .trim()
    .replace(/\(?[^ ()]*[\/\\][\w-]+\.mjs:(\d+:\d+)\)?/, "$1");
}
function attempt(label, run) {
  try {
    console.log(label, "| no error", run());
  } catch (error) {
    console.log(label, "|", error.constructor.name, placeOf(error));
  }
}
attempt("called", () => {
  nothing();
});
attempt("read", () => {
  nothing.missing;
});
attempt("void called", () => {
  voided();
});
attempt("void read", () => {
  voided.missing;
});
attempt("in parentheses called", () => {
  wrapped();
});
attempt("stored", () => {
  nothing.missing = 1;
});
attempt("method called", () => {
  nothing.missing();
});
attempt("index read", () => {
  nothing[one];
});
attempt("spread", () => {
  [...nothing];
});
attempt("tagged", () => {
  nothing``;
});
attempt("constructed", () => {
  new nothing();
});
attempt("behind an optional read", () => {
  nothing?.a;
  nothing();
});
attempt("a let called", () => {
  changing();
});
attempt("in a condition", () => (nothing ? one.a.b : one.c.d));
attempt("behind ??", () => (nothing ?? one).a.b);
attempt("behind ||", () => (nothing || one).a.b);
attempt("as an argument", () => one.a(nothing).b);
attempt("in", () => "key" in nothing);
attempt("instanceof", () => ({}) instanceof nothing);
function declared() {
  nothing();
}
attempt("in a declaration", declared);
attempt("at the top of a function", () => {
  const inner = undefined;
  const other = 2;
  inner.a;
  return inner(other);
});
attempt("void at the top of a function", () => {
  const inner = void 0;
  const other = 2;
  inner.a;
  return inner(other);
});
attempt("behind a statement", () => {
  attempt.length;
  if (one > 5) return;
  const inner = undefined;
  if (one > 6) return;
  inner.a;
  return inner();
});
attempt("a local named undefined", () => {
  const undefined = one;
  const inner = undefined;
  if (one > 6) return;
  return inner.a.b;
});
try {
  nothing();
} catch (error) {
  console.log("at the top |", placeOf(error));
}
