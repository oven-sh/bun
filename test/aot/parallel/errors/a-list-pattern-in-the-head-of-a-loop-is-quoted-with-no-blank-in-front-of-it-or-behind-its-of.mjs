// A list in the head of a loop that stands right behind `const` or `let`, below the `for`, or that has `of` and what is looped over right behind its `]`, or whose `of` ends its line, is given null or undefined: the error is at that `[`, and the message quotes the list.
// Todo: the executable quotes nothing: it reports the list at its `[` as plain Bun does, and the engine takes a `[` right behind a name for the `[` of a member, and an `of` behind the list only with a blank behind it

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
show("a list right behind const in a loop over lists", () => {
  for
    (const[x] of [null]) {}
});
show("a list right behind let in a loop that fills it", () => {
  for
    (let[x] = holder.nothing; ;) {}
});
show("a list with of right behind it", () => {
  for (const
    [x]of[null]) {}
});
show("a list of two names with of right behind it", () => {
  for (const
    [x, y]of[holder.nothing]) {}
});
show("a list whose of ends its line", () => {
  for (const
    [x] of
    [null]) {}
});
}
