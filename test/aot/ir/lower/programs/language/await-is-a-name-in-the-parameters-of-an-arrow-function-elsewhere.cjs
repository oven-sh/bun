// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="holdsArrow"

// Where `await` is no operator it is a name, in the parameters of an arrow function too: in a function that is not async, and in the initializer of a field of a class in an async function.
var await = 1;
function holdsArrow() {
  return (value = await) => value;
}
async function holdsField() {
  return class {
    field = (value = await) => value;
  };
}
console.log(holdsArrow()(), holdsField);
