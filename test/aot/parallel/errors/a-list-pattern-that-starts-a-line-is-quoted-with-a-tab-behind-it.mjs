// A list that takes values whose `[` starts a line, with a tab between its `]` and what follows it in that line, is given null or undefined: the error is at that `[`, and the message quotes the list.
// Todo: the executable quotes nothing: it reports the list at its `[` as plain Bun does, and the engine skips nothing but spaces behind the `]` of a list at its place

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
    [x]	= holder.nothing;
});
show("a parameter", () => {
  function take(
    [x]	,
  ) {}
  take(holder.nothing);
});
show("a list in a list", () => {
  const [
    [x]	,
  ] = [null];
});
show("a list in the head of a loop", () => {
  for (const
    [x]	of [null]) {}
});
}
