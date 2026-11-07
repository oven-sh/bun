// Prints where a member, a call and a tag are reported that stand behind a tagged template whose backquote stands on the line of the tag's last token, with text that is not ASCII. The source map has no entry for such a backquote: what stands behind the template on that line is reported at the tag's last token, as it is where the text is ASCII. A call that takes such a template as its first argument is reported at its own `(`, which the source map finds from where the template starts.

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
const inThisFile = /stack-positions-behind-tags-on-the-line-of-the-tag-with-text-that-is-not-ascii/;
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
  quiet`é`.member;
});
show("a member behind a tag that is a member", () => {
  holder.quiet`é`.member;
});
show("a member behind a tag that is a member of what a call returns", () => {
  holder.self().quiet`é`.member;
});
show("a member behind a tag that is a call", () => {
  getQuiet(1)`é`.member;
});
show("a member behind a tag that is a call over several lines", () => {
  getQuiet(
    1,
  )`é`.member;
});
show("a member on the next line behind a tag that is a call", () => {
  getQuiet(1)`é`
    .member;
});
show("a call behind a tag that is a member", () => {
  holder.quiet`é`(1);
});
show("a call behind a tag that is a call", () => {
  getQuiet(1)`é`(2);
});
show("a tag behind a tag that is a member", () => {
  holder.quiet`é``è`;
});
show("a tag behind a tag that is a call", () => {
  getQuiet(1)`é``è`;
});
show("an optional call on its own line with a tag as its first argument", () => {
  holder
    .fail
    ?.(holder.quiet`é`);
});
show("a call behind a `)` on its own line with a tag as its first argument", () => {
  (
    getFail()
  )(holder.quiet`é`);
});
show("a call behind a `?.` that is not printed with a tag as its first argument", () => {
  (function () {
    fail();
  })
    ?.(holder.quiet`é`);
});
}
