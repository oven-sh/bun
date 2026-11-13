// A native walks what only syntax has made: nobody names `next`, and no built-in has handed the object of the arguments out.
function table() {
  return new Map(arguments);
}
console.log(table(["left", 1], ["right", 2]).get("right"));
