// Prints where the call of a tag is reported whose template starts a line and holds text that is not ASCII. Bun's transpiler prints such a tagged template as a call of the tag, so that `strings.raw` holds the text as it is written. A stack trace names the backquote, as it does where the text is ASCII, and the tag where that is printed as a name.

function fail() {
  throw new Error("fail");
}
function quiet() {}
function getFail() {
  return fail;
}
function getQuiet() {
  return quiet;
}
const holder = {
  fail,
  self() {
    return this;
  },
};
const key = () => "fail";
const inThisFile = /stack-positions-of-tags-with-text-that-is-not-ascii/;
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
show("a tag that is a name", () => {
  fail
    `é`;
});
show("a tag that is a member", () => {
  holder.fail
    `é`;
});
show("a tag that is a member on its own line", () => {
  holder
    .fail
    `é`;
});
show("a tag that is a member of what a call returns", () => {
  holder.self()
    .fail
    `é`;
});
show("a tag that is an element", () => {
  holder[key()]
    `é`;
});
show("a tag that is a call", () => {
  getFail(
    1,
  )
    `é`;
});
show("a tag that is a call, on the line of the backquote", () => {
  getFail(
    1,
  )`é`;
});
show("a tag that a constant holds and one line reads", () => {
  const tag = getFail(
    1,
  );
  tag
    `é`;
});
show("a tag that is a function", () => {
  (function () {
    fail();
  })
    `é`;
});
show("a tag that is an arrow function", () => {
  (() => {
    fail();
  })
    `é`;
});
show("a tag behind a comma", () => {
  (0, holder.fail)
    `é`;
});
show("a tag with a value on the next line", () => {
  getFail(
    1,
  )
    `é${
      2}`;
});
show("a tag whose text stands behind a value", () => {
  getFail(
    1,
  )
    `${2}é`;
});
show("a tag whose text ends on a second line", () => {
  getFail(
    1,
  )
    `text
    é`;
});
show("a tag that is a member of a built-in object", () => {
  String.raw
    `é${
      Symbol()}`;
});
show("a tag in a value of a tag", () => {
  getQuiet(
    1,
  )
    `é${
      getFail(
        2,
      )
        `ü`}`;
});
}
