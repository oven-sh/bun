// Functions that end in `return callee(..)` are constructed by Reflect.construct and by nothing else. Each row prints the names and the places of the frames.
const frames = error =>
  String(error.stack)
    .split("\n")
    .slice(1, 5)
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
  throw new TypeError("thrown " + value);
}
function handsOn(value) {
  return fail(value);
}
function withNewTarget(value) {
  return fail(value);
}
function kept(value) {
  return fail(value);
}
function returned(value) {
  return fail(value);
}
function chooses(value) {
  return value ? fail(value) : fail(0);
}
function logical(value) {
  return value && fail(value);
}
function comma(value) {
  return (value, fail(value));
}
function nullish(value) {
  return null ?? fail(value);
}
function stores(value) {
  this.value = value;
  return fail(value);
}
function chain(value) {
  return middle(value);
}
function middle(value) {
  return fail(value);
}
function byBoth(value) {
  return fail(value);
}
function notWritten(value) {
  return fail(value);
}
function first(value) {
  return fail(value);
}
function second(value) {
  return fail(value);
}
function other() {}
attempt("hands on", () => {
  Reflect.construct(handsOn, [1]);
});
attempt("a function expression", () => {
  Reflect.construct(function made() {
    return fail(1);
  }, []);
});
attempt("with another new.target", () => {
  Reflect.construct(withNewTarget, [1], other);
});
attempt("kept", () => {
  const made = Reflect.construct(kept, [1]);
  return made;
});
attempt("returned", () => Reflect.construct(returned, [1]));
attempt("chooses", () => {
  Reflect.construct(chooses, [1]);
});
attempt("chooses the other", () => {
  Reflect.construct(chooses, [0]);
});
attempt("logical", () => {
  Reflect.construct(logical, [1]);
});
attempt("comma", () => {
  Reflect.construct(comma, [1]);
});
attempt("nullish", () => {
  Reflect.construct(nullish, [1]);
});
attempt("stores", () => {
  Reflect.construct(stores, [1]);
});
attempt("the callee hands on too", () => {
  Reflect.construct(chain, [1]);
});
attempt("by new too", () => {
  new byBoth(1);
});
attempt("by new too, by Reflect.construct", () => {
  Reflect.construct(byBoth, [1]);
});
attempt("not written as a call of it", () => {
  const construct = Reflect.construct;
  construct(notWritten, [1]);
});
for (const picked of [first, second])
  attempt("picked " + picked.name, () => {
    Reflect.construct(picked, [1]);
  });
for (let round = 0; round < 3; round++)
  attempt("in a loop", () => {
    Reflect.construct(handsOn, [round]);
  });
function one() {
  return two();
}
function two() {
  return 1;
}
function three() {
  return four();
}
function four() {
  return { four: 4 };
}
console.log(
  typeof Reflect.construct(one, []),
  Reflect.construct(one, []) instanceof one,
  JSON.stringify(Reflect.construct(three, [])),
);
