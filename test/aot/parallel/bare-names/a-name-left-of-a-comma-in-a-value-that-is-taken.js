// Reference: bun build --compile
// The left of a comma in a value that is taken stays in an executable of `bun build`, which leaves it out only where it minifies. `bun run` minifies and goes on.
function show(label, run) {
  try {
    console.log(label, "returned", run());
  } catch (error) {
    console.log(label, error.name);
  }
}
show("the initializer of a field", () => {
  class Reader {
    field = (inner, 1);
  }
  new Reader();
  let inner = 1;
  return 1;
});
show("the initializer of a static field", () => {
  class Reader {
    static field = (inner, 1);
  }
  let inner = 1;
  return Reader.field;
});
show("the default of a parameter", () => {
  function read(first = (second, 1), second) {
    return first;
  }
  return read();
});
show("the head of a loop", () => {
  for (let index = (index, 0); index < 1; index++) {}
  return 1;
});
show("the initializer of a variable", () => {
  const first = (second, 1);
  const second = 2;
  return first;
});
show("what is returned", () => {
  return (inner, 1);
  let inner;
});
show("an argument", () => {
  const answer = String((inner, 1));
  let inner;
  return answer;
});
show("an element", () => {
  const list = [(inner, 1)];
  let inner;
  return list.length;
});
show("two names", () => {
  const first = (early, inner, 1);
  let inner;
  return first;
});
show("behind its declaration", () => {
  let inner = 1;
  const first = (inner, 2);
  return first;
});
show("a class", () => {
  const first = (Later, 1);
  class Later {}
  return first;
});
show("in a statement", () => {
  inner, 1;
  let inner;
  return 1;
});
var early = 0;
