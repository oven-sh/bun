// Reads and calls functions that a later clause of a switch declares: the clauses are one block, and its functions are there from the start. Plain Bun prints another output.
function attempt(label, run) {
  try {
    console.log(label + ":", run());
  } catch (error) {
    console.log(label + ":", "THROWS", error.constructor.name);
  }
}
attempt("read in an earlier clause", () => {
  switch (1) {
    case 1:
      return typeof helper;
    case 2:
      function helper() {}
  }
});
attempt("called in an earlier clause", () => {
  switch (1) {
    case 1:
      return helper();
    case 2:
      function helper() {
        return "called";
      }
  }
});
attempt("read in its own clause, ahead of it", () => {
  switch (1) {
    case 1:
      const found = typeof helper;
      function helper() {}
      return found;
  }
});
attempt("read in a block, ahead of it", () => {
  {
    const found = typeof helper;
    function helper() {}
    return found;
  }
});
attempt("read behind the switch", () => {
  switch (1) {
    case 2:
      function helper() {}
  }
  return typeof helper;
});
attempt("a class in a later clause", () => {
  switch (1) {
    case 1:
      return typeof Helper;
    case 2:
      class Helper {}
  }
});
/* Output:
read in an earlier clause: function
called in an earlier clause: called
read in its own clause, ahead of it: function
read in a block, ahead of it: function
read behind the switch: undefined
a class in a later clause: THROWS ReferenceError
*/
