// Prints where an error at a member is reported whose `[` or `?.[` starts a line in front of a comment that holds `/*`, or of one whose last line begins with `//`, with the key behind the comment: at that `[`, which the source map has where Bun's parser read it. stack-positions-of-tokens-that-start-a-line.mjs has such a `[` in front of a comment that holds neither.

function fail() {
  throw new Error("fail");
}
function quiet() {}
const holder = {
  self() {
    return this;
  },
  get getter() {
    return fail();
  },
};
const use = (...values) => values.length;
const key = () => "getter";
const inThisFile = /stack-positions-of-a-bracket-that-starts-a-line/;
function show(label, run) {
  try {
    run();
    console.log(label, "| nothing is thrown");
  } catch (error) {
    const lines = String(error.stack)
      .split("\n")
      .filter(line => inThisFile.test(line));
    console.log(label, "|", error.name, "|", lines.map(line => /:(\d+:\d+)\)?$/.exec(line)[1]).join(" "));
  }
}
// prettier-ignore
{
show("an element behind a comment that holds the start of a comment, behind a bracket that starts a line", () => {
  use(
    quiet()
      [ /* a /* b */ key()],
  );
});
show("an element below a comment whose last line begins with two slashes, behind a bracket that starts a line", () => {
  use(
    quiet()
      [ /* a
        // b */
        key()],
  );
});
show("an element behind a call, ?.[ and a comment that holds the start of a comment", () => {
  use(
    holder.self()
      ?.[ /* a /* b */ key()],
  );
});
show("a store to an element behind a comment that holds the start of a comment, behind a bracket that starts a line", () => {
  quiet()
    [ /* a /* b */ key()] = 1;
});
}
