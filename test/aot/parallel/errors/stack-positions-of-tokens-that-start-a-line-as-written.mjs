// @bun
// The same program as stack-positions-of-tokens-that-start-a-line.mjs from the third line on. `bun build --target=bun` writes the first line: such a file runs as it is written and has no source map, so a stack trace shows each place as JavaScriptCore records it. It is ASCII on purpose: `bun <file>` reads such a file as Latin-1.
function fail() {
  throw new Error("fail");
}
function quiet() {}
function getFail() {
  return fail;
}
const holder = {
  nothing: undefined,
  fail,
  quiet,
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
show("a member in quotes", () => {
  use(
    holder
      .nothing
      ["a-b"],
  );
});
show("a store to a member of undefined", () => {
  holder
    .nothing
    .member = 1;
});
show("a getter behind a call", () => {
  use(
    holder.self()
      .getter,
  );
});
show("a getter behind a call and ?.", () => {
  use(
    holder.self()
      ?.getter,
  );
});
show("an element behind a call and ?.", () => {
  use(
    holder.self()
      ?.[key()],
  );
});
show("a getter behind a name", () => {
  use(
    holder
      .getter,
  );
});
show("a getter behind a name and ?.", () => {
  use(
    holder
      ?.getter,
  );
});
show("an element behind a name and ?.", () => {
  use(
    holder
      ?.[key()],
  );
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
show("what a call returns, held by a constant that is used once", () => {
  const made = getFail();
  const result = made();
  use(result);
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
show("a loop behind an empty list that starts a line", () => {
  for (const
    [] of iterable) use(0);
});
show("a loop behind a list with a hole that starts a line", () => {
  for (const
    [,] of iterable) use(0);
});
show("a loop behind an empty list in an object that takes values", () => {
  for (const { a:
    [] } of iterable) use(0);
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
show("the rest of an object behind a declaration on the line above", () => {
  const first = use(1);
  const { nothing, ...rest } = holder;
  use(first, nothing, rest);
});
show("the rest of an object behind a declarator on the line above", () => {
  const first = use(1),
    { nothing, ...rest } = holder;
  use(first, nothing, rest);
});
show("the rest of an object that starts a line behind its keyword", () => {
  const
    { nothing, ...rest } = holder;
  use(nothing, rest);
});
show("the rest of an object on the line of its keyword", () => {
  const { nothing, ...rest } = holder;
  use(nothing, rest);
});
show("the rest of an object that a parameter takes", () => {
  function take(
    { nothing, ...rest },
  ) {
    use(nothing, rest);
  }
  take(holder);
});
show("the rest of an object that a parameter with a default takes", () => {
  function take(first,
    { nothing, ...rest } = holder) {
    use(first, nothing, rest);
  }
  take(1);
});
show("the rest of an object that a parameter of an arrow function takes", () => {
  [holder].forEach((
    { nothing, ...rest },
  ) => use(nothing, rest));
});
show("the rest of an object in the head of a loop", () => {
  for (const
    { nothing, ...rest } of [holder]) use(nothing, rest);
});
show("the rest of an object behind the keyword in the head of a loop", () => {
  for (
    const { nothing, ...rest } of [holder]) use(nothing, rest);
});
show("the rest of an object that a catch clause takes", () => {
  try {
    throw holder;
  } catch (
    { nothing, ...rest }
  ) {
    use(nothing, rest);
  }
});
show("the rest of an object in a list that takes values", () => {
  const [
    { nothing, ...rest },
  ] = [holder];
  use(nothing, rest);
});
show("the rest of an object behind a key", () => {
  const { inner:
    { nothing, ...rest } } = { inner: holder };
  use(nothing, rest);
});
show("an object that takes a member of null behind the rest of an object", () => {
  function take(
    { ...rest },
    { member },
  ) {
    use(rest, member);
  }
  take({}, null);
});
show("an object that takes a member of null behind the rest of an object in a declaration", () => {
  const first = use(1),
    { ...rest } = {},
    { member } = null;
  use(first, rest, member);
});
show("a member behind a backquote that starts a line", () => {
  use(
    holder.quiet
      `text`.member,
  );
});
show("an element behind a backquote that starts a line", () => {
  use(
    holder.quiet
      `text`[0],
  );
});
show("a call behind a backquote that starts a line", () => {
  use(
    holder.quiet
      `text`(),
  );
});
show("an optional call behind a backquote that starts a line", () => {
  use(
    holder.self
      `text`?.(),
  );
});
show("a tagged template behind a backquote that starts a line", () => {
  use(
    holder.quiet
      `text``more`,
  );
});
show("a member behind a tagged template of a name", () => {
  use(
    quiet
      `text`.member,
  );
});
show("an element behind a tagged template of a name", () => {
  use(
    quiet
      `text`[0],
  );
});
show("a call behind a tagged template of a name", () => {
  use(
    quiet
      `text`(),
  );
});
show("an optional call behind a tagged template of a name", () => {
  use(
    getFail
      `text`?.(),
  );
});
show("a tagged template behind a tagged template of a name", () => {
  use(
    getFail
      `text``more`,
  );
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
show("an element that is called, with a key that is used once", () => {
  let name = "fail";
  holder[name](1);
});
show("a member behind a call of a function that its block declares below", () => {
  {
    use(
      make()
        .member,
    );
    function make() {}
  }
});
show("the this of the module", () => {
  (this
  )
    (1);
});
show("an optional call of eval", () => {
  use(
    eval
      ?.("null.member"),
  );
});
show("an optional call with an equality that begins with a text", () => {
  use(
    key()
      ?.("a" === holder.nothing),
  );
});
show("an element by a member of a constant that is used once", () => {
  const once = holder.self();
  return null
    [once.nothing];
});
show("an element by a comparison of a text with typeof", () => {
  use(
    quiet()
      ["undefined" == typeof holder],
  );
});
show("an element by an equality that begins with void", () => {
  use(
    quiet()
      [void 0 === holder],
  );
});
show("an element by the only element of a list, below a bracket that ends a line", () => {
  use(
    quiet()[
      [key()][0]
    ],
  );
});
show("an element by the only element of a list, behind a bracket that starts a line", () => {
  use(
    quiet()
      [[key()][0]],
  );
});
show("an element in parentheses behind a bracket that starts a line", () => {
  use(
    quiet()
      [(key())],
  );
});
show("an element behind a comment behind a bracket that starts a line", () => {
  use(
    quiet()
      [ /* the key */ key()],
  );
});
show("an element behind a line comment behind a bracket that starts a line", () => {
  use(
    quiet()
      [ // the key
        key()],
  );
});
show("an element in quotes behind a comment behind a bracket that starts a line", () => {
  use(
    quiet()
      [ /* the key */ "a-b"],
  );
});
show("a member in quotes behind a comment behind a bracket that starts a line", () => {
  use(
    quiet()
      [ /* the key */ "member"],
  );
});
show("an element behind ?. and a bracket that starts a line", () => {
  use(
    quiet
      ?.[key()]
      [key()],
  );
});
show("an element by a constant behind a bracket that starts a line", () => {
  const name = "getter";
  use(
    quiet()
      [name],
  );
});
show("an element by a constant that is no name, behind a bracket that starts a line", () => {
  const name = "a-b";
  use(
    quiet()
      [name],
  );
});
show("an element by a constant that holds the only element of a list, behind a constant that is used once", () => {
  const once = quiet();
  const name = ["getter"][0];
  return once
    [name];
});
show("a call with an equality that begins with undefined", () => {
  (0, holder.nothing
  )
    (undefined !== holder);
});
show("an optional call with an object that new makes", () => {
  use(
    key()
      ?.(new Object({ a: holder })),
  );
});
show("a constant that is used once, called behind a comma", () => {
  const once = getFail();
  (0, once)();
});
show("a constant that is used once, called where a condition that is known chooses it", () => {
  const once = getFail();
  (true ? once : quiet)();
});
show("a constant that is used once, called as the only element of a list", () => {
  const once = { a: 1 };
  ([once][0])();
});
show("a member that is called where a condition that is known chooses it", () => {
  (true ? holder.nothing : 0
  )
    (1);
});
show("a member behind a line that is a comment", () => {
  use(
    holder
      .nothing
      // a comment
      .member,
  );
});
show("a member behind a comment that its line begins with", () => {
  use(
    holder
      .nothing
      /* a comment */ .member,
  );
});
show("a member behind a comment that ends in its line", () => {
  use(
    holder
      .nothing /* a comment
      that ends here */ .member,
  );
});
show("a member whose name stands behind a comment", () => {
  use(
    holder
      .nothing
      . /* a comment */ member,
  );
});
show("a member behind a dot that ends a line and a comment that ends in a dot", () => {
  use(
    holder
      .nothing.
      // see the notes.
      member,
  );
});
show("a getter behind a call and a comment", () => {
  use(
    holder.self()
      // a comment
      .getter,
  );
});
show("a getter behind a call, a comment and ?.", () => {
  use(
    holder.self()
      /* a comment */ ?.getter,
  );
});
show("a getter whose name stands behind ?. and a comment", () => {
  use(
    holder.self()
      ?. /* a comment */ getter,
  );
});
show("an element behind a call, ?. and a comment", () => {
  use(
    holder.self()
      ?. /* a comment */ [key()],
  );
});
show("an element behind a line that is a comment", () => {
  use(
    holder
      .nothing
      // a comment [0]
      [0],
  );
});
show("an element behind a bracket that ends a line and a comment that ends in a bracket", () => {
  use(
    holder
      .nothing[
      // the first [
      0],
  );
});
show("a member by the only element of a list, below a bracket that ends a line and a line that is a comment", () => {
  use(
    quiet()[
      // the key
      ["getter"][0]
    ],
  );
});
show("a member by the only element of a list, below a bracket and a comment that end a line", () => {
  use(
    quiet()[ // the key
      ["getter"][0]
    ],
  );
});
show("a member by the only element of a list, behind a comment below a bracket that ends a line", () => {
  use(
    quiet()[
      /* the key */ ["getter"][0]
    ],
  );
});
show("a call behind a comment", () => {
  (0, holder.nothing
  )
    // a comment
    (1);
});
show("a call behind a comment that ends in a parenthesis", () => {
  (0, holder.nothing
  )
    // a comment (in parentheses)
    (1);
});
show("a call with a comment in front of its arguments", () => {
  (0, holder.nothing
  )
    /* a comment */ (1);
});
show("a call with a comment in front of its first argument", () => {
  (0, holder.nothing
  )
    ( /* a comment */ 1);
});
show("a call without arguments, with a comment in its parentheses", () => {
  (0, holder.nothing
  )
    ( /* a comment */ );
});
show("a function that is called where it is written, behind a comment", () => {
  (() => {
    fail();
  })
    // a comment
    ();
});
show("an optional call behind a comment", () => {
  use(
    holder.fail
      // a comment
      ?.(),
  );
});
show("an optional call with a comment behind its ?.", () => {
  use(
    holder.fail
      ?. /* a comment */ (),
  );
});
show("an optional call with a comment in front of its first argument", () => {
  use(
    holder.fail
      ?.( /* a comment */ 1),
  );
});
show("an optional call behind ?.( that ends a line and a comment that ends in ?.(", () => {
  use(
    holder.fail?.(
      // see ?.(
      1),
  );
});
show("a loop behind a comment", () => {
  for (const value
    // a comment
    of iterable) use(value);
});
show("a loop behind a comment and an empty list that starts a line", () => {
  for (const
    // a comment
    [] of iterable) use(0);
});
show("a list that takes values, behind a comment", () => {
  const
    // a comment
    [first] = holder.nothing;
  use(first);
});
show("a list that takes values, with a comment that its line begins with", () => {
  const
    /* a comment */ [first] = holder.nothing;
  use(first);
});
show("a list that takes values, with a comment behind it", () => {
  const
    [first] /* a comment */ = holder.nothing;
  use(first);
});
show("a list that takes values, with a comment behind it that ends its line", () => {
  const
    [first] // a comment
    = holder.nothing;
  use(first);
});
show("a list in a list that takes values, behind a comment", () => {
  const [
    // a comment
    [first],
  ] = [holder.nothing];
  use(first);
});
show("a list parameter that starts a line and ends it", () => {
  (function (
    [first]
  ) {
    use(first);
  })(holder.nothing);
});
show("a catch list that starts a line and ends it", () => {
  try {
    throw holder.nothing;
  } catch (
    [first]
  ) {
    use(first);
  }
});
show("a list in a list that starts a line and ends it", () => {
  const [
    [first]
  ] = [holder.nothing];
  use(first);
});
show("a tagged template behind a comment", () => {
  use(
    holder.tag
      // a comment
      `text`,
  );
});
show("a tagged template with a comment that its line begins with", () => {
  use(
    holder.tag
      /* a comment */ `text`,
  );
});
show("an optional call of true", () => {
  use(
    true
      ?.(1),
  );
});
show("an optional call of false", () => {
  use(
    false
      ?.(1),
  );
});
show("an optional call of a number", () => {
  use(
    1
      ?.(1),
  );
});
show("an optional call of a text", () => {
  use(
    "text"
      ?.(1),
  );
});
show("an optional call of a template without values", () => {
  use(
    `text`
      ?.(1),
  );
});
show("an optional call of a template with a value", () => {
  use(
    `text${holder}`
      ?.(1),
  );
});
show("an optional call of a big integer", () => {
  use(
    1n
      ?.(1),
  );
});
show("an optional call of a regular expression", () => {
  use(
    /a/
      ?.(1),
  );
});
show("an optional call of a list", () => {
  use(
    [holder]
      ?.(1),
  );
});
show("an optional call of an object", () => {
  use(
    { holder }
      ?.(1),
  );
});
show("an optional call of a function", () => {
  use(
    function () {
      fail();
    }
      ?.(1),
  );
});
show("an optional call of a function, behind the brace that ends it", () => {
  use(
    function () {
      fail();
    }?.(1),
  );
});
show("an optional call of an arrow function", () => {
  use(
    (() => {
      fail();
    })
      ?.(1),
  );
});
show("an optional call of a class", () => {
  use(
    class {}
      ?.(1),
  );
});
show("an optional call of a negation", () => {
  use(
    (!holder)
      ?.(1),
  );
});
show("an optional call of what void gives", () => {
  use(
    (void holder)
      ?.(1),
  );
});
show("an optional call of a sum", () => {
  use(
    (holder + 1)
      ?.(1),
  );
});
show("an optional call of what a logical operator chooses", () => {
  use(
    (holder.nothing || 1)
      ?.(1),
  );
});
show("an optional call of a sum that is stored", () => {
  let count = 0;
  use(
    (count += 1)
      ?.(1),
  );
});
show("an optional call of what a logical assignment stores", () => {
  let count = 0;
  use(
    (count ||= 1)
      ?.(1),
  );
});
show("an optional call of what an assignment stores", () => {
  let count = 0;
  use(
    (count = 1)
      ?.(1),
  );
});
show("an optional call behind a comma and a number", () => {
  use(
    (holder, 2)
      ?.(1),
  );
});
show("an optional call behind a comma and a name", () => {
  use(
    (2, holder)
      ?.(1),
  );
});
show("an optional call of what a condition chooses", () => {
  use(
    (holder ? 1 : 2)
      ?.(1),
  );
});
show("an optional call of a list without arguments", () => {
  use(
    [holder]
      ?.(),
  );
});
show("an optional call of a list with its arguments on the next line", () => {
  use(
    [holder]
      ?.(
        1,
      ),
  );
});
show("an optional call of a list whose ?. ends the line", () => {
  use(
    [holder]?.
      (1),
  );
});
show("an optional call of a list behind a line that is a comment", () => {
  use(
    [holder]
      // a comment
      ?.(1),
  );
});
show("an optional call of a text joined to a constant", () => {
  const start = "a";
  use(
    (start + "b")
      ?.(1),
  );
});
show("an optional call behind a comma and a text joined to a constant", () => {
  const start = "a";
  use(
    (holder, start + "b")
      ?.(1),
  );
});
show("an optional call of a constant text", () => {
  const start = "a";
  use(
    start
      ?.(1),
  );
});
show("an optional call of a template that holds a constant text", () => {
  const start = "a";
  use(
    `${start}b`
      ?.(1),
  );
});
show("an optional call of a constant that is used once", () => {
  const once = getFail();
  use(
    once
      ?.(1),
  );
});
show("an optional call of a constant that is used once, behind a comma", () => {
  const once = getFail();
  use(
    (0, once)
      ?.(1),
  );
});
class Base {
  get getter() {
    return fail();
  }
  set setter(value) {
    use(fail());
  }
  method() {
    return use(fail());
  }
}
class Derived extends Base {
  readsMember() {
    return super
      .getter;
  }
  readsElement() {
    return super
      [key()];
  }
  storesMember() {
    super
      .setter = 1;
  }
  callsMember() {
    return use(super
      .method());
  }
  callsElement() {
    return use(super
      ["method"]
      ());
  }
}
show("a member of super", () => {
  new Derived().readsMember();
});
show("an element of super", () => {
  new Derived().readsElement();
});
show("a store to a member of super", () => {
  new Derived().storesMember();
});
show("a call of a member of super", () => {
  new Derived().callsMember();
});
show("a call of an element of super", () => {
  new Derived().callsElement();
});
}
