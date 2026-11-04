// `catch` with a list whose `[` starts a line and whose `]` ends one, where null or undefined is thrown: the error is at that `[`, and the message quotes the list.
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
show("undefined is thrown", () => {
  try {
    throw holder.nothing;
  } catch (
    [x]
  ) {}
});
show("null is thrown", () => {
  try {
    throw null;
  } catch (
    [x]
  ) {}
});
show("a list of two names", () => {
  try {
    throw holder.nothing;
  } catch (
    [x, y]
  ) {}
});
}
