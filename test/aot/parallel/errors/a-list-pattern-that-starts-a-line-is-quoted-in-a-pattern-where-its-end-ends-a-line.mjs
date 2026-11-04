// A list in a list or in an object that takes values, whose `[` starts a line and whose `]` ends one, as no comma follows it, is given null or undefined: the error is at that `[`, and the message quotes the list.
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
show("the only element of a list", () => {
  const [
    [x]
  ] = [holder.nothing];
});
show("the last element of a list", () => {
  const [
    first,
    [x]
  ] = [1, null];
});
show("the value of a property", () => {
  const { a:
    [x]
  } = { a: holder.nothing };
});
show("the only element of a list that is a parameter", () => {
  function take([
    [x]
  ]) {}
  take([null]);
});
}
