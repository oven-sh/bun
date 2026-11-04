// Prints where errors are reported behind an element whose key is a constant that the element in front of it has as its key too. Bun's transpiler prints the value of the constant in place of both names, and its source map takes no second entry in a row for one place: the second key has none. What follows such an element is found at the `[` in front of that key where the source map has it, on another line than the value, and else at what is mapped in front of it.

function fail() {
  throw new Error("fail");
}
const holder = {
  nothing: undefined,
  list: [[]],
  grid: [[{}]],
  calls: [[fail]],
  "a-b": { "a-b": undefined },
};
const tags = [() => []];
const use = (...values) => values.length;
const key = () => "member";
const inThisFile = /stack-positions-behind-keys-that-one-constant-holds/;
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
show("an element behind two elements by one constant", () => {
  const zero = 0;
  use(holder.list[zero][zero][key()]);
});
show("a member behind two elements by one constant", () => {
  const zero = 0;
  use(holder.list[zero][zero].member);
});
show("a call behind two elements by one constant", () => {
  const zero = 0;
  use(holder.list[zero][zero](1));
});
show("a call of what two elements by one constant hold", () => {
  const zero = 0;
  use(holder.calls[zero][zero]());
});
show("an optional call of what two elements by one constant hold", () => {
  const zero = 0;
  use(holder.calls[zero][zero]?.(1));
});
show("a call with its arguments on the lines below two elements by one constant", () => {
  const zero = 0;
  use(
    holder.list[zero][zero](
      1,
    ),
  );
});
show("a tagged template behind two elements by one constant", () => {
  const zero = 0;
  use(holder.list[zero][zero]`x`);
});
show("a tag that two elements by one constant hold", () => {
  const zero = 0;
  use(holder.calls[zero][zero]`x`);
});
show("a third element by that constant", () => {
  const zero = 0;
  use(holder.list[zero][zero][zero]);
});
show("an element behind three elements by one constant", () => {
  const zero = 0;
  use(holder.grid[zero][zero][zero][key()][key()]);
});
show("a store to an element behind two elements by one constant", () => {
  const zero = 0;
  holder.list[zero][zero][key()] = 1;
});
show("a store to a member behind two elements by one constant", () => {
  const zero = 0;
  holder.list[zero][zero].member = 1;
});
show("an element behind two elements by one constant, the second on the line below the first", () => {
  const zero = 0;
  use(
    holder.list[zero]
      [zero][key()],
  );
});
show("a member behind two elements by one constant, the second on the line below the first", () => {
  const zero = 0;
  use(
    holder.list[zero]
      [zero].member,
  );
});
show("an element on the line below two elements by one constant", () => {
  const zero = 0;
  use(
    holder.list[zero][zero]
      [key()],
  );
});
show("a member on the line below two elements by one constant that stand on two lines", () => {
  const zero = 0;
  use(
    holder.list[zero]
      [zero]
      .member,
  );
});
show("an element behind two elements by one constant text", () => {
  const dash = "a-b";
  use(holder[dash][dash][key()]);
});
show("an element behind ?.[ by one constant twice", () => {
  const zero = 0;
  use(holder.list?.[zero][zero][key()]);
});
show("a member behind ?.[ by one constant twice", () => {
  const zero = 0;
  use(holder.list?.[zero]?.[zero].member);
});
show("an element behind a constant in parentheses and an element of it by that constant", () => {
  const zero = 0;
  use((holder, zero)[zero][key()][key()]);
});
show("an element behind a choice that ends in a constant and an element of it by that constant", () => {
  const zero = 0;
  use((holder.nothing ?? zero)[zero][key()][key()]);
});
show("an element behind two elements by one constant of what a constant that is used once holds", () => {
  const once = holder.list;
  const zero = 0;
  use(once[zero][zero][key()]);
});
show("an element behind an element by a constant of an element by it that a constant that is used once holds", () => {
  const zero = 0;
  const once = holder.list[zero];
  return once[zero][key()];
});
show("an element behind an element by a constant of what a tag by that constant returns", () => {
  const zero = 0;
  use(tags[zero]`text`[zero][key()]);
});
show("an element behind two elements by two constants", () => {
  const first = 0, second = 0;
  use(holder.list[first][second][key()]);
});
show("an element behind an element by a constant and one by a number", () => {
  const zero = 0;
  use(holder.list[zero][0][key()]);
});
show("an element behind an element by a number and one by a constant", () => {
  const zero = 0;
  use(holder.list[0][zero][key()]);
});
show("an element behind two members that one constant names", () => {
  const name = "list";
  use(holder[name][name][key()]);
});
}
