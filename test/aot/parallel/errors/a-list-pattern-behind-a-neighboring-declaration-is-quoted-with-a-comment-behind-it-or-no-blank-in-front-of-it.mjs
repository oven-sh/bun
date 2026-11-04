// A list that `const`, `let` or `var` declares inside a function, in a statement of its own behind a neighboring declaration of the same kind, with a comment, a tab or the end of the line behind its `]`, or with no blank in front of its `[`, is given null or undefined: the error is at that `[`, and the message quotes the list.
// Todo: the executable quotes nothing: it reports the list at its `[` as plain Bun does, whose transpiler prints the two declarations in one statement, and the engine takes a place at a `[` for a list only where `=`, `:`, `,`, `)`, `}`, `]` or `of` follows its `]` behind nothing but spaces in the same line, and takes a `[` right behind a name for the `[` of a member

function show(name, run) {
  try {
    run();
    console.log(name, "| nothing is thrown");
  } catch (error) {
    const frame = error.stack.split("\n").find(line => /^\s+at /.test(line));
    console.log(name, "|", error.name + ": " + JSON.stringify(error.message), "|", /:(\d+:\d+)\)?$/.exec(frame)[1]);
  }
}
const holder = { nothing: undefined };
// prettier-ignore
{
show("a comment behind a list that const declares", () => {
  const label = String(1);
  const [x] /* the first */ = holder.nothing;
});
show("a comment that ends the line behind a list that const declares", () => {
  const label = String(1);
  const [x] // the first
    = holder.nothing;
});
show("a tab behind a list that const declares", () => {
  const label = String(1);
  const [x]	= holder.nothing;
});
show("the end of the line behind a list that const declares", () => {
  const label = String(1);
  const [x]
    = holder.nothing;
});
show("a list right behind const", () => {
  const label = String(1);
  const[x] = holder.nothing;
});
show("a list right behind let", () => {
  let label = String(1);
  let[x] = null;
});
show("a list right behind var", () => {
  var label = String(1);
  var[x] = holder.nothing;
});
show("a comment behind a list that let declares", () => {
  let label = String(1);
  let [x] /* the first */ = null;
});
show("the end of the line behind a list that var declares", () => {
  var label = String(1);
  var [x]
    = holder.nothing;
});
show("a tab behind a list of two names behind two declarations", () => {
  const label = String(1);
  const other = String(2);
  const [x, y]	= holder.nothing;
});
}
