// @bun
// The same as stack-positions-of-tokens-that-start-a-line.mjs, line for line. `bun build --target=bun` writes the first line: such a file has no source map, and a stack trace shows each place as JavaScriptCore records it.
function fail() {
  throw new Error("fail");
}
class Thrower {
  constructor() {
    fail();
  }
}
const holder = {
  nothing: undefined,
  fail,
  Thrower,
  self() {
    return this;
  },
  get getter() {
    return fail();
  },
  tag() {
    return fail();
  },
};
const use = (...values) => values.length;
const key = () => "getter";
const iterable = {
  [Symbol.iterator]() {
    return fail();
  },
};
const inThisFile = /stack-positions-of-tokens-that-start-a-line/;
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
show("a member of undefined", () => {
  use(
    holder
      .nothing
      .member,
  );
});
show("a member of undefined behind ?.", () => {
  use(
    holder
      ?.nothing
      .member,
  );
});
show("an element of undefined", () => {
  use(
    holder
      .nothing
      [0],
  );
});
show("a getter behind ?.", () => {
  use(
    holder
      ?.getter,
  );
});
show("an element behind ?.", () => {
  use(
    holder
      ?.[key()],
  );
});
show("a member in quotes", () => {
  use(
    holder
      .nothing
      ["a-b"],
  );
});
show("a getter", () => {
  use(
    holder
      .getter,
  );
});
show("a store to a member of undefined", () => {
  holder
    .nothing
    .member = 1;
});
show("a method", () => {
  use(
    holder
      .self()
      .fail(),
  );
});
show("a method that is undefined", () => {
  use(
    holder
      .nothing(),
  );
});
show("a method with its arguments on the next line", () => {
  use(
    holder.nothing
      (1),
  );
});
show("an optional call", () => {
  use(
    holder.fail
      ?.(),
  );
});
show("a function that is called where it is written", () => {
  (() => {
    fail();
  })();
});
show("a function that is called where it is written, with arguments", () => {
  (function (first) {
    fail();
  })(
    1,
  );
});
show("a call of what a call returns", () => {
  use(
    holder.self
      .bind(holder)()
      .nothing
      (),
  );
});
show("a callee in parentheses", () => {
  (holder.fail)
    ();
});
show("an element that is called", () => {
  holder["fail"]
    ();
});
show("a function that is used once", () => {
  const once = () => {
    fail();
  };
  once();
});
show("a name that is not declared", () => {
  use(
    notDeclared,
  );
});
show("a name that is not declared, in a list", () => {
  use([
    1,
    notDeclared
  ]);
});
show("a name that is not declared, called", () => {
  use(
    notDeclared(),
  );
});
show("new with arguments", () => {
  use(
    new
      Thrower(1),
  );
});
show("new with arguments on other lines", () => {
  use(
    new Thrower(
      1,
    ),
  );
});
show("new of a member", () => {
  use(
    new holder
      .Thrower(1),
  );
});
show("new without arguments", () => {
  use(
    new
      Thrower,
  );
});
show("new of what is no constructor", () => {
  use(
    new
      holder.nothing(1),
  );
});
show("an error that is thrown", () => {
  throw new
    RangeError("thrown");
});
show("a spread argument", () => {
  use(
    ...
      1,
  );
});
show("a spread element", () => {
  use([
    0,
    ...
      1,
  ]);
});
show("a spread property", () => {
  use({
    a: 0,
    ...
      holder,
  });
});
show("a spread property in one line", () => {
  use({ a: 0, ...holder });
});
show("a loop", () => {
  for (const value
    of iterable) use(value);
});
show("a loop over a list that takes values", () => {
  for (const [
    value,
  ] of iterable) use(value);
});
show("a list that takes values", () => {
  const
    [first] = holder.nothing;
  use(first);
});
show("a list in a list that takes values", () => {
  const [
    [first],
  ] = [holder.nothing];
  use(first);
});
show("a tagged template", () => {
  use(
    holder.tag
      `text`,
  );
});
show("a tagged template of a name", () => {
  const tag = holder.tag;
  use(
    tag
      `text`,
  );
});
}
