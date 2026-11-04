// A list that takes values whose `[` starts a line, with a comment between its `]` and what follows it in that line, is given null or undefined: the error is at that `[`, and the message quotes the list.
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
    [x] /* the first */ = holder.nothing;
});
show("a list that let declares", () => {
  let
    [x] /* the first */ = null;
});
show("a list of two names", () => {
  const
    [x, y] /* a pair */ = holder.nothing;
});
show("a parameter", () => {
  function take(
    [x] /* the first */,
  ) {}
  take(holder.nothing);
});
show("a list in a list", () => {
  const [
    [x] /* the first */,
  ] = [null];
});
}
