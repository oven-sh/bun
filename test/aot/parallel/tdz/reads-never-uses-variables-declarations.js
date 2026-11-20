// Functions read a let, a const or a class before its declaration has run, and nothing uses what they read. An executable built with --aot behaves like one built without: where that one leaves the read out, this one does. Three reads it keeps, and they throw: in the initializer of a field, in the default of a parameter, in the head of a loop (`bun <file>` leaves those out too). ONE LINE STANDS APART: `a read that is used` throws here, as in `bun <file>` and in the language; an executable built without --aot answers undefined there, because its bundle makes the top-level let a var: a fault of the bundle, which is not copied.
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
a statement returned 1
a const returned 1
left of a comma returned 2
under void returned undefined
under typeof returned 1
under ! returned 1
in a list returned 1
in a list behind holes returned 1
in an object returned 1
left of && returned 1
left of ?? returned 1
a condition returned 1
compared returned 1
the test of an empty if returned 1
in a block returned 1
a variable of the function itself returned 1
a class of the function itself returned 1
in a try of the function itself returned no error
in a static block returned 1
in the initializer of a field ReferenceError
in the default of a parameter ReferenceError
in a function that is called above the declaration returned 1
in an earlier case of a switch returned 1
in the head of a loop ReferenceError
a read that is used ReferenceError
behind the declarations returned 1
*/
