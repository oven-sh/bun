// Functions read a let, a const or a class of their own before its declaration has run, and nothing uses what they read. Plain Bun prints another output.
function show(label, run) {
  try {
    console.log(label, "returned", run());
  } catch (error) {
    console.log(label, error.name);
  }
}
show("a statement", () => {
  late;
  return 1;
});
show("a const", () => {
  fixed;
  return 1;
});
show("left of a comma", () => (late, 2));
show("under void", () => void late);
show("under typeof", () => {
  typeof late;
  return 1;
});
show("under !", () => {
  !late;
  return 1;
});
show("in a list", () => {
  [late];
  return 1;
});
show("in a list behind holes", () => {
  [, , late];
  return 1;
});
show("in an object", () => {
  ({ a: late });
  return 1;
});
show("left of &&", () => {
  late && 1;
  return 1;
});
show("left of ??", () => {
  late ?? 1;
  return 1;
});
show("a condition", () => {
  late ? 1 : 2;
  return 1;
});
show("compared", () => {
  late === 1;
  return 1;
});
show("the test of an empty if", () => {
  if (late) {
  }
  return 1;
});
show("in a block", () => {
  {
    late;
  }
  return 1;
});
show("a variable of the function itself", () => {
  own;
  let own = 1;
  return own;
});
show("a class of the function itself", () => {
  Own;
  class Own {}
  return 1;
});
show("in a try of the function itself", () => {
  try {
    own;
    return "no error";
  } catch (error) {
    return "caught " + error.name;
  }
  let own = 1;
});
show("in a static block", () => {
  class Reader {
    static {
      inner;
    }
  }
  let inner = 1;
  return 1;
});
show("in the initializer of a field", () => {
  class Reader {
    field = (inner, 1);
  }
  new Reader();
  let inner = 1;
  return 1;
});
show("in the default of a parameter", () => {
  function read(first = (second, 1), second) {
    return first;
  }
  return read();
});
show("in a function that is called above the declaration", () => {
  read();
  const value = 1;
  function read() {
    [, , value];
  }
  return 1;
});
show("in an earlier case of a switch", () => {
  switch (1) {
    case 1:
      other;
    case 2:
      let other;
  }
  return 1;
});
show("in the head of a loop", () => {
  for (let index = (index, 0); index < 1; index++) {}
  return 1;
});
show("a read that is used", () => late);
let late = 1;
const fixed = 1;
show("behind the declarations", () => {
  late;
  fixed;
  return 1;
});
/* Output:
a statement ReferenceError
a const ReferenceError
left of a comma ReferenceError
under void ReferenceError
under typeof ReferenceError
under ! ReferenceError
in a list ReferenceError
in a list behind holes ReferenceError
in an object ReferenceError
left of && ReferenceError
left of ?? ReferenceError
a condition ReferenceError
compared ReferenceError
the test of an empty if ReferenceError
in a block ReferenceError
a variable of the function itself ReferenceError
a class of the function itself ReferenceError
in a try of the function itself returned caught ReferenceError
in a static block ReferenceError
in the initializer of a field ReferenceError
in the default of a parameter ReferenceError
in a function that is called above the declaration ReferenceError
in an earlier case of a switch ReferenceError
in the head of a loop ReferenceError
a read that is used ReferenceError
behind the declarations returned 1
*/
