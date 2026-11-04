// `for (const [] of null)` with a list in its head whose `[` stands on a later line than the last token in front of it that the source map knows, and with nothing that the map knows between that `[` and the `of`: the error is at that `[`, and the message quotes the head of the loop as Bun prints it.
// Todo: the executable quotes the list alone, or nothing: it reports the loop at the `[` as plain Bun does, and the engine takes a place at a `[` for the list itself

function show(name, run) {
  try {
    run();
    console.log(name, "| nothing is thrown");
  } catch (error) {
    // The message may take several lines.
    const frame = error.stack.split("\n").find(line => /^\s+at /.test(line));
    console.log(name, "|", error.name + ": " + JSON.stringify(error.message), "|", /:(\d+:\d+)\)?$/.exec(frame)[1]);
  }
}
// prettier-ignore
{
show("an empty list", () => {
  for (const
    [] of null) {}
});
show("a list with a hole", () => {
  for (const
    [,] of null) {}
});
show("an empty list behind let", () => {
  for (let
    [] of null) {}
});
show("an empty list in a list", () => {
  for (const [
    [],
  ] of null) {}
});
show("an empty list behind a name", () => {
  for (const [
    a,
    [],
  ] of null) {}
});
show("an empty list behind a hole", () => {
  for (const [
    ,
    [],
  ] of null) {}
});
show("an empty list that takes the rest", () => {
  for (const [
    ...[]
  ] of null) {}
});
show("an empty list above the of", () => {
  for (const
    []
    of null) {}
});
}
