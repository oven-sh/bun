// Prints where a call is reported whose first argument is a tagged template and whose callee ends on another line than the one in front of the `(` or the `?.(`: where that callee ends, or behind the `?.`. The end of a callee on a line above the `(` is not looked for: that call is reported at what is mapped in front of it. Bun's transpiler prints a template whose text is not ASCII as a call of its tag, which stands at the backquote. The token of the call around it is looked for from where the tag starts, as where the text is ASCII.

function fail() {
  throw new Error("fail");
}
function getFail() {
  return fail;
}
const tag = strings => strings[0];
const holder = { tag };
const inThisFile = /stack-positions-of-calls-whose-first-argument-is-a-tag/;
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
show("a function called where it is written with a tag", () => {
  (() => {
    fail();
  })(tag`e`);
});
show("a function called where it is written with a tag whose text is not ASCII", () => {
  (() => {
    fail();
  })(tag`é`);
});
show("a callee in parentheses called with a tag", () => {
  (getFail()
  )
    (tag`e`);
});
show("a callee in parentheses called with a tag whose text is not ASCII", () => {
  (getFail()
  )
    (tag`é`);
});
show("an optional call with a tag", () => {
  getFail()
    ?.(tag`e`);
});
show("an optional call with a tag whose text is not ASCII", () => {
  getFail()
    ?.(tag`é`);
});
show("a function called with a tag that is a member", () => {
  (() => {
    fail();
  })(holder.tag`e`);
});
show("a function called with a tag that is a member and whose text is not ASCII", () => {
  (() => {
    fail();
  })(holder.tag`é`);
});
show("a function called with a tag that takes a value", () => {
  (() => {
    fail();
  })(tag`e${1}`);
});
show("a function called with a tag that takes a value and whose text is not ASCII", () => {
  (() => {
    fail();
  })(tag`é${1}`);
});
show("a function called with a tag as its second argument", () => {
  (() => {
    fail();
  })(1, tag`e`);
});
show("a function called with a tag whose text is not ASCII as its second argument", () => {
  (() => {
    fail();
  })(1, tag`é`);
});
}
