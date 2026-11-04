// Prints where an error at a member is reported whose `[` stands behind two slashes that start no comment, with the key on a line below: the slashes are the end of a comment over several lines, or stand in a template or in a text that goes on over several lines. The frame is at that `[`, which the source map has where Bun's parser read it, on another line than what is mapped in front of it.

function fail() {
  throw new Error("fail");
}
function quiet() {}
const badKey = {
  toString() {
    return fail();
  },
};
const bad = () => badKey;
const use = (...values) => values.length;
const key = () => "getter";
const inThisFile = /stack-positions-of-a-bracket-behind-two-slashes/;
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
show("an element of a call in parentheses, behind a comment whose last line holds two slashes", () => {
  use(
    (quiet() /* see
      http://x */)[
      key()
    ],
  );
});
show("an element behind a comment whose last line holds two slashes", () => {
  use(
    quiet()
      /* see
         http://x/ */ [
      key()
    ],
  );
});
show("an element behind a comment of one line that holds two slashes", () => {
  use(
    quiet()
      /* see http://x/ */ [
      key()
    ],
  );
});
show("an element of what a tag returns, behind a template whose last line begins with two slashes", () => {
  use(
    quiet`
      // not a comment`[
      key()
    ],
  );
});
show("an element of a template whose last line holds two slashes", () => {
  use(
    `
    http://x/`[
      bad()
    ],
  );
});
show("an element of a template over two lines without slashes", () => {
  use(
    `
    x`[
      bad()
    ],
  );
});
show("an element of a text that goes on in a line that begins with two slashes", () => {
  use(
    "abc\
//def"[
      bad()
    ],
  );
});
}
