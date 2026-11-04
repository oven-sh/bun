// The same program as stack-positions-of-tags-with-text-that-is-not-ascii.mjs with the text of each template in ASCII. Bun's transpiler prints these tagged templates as they are written, and a stack trace names the same places.

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
const inThisFile = /stack-positions-of-tags-with-text-in-ascii/;
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
    `e`;
});
show("a tag that is a member", () => {
  holder.fail
    `e`;
});
show("a tag that is a member on its own line", () => {
  holder
    .fail
    `e`;
});
show("a tag that is a member of what a call returns", () => {
  holder.self()
    .fail
    `e`;
});
show("a tag that is an element", () => {
  holder[key()]
    `e`;
});
show("a tag that is a call", () => {
  getFail(
    1,
  )
    `e`;
});
show("a tag that is a call, on the line of the backquote", () => {
  getFail(
    1,
  )`e`;
});
show("a tag that a constant holds and one line reads", () => {
  const tag = getFail(
    1,
  );
  tag
    `e`;
});
show("a tag that is a function", () => {
  (function () {
    fail();
  })
    `e`;
});
show("a tag that is an arrow function", () => {
  (() => {
    fail();
  })
    `e`;
});
show("a tag behind a comma", () => {
  (0, holder.fail)
    `e`;
});
show("a tag with a value on the next line", () => {
  getFail(
    1,
  )
    `e${
      2}`;
});
show("a tag whose text stands behind a value", () => {
  getFail(
    1,
  )
    `${2}e`;
});
show("a tag whose text ends on a second line", () => {
  getFail(
    1,
  )
    `text
    e`;
});
show("a tag that is a member of a built-in object", () => {
  String.raw
    `e${
      Symbol()}`;
});
show("a tag in a value of a tag", () => {
  getQuiet(
    1,
  )
    `e${
      getFail(
        2,
      )
        `u`}`;
});
}
