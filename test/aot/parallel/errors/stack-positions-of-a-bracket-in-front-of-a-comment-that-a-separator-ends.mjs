// Prints where an error at a member is reported whose `[` starts a line in front of a comment that a line separator or a paragraph separator ends, with the key behind it: such a character ends a line as a line feed does. The frame is at that `[`, which the source map has where Bun's parser read it.

function quiet() {}
const holder = {
  self() {
    return this;
  },
};
const use = (...values) => values.length;
const key = () => "getter";
const inThisFile = /stack-positions-of-a-bracket-in-front-of-a-comment-that-a-separator-ends/;
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
show("an element behind a comment that a line separator ends, behind a bracket that starts a line", () => {
  use(
    quiet()
      [ // a comment key()],
  );
});
show("an element behind a comment that a paragraph separator ends, behind a bracket that starts a line", () => {
  use(
    quiet()
      [ // a comment key()],
  );
});
show("a store to an element behind a comment that a line separator ends, behind a bracket that starts a line", () => {
  quiet()
    [ // a comment key()] = 1;
});
}
