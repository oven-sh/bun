// Each line: where the frames stand when a pattern takes a constant apart that holds undefined or null.
const nothing = undefined;
const voided = void 0;
const none = null;
const five = 5;
function step() {}
function attempt(label, run) {
  try {
    run();
    console.log(label, "| no error");
  } catch (error) {
    const frames = String(error.stack).split("\n").slice(1, 3);
    console.log(
      label,
      "|",
      String(error.message).replace(/ \(evaluating .*$/, ""),
      "|",
      frames.map(line => line.trim().replace(/\(?[^ (]*[\\/]([^\\/ ]+:\d+:\d+)\)?/, "$1")).join(" < "),
    );
  }
}
attempt("object pattern", () => {
  const { a } = nothing;
});
attempt("object pattern over void 0", () => {
  const { a } = voided;
});
attempt("object pattern over null", () => {
  const { a } = none;
});
attempt("behind a call", () => {
  step();
  const { a } = nothing;
});
attempt("list pattern", () => {
  const [a] = nothing;
});
attempt("list pattern over null", () => {
  const [a] = none;
});
attempt("assignment", () => {
  let a;
  ({ a } = nothing);
});
attempt("assignment to a list", () => {
  let a;
  [a] = nothing;
});
attempt("empty pattern", () => {
  const {} = nothing;
});
attempt("nested", () => {
  const {
    a: { b },
  } = { a: nothing };
});
attempt("default", () => {
  const { a: { b } = nothing } = {};
});
attempt("parameter", () => {
  (({ a }) => a)(nothing);
});
attempt("rest", () => {
  const { ...rest } = nothing;
});
attempt("computed key", () => {
  const { [five]: a } = nothing;
});
attempt("in a loop", () => {
  for (const { a } of [nothing]) step(a);
});
attempt("a number", () => {
  const { a } = five;
  return a.b;
});
attempt("function", function () {
  const { a } = nothing;
});
attempt("typeof", () => {
  typeof nothing;
  const { a } = nothing;
});
