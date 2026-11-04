// A parameter that is a list whose `[` starts a line and whose `]` ends one, as no comma follows it, is given null or undefined: the error is at that `[`, and the message quotes the list.
// Todo: the executable quotes nothing: it reports the list at its `[` as plain Bun does, and the engine takes a place at a `[` for a list only where `=`, `:`, `,`, `)`, `}`, `]` or `of` follows its `]` in the same line

function show(name, run) {
  try {
    run();
    console.log(name, "| nothing is thrown");
  } catch (error) {
    const frame = error.stack.split("\n").find(line => /^\s+at /.test(line));
    console.log(name, "|", error.name + ": " + JSON.stringify(error.message), "|", /:(\d+:\d+)\)?$/.exec(frame)[1]);
  }
}
const holder = { nothing: undefined };
// prettier-ignore
{
show("the only parameter of a function", () => {
  function take(
    [x]
  ) {}
  take(holder.nothing);
});
show("the last parameter of a function", () => {
  function take(
    first,
    [x]
  ) {}
  take(1, null);
});
show("the only parameter of an arrow function", () => {
  ((
    [x]
  ) => x)(holder.nothing);
});
show("the only parameter of a method", () => {
  class Taker {
    take(
      [x]
    ) {}
  }
  new Taker().take(null);
});
}
