// A list that takes values and stands in its line behind nothing but tokens that the source map does not know (a hole, an empty object, the end of what began on a line above, the start of a head below its keyword), with a comment, a tab or the end of the line behind its `]`, is given null or undefined: the error is at that `[`, and the message quotes the list.
// Todo: the executable quotes nothing: it reports the list at its `[` as plain Bun does, and the engine takes a place at a `[` for a list only where `=`, `:`, `,`, `)`, `}`, `]` or `of` follows its `]` behind nothing but spaces in the same line

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
show("a comment behind a list behind a hole", () => {
  const [
    , [x] /* the second */
  ] = [1, holder.nothing];
});
show("a comment behind a list behind an empty object", () => {
  function take(
    {}, [x] /* the second */
  ) {}
  take({}, null);
});
show("a comment behind a list behind the end of a list", () => {
  function take([
    first
  ], [x] /* the second */) {}
  take([1], holder.nothing);
});
show("a comment behind a list behind the end of an object", () => {
  function take({
    first
  }, [x] /* the second */) {}
  take({}, holder.nothing);
});
show("a comment behind a list behind the end of a function", () => {
  const first = () => {
    return 1;
  }, [x] /* the second */ = holder.nothing;
});
show("a comment behind a list behind the end of a value in round brackets", () => {
  const first = (
    String(1)
  ), [x] /* the second */ = null;
});
show("a comment behind a list in the head of a loop below its for", () => {
  for
    (const [x] /* the first */ of [null]) {}
});
show("a comment behind a list in the head of a catch below its keyword", () => {
  try {
    throw holder.nothing;
  } catch
    ([x] /* the first */) {}
});
show("a tab behind a list behind the end of a list", () => {
  function take([
    first
  ], [x]	) {}
  take([1], null);
});
show("the end of the line behind a list behind the end of an object", () => {
  function take({
    first
  }, [x]
  ) {}
  take({}, holder.nothing);
});
show("a comment that ends the line behind a list behind the end of a function", () => {
  const first = () => {
    return 1;
  }, [x] // the second
    = holder.nothing;
});
}
