// Functions and classes are bound in several places, and what bind() made is called and constructed in many ways. Each line: names and places of the frames of an error that is thrown below.
const frames = error =>
  String(error.stack)
    .split("\n")
    .slice(1, 6)
    .map(line =>
      line
        .trim()
        .replace(/^at /, "")
        .replace(/\(?[^ (]*\.mjs:/, "(")
        .replace(/^\((\d+:\d+)$/, "($1)"),
    )
    .join(" < ");
function attempt(label, run) {
  try {
    run();
    console.log(label + ": nothing");
  } catch (error) {
    console.log(label + ": " + frames(error));
  }
}
function fail(value) {
  throw new TypeError("mine " + value);
}
function target(value) {
  fail(value);
  return 1;
}
function made(value) {
  this.value = fail(value);
}
function forwards(value) {
  return fail(value);
}
class Made {
  constructor(value) {
    fail(value);
  }
}
attempt("called", () => {
  target.bind(null)(1);
});
attempt("called with an argument", () => {
  target.bind(null, 1)();
});
attempt("constructed", () => {
  new (made.bind(null))(1);
});
attempt("constructed with an argument", () => {
  new (made.bind(null, 1))();
});
attempt("constructed by Reflect.construct", () => {
  Reflect.construct(made.bind(null), [1]);
});
attempt("constructed for another function", () => {
  Reflect.construct(made.bind(null), [1], target);
});
attempt("a class", () => {
  new (Made.bind(null))(1);
});
attempt("a class with an argument", () => {
  new (Made.bind(null, 1))();
});
attempt("bound twice", () => {
  new (made.bind(null).bind(null))(1);
});
attempt("ends in a call", () => {
  new (forwards.bind(null))(1);
});
attempt("ends in a call, by Reflect.construct", () => {
  Reflect.construct(forwards.bind(null), [1]);
});
const kept = made.bind(null);
attempt("kept", () => {
  new kept(1);
});
attempt("kept, spread", () => {
  new kept(...[1]);
});
attempt("a parent", () => {
  new (class extends kept {})(1);
});
for (const picked of [made.bind(null), Made.bind(null, 2), target.bind(null)])
  attempt("picked", () => {
    new picked(1);
  });
