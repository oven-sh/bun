// A list that `const`, `let` or the head of a loop declares, whose `[` starts a line and whose `]` ends one in front of the `=` or the `of`, is given null or undefined: the error is at that `[`, and the message quotes the list.
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
show("a list that const declares", () => {
  const
    [x]
      = holder.nothing;
});
show("a list that let declares", () => {
  let
    [x]
      = null;
});
show("a list of two names", () => {
  const
    [x, y]
      = holder.nothing;
});
show("a list that the head of a loop over lists declares", () => {
  for (const
    [x]
    of [null]) {}
});
show("a list that the head of a loop declares and fills", () => {
  for (let
    [x]
    = holder.nothing; ;) {}
});
}
