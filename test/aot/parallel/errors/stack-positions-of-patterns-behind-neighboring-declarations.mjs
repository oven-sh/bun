// Prints where errors are reported in a list pattern and in the rest of an object pattern behind a neighboring declaration. Inside a function Bun's transpiler prints the two in one statement where both are of one kind and nothing that it prints stands between them, so the frame names the `[` or the `{` where that stands on another line than the last token in front of it that the source map knows, and that token everywhere else.

function quiet() {}
const holder = {
  quiet,
  nothing: undefined,
  five: 5,
  list: [undefined],
  inner: { list: undefined },
  get bad() {
    throw new Error("getter");
  },
  fine: 1,
};
const pass = value => value;
const use = (...values) => values.length;
const inThisFile = /stack-positions-of-patterns-behind-neighboring-declarations/;
function placesOf(error) {
  const places = [];
  for (const line of String(error.stack).split("\n").slice(1)) {
    if (/ at (async )?show(Later)? /.test(line)) break;
    const place = /:(\d+:\d+)\)?$/.exec(line);
    if (place && inThisFile.test(line)) places.push(place[1]);
  }
  return places.join(" ");
}
function show(label, run) {
  try {
    run();
    console.log(label, "| nothing is thrown");
  } catch (error) {
    console.log(label, "|", error.message, "|", placesOf(error));
  }
}
async function showLater(label, run) {
  try {
    await run();
    console.log(label, "| nothing is thrown");
  } catch (error) {
    console.log(label, "|", error.message, "|", placesOf(error));
  }
}
// prettier-ignore
{
show("a list behind a call over several lines", () => {
  const data = pass(
    holder.nothing,
  );
  const [first] = data;
  use(data, first);
});
show("a list of an object behind a call over several lines and a comment", () => {
  const data = pass(
    holder.nothing,
  );
  // the next line takes the first entry
  const [{ id }] = data;
  use(data, id);
});
show("a list behind a declaration on the line above", () => {
  const data = holder.nothing;
  const [first] = data;
  use(data, first);
});
show("a list behind a declaration on its line", () => {
  const data = holder.nothing; const [first] = data;
  use(data, first);
});
show("a list behind two declarations", () => {
  const data = pass(
    holder.nothing,
  );
  const other = pass(2);
  const [first] = data;
  use(data, other, first);
});
show("a list behind a let", () => {
  let data = pass(
    holder.nothing,
  );
  let [first] = data;
  use(data, first);
});
show("a list behind a var", () => {
  var data = pass(
    holder.nothing,
  );
  var [first] = data;
  use(data, first);
});
show("a list of a const behind a let", () => {
  let data = pass(
    holder.nothing,
  );
  const [first] = data;
  use(data, first);
});
show("a list behind a call that is a statement", () => {
  quiet(
    1,
  );
  const [first] = holder.nothing;
  use(first);
});
show("a list behind a constant that is printed as its value", () => {
  const data = pass(
    holder.nothing,
  );
  const index = 0;
  const [first] = data;
  use(data, index, first);
});
show("a list behind a name without a value", () => {
  let data;
  let [first] = data;
  use(data, first);
});
show("a list behind another list", () => {
  const [data] = holder.list;
  const [first] = data;
  use(data, first);
});
show("a list in a list", () => {
  const data = pass(
    holder.list,
  );
  const [[first]] = data;
  use(data, first);
});
show("a list behind a key", () => {
  const data = pass(
    holder.inner,
  );
  const { list: [first] } = data;
  use(data, first);
});
show("a list that starts a line behind a key", () => {
  const data = pass(
    holder.inner,
  );
  const { list:
    [first] } = data;
  use(data, first);
});
show("an empty list", () => {
  const data = pass(
    holder.nothing,
  );
  const [] = data;
  use(data);
});
show("a list that takes the rest", () => {
  const data = pass(
    holder.five,
  );
  const [...rest] = data;
  use(data, rest);
});
show("a list behind a name of its own statement", () => {
  const data = pass(
    holder.nothing,
  ),
    [first] = data;
  use(data, first);
});
show("a list behind a name of its own statement, on its line", () => {
  const data = pass(
    holder.nothing,
  ), [first] = data;
  use(data, first);
});
show("a list in a block", () => {
  {
    const data = pass(
      holder.nothing,
    );
    const [first] = data;
    use(data, first);
  }
});
show("a list in a case", () => {
  switch (holder.five) {
    case 5:
      const data = pass(
        holder.nothing,
      );
      const [first] = data;
      use(data, first);
  }
});
show("a list in the head of a loop", () => {
  for (let data = holder.nothing,
    [first] = data; ; ) use(data, first);
});
show("a list in the head of a loop, on its line", () => {
  for (let data = holder.nothing, [first] = data; ; ) use(data, first);
});
show("a list behind a name whose value stands where a name that is used once stood", () => {
  const before = pass(
    1,
  );
  const once = holder.inner;
  const value = once.list, [first] = value;
  use(before, value, first);
});
show("a list behind a statement whose last name is printed as its value", () => {
  const data = pass(
    holder.nothing,
  ), index = 0;
  const [first] = data;
  use(data, index, first);
});
show("a list behind a name of its statement that is printed as its value", () => {
  const data = pass(
    holder.nothing,
  );
  const index = 0, [first] = data;
  use(data, index, first);
});
show("a list behind a tagged template whose backquote starts its line", () => {
  const data = holder.quiet
    `text`; const [first] = data;
  use(data, first);
});
show("a list behind a call whose parenthesis starts its line", () => {
  const data = holder.quiet
    (1); const [first] = data;
  use(data, first);
});
show("a list that starts a line in the head of a loop", () => {
  for (let
    [first] = holder.nothing; ; ) use(first);
});
show("the rest of an object behind a call", () => {
  const label = String(1);
  const { fine, ...rest } = holder;
  use(label, fine, rest);
});
show("the rest of an object behind a call on its line", () => {
  const label = String(1); const { fine, ...rest } = holder;
  use(label, fine, rest);
});
show("the rest of an object behind a call over several lines", () => {
  const label = String(
    1,
  );
  const { fine, ...rest } = holder;
  use(label, fine, rest);
});
show("the rest of an object behind a name of its own statement", () => {
  const label = String(1),
    { fine, ...rest } = holder;
  use(label, fine, rest);
});
show("the rest of an object of a const behind a let", () => {
  let label = String(1);
  const { fine, ...rest } = holder;
  use(label, fine, rest);
});
show("the rest of an object behind a key", () => {
  const label = String(1);
  const { inner: { ...rest } } = { get inner() { return holder; } };
  use(label, rest);
});
await showLater("a list behind an await over several lines", async () => {
  const data = (
    await Promise.all(
      [holder.nothing],
    )
  ).filter(each => each);
  // the next line takes the first entry
  const [{ id }] = data;
  use(data, id);
});
show("a list in a generator", () => {
  function* steps() {
    const data = pass(
      holder.nothing,
    );
    const [first] = data;
    yield use(data, first);
  }
  steps().next();
});
show("a list behind a name that nothing else reads", () => {
  const before = pass(
    1,
  );
  const once = holder.nothing;
  const [first] = once;
  use(before, first);
});
show("a list behind a name that nothing else reads, on its line", () => {
  const before = pass(
    1,
  );
  const once = holder.nothing; const [first] = once;
  use(before, first);
});
show("a list behind a declaration with a comment in its line", () => {
  const data = pass(
    holder.nothing,
  ); // the next line takes the first entry of [data]
  const [first] = data;
  use(data, first);
});
show("a list behind an empty statement", () => {
  const data = pass(
    holder.nothing,
  );;
  const [first] = data;
  use(data, first);
});
show("a list behind a function that is declared between", () => {
  const data = pass(
    holder.nothing,
  );
  function between() {}
  const [first] = data;
  use(data, first, between);
});
show("a list behind a class that is declared between", () => {
  const data = pass(
    holder.nothing,
  );
  class Between {}
  const [first] = data;
  use(data, first, Between);
});
show("a list behind a template", () => {
  const text = `five: ${holder.five}`; const [first] = holder.nothing;
  use(text, first);
});
show("a list behind a function expression", () => {
  const made = function () {
    return 1;
  }; const [first] = holder.nothing;
  use(made, first);
});
show("a list behind an arrow function", () => {
  const made = () =>
    1; const [first] = holder.nothing;
  use(made, first);
});
show("a list behind an object", () => {
  const made = {
    a: 1,
  }; const [first] = holder.nothing;
  use(made, first);
});
show("a list behind a class expression", () => {
  const Made = class {
  }; const [first] = holder.nothing;
  use(Made, first);
});
show("a list behind a condition over several lines", () => {
  const made = holder.five ?
    1 :
    2; const [first] = holder.nothing;
  use(made, first);
});
show("a list in a try block", () => {
  try {
    const data = pass(
      holder.nothing,
    );
    const [first] = data;
    use(data, first);
  } finally {
    quiet();
  }
});
show("a list in a static block", () => {
  class Holder {
    static {
      const data = pass(
        holder.nothing,
      );
      const [first] = data;
      use(data, first);
    }
  }
  use(Holder);
});
show("a list behind an object pattern", () => {
  const { five } = holder;
  const [first] = holder.nothing;
  use(five, first);
});
show("a list behind a list with a default over several lines", () => {
  const [missing = pass(
    1,
  )] = []; const [first] = holder.nothing;
  use(missing, first);
});
show("a list behind a comment that is kept", () => {
  const data = pass(
    holder.nothing,
  );
  /*! the transpiler keeps this comment */
  const [first] = data;
  use(data, first);
});
}
