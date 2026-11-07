// The same program as stack-positions-behind-tags-on-the-line-of-the-tag-with-text-that-is-not-ascii.mjs with the text of each template in ASCII. Bun's transpiler prints these tagged templates as they are written, and a stack trace names the same places.

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
  quiet,
  fail,
  self() {
    return this;
  },
};
const inThisFile = /stack-positions-behind-tags-on-the-line-of-the-tag-with-text-in-ascii/;
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
  quiet`e`.member;
});
show("a member behind a tag that is a member", () => {
  holder.quiet`e`.member;
});
show("a member behind a tag that is a member of what a call returns", () => {
  holder.self().quiet`e`.member;
});
show("a member behind a tag that is a call", () => {
  getQuiet(1)`e`.member;
});
show("a member behind a tag that is a call over several lines", () => {
  getQuiet(
    1,
  )`e`.member;
});
show("a member on the next line behind a tag that is a call", () => {
  getQuiet(1)`e`
    .member;
});
show("a call behind a tag that is a member", () => {
  holder.quiet`e`(1);
});
show("a call behind a tag that is a call", () => {
  getQuiet(1)`e`(2);
});
show("a tag behind a tag that is a member", () => {
  holder.quiet`e``e`;
});
show("a tag behind a tag that is a call", () => {
  getQuiet(1)`e``e`;
});
show("an optional call on its own line with a tag as its first argument", () => {
  holder
    .fail
    ?.(holder.quiet`e`);
});
show("a call behind a `)` on its own line with a tag as its first argument", () => {
  (
    getFail()
  )(holder.quiet`e`);
});
show("a call behind a `?.` that is not printed with a tag as its first argument", () => {
  (function () {
    fail();
  })
    ?.(holder.quiet`e`);
});
}
