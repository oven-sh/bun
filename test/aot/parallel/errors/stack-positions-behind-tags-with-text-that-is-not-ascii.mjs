// Prints where a member, a call and a tag are reported that stand behind a tagged template whose backquote starts a line and whose text is not ASCII. Bun's transpiler prints such a template as a call of the tag. What stands behind it is looked up behind the same places of the source map as where the text is ASCII: the backquote, and the tag where that is printed as a name. A call that takes such a template as its first argument is reported at its own `(`, which the source map finds from where the template starts.

function quiet() {}
function getQuiet() {
  return quiet;
}
function fail() {
  throw new Error("fail");
}
function getFail() {
  return fail;
}
const holder = {
  nothing: undefined,
  quiet,
  fail,
  self() {
    return this;
  },
};
const inThisFile = /stack-positions-behind-tags-with-text-that-is-not-ascii/;
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
show("a member behind a tag that is a name", () => {
  quiet
    `é`.member;
});
show("a member on its own line behind a tag that is a name", () => {
  quiet
    `é`
    .member;
});
show("a member behind a tag that is a member", () => {
  holder.quiet
    `é`.member;
});
show("a member on its own line behind a tag that is a member", () => {
  holder.quiet
    `é`
    .member;
});
show("a member behind a tag that is a call", () => {
  getQuiet(
    1,
  )
    `é`.member;
});
show("a member on its own line behind a tag that is a call", () => {
  getQuiet(
    1,
  )
    `é`
    .member;
});
show("a member behind a tag that is a name, all on one line", () => {
  quiet`é`.member;
});
show("a member behind a tag with a value", () => {
  getQuiet(
    1,
  )
    `é${
      2}`.member;
});
show("a member of undefined in a value of a tag", () => {
  quiet
    `é${
      holder.nothing
        .member}`;
});
show("a call behind a tag that is a name", () => {
  quiet
    `é`(1);
});
show("a call behind a tag that is a member", () => {
  holder.quiet
    `é`(1);
});
show("a call on its own line behind a tag that is a call", () => {
  getQuiet(
    1,
  )
    `é`
    (2);
});
show("a tag behind a tag that is a name", () => {
  quiet
    `é`
    `è`;
});
show("a tag behind a tag that is a member", () => {
  holder.quiet
    `é`
    `è`;
});
show("a tag with the text `text` behind a tag", () => {
  holder.self()
    .quiet
    `é`
    `text`;
});
show("a tag behind a tag with the text `text`", () => {
  holder.self()
    .quiet
    `text`
    `é`;
});
show("an optional call on its own line with a tag as its first argument", () => {
  holder
    .fail
    ?.(holder.quiet
      `é`);
});
show("a call behind a `)` on its own line with a tag as its first argument", () => {
  (
    getFail()
  )(holder.quiet
      `é`);
});
show("a call behind a `?.` that is not printed with a tag as its first argument", () => {
  (function () {
    fail();
  })
    ?.(holder.quiet
      `é`);
});
}
