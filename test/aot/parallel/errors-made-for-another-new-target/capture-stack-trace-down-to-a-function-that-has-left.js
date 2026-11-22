// An error that a constructor of the engine makes for another new.target leaves out the frames down to the function that is new.target.
// Error.captureStackTrace(object, f), where f has left by a tail call for another function of the program.
function mark(object) {
  Error.captureStackTrace(object, outer);
  return object;
}
function outer(object) {
  return mark(object);
}
function above(object) {
  const marked = outer(object);
  console.log("above goes on");
  return marked;
}
console.log(typeof above({}).stack, String(above({}).stack).split("\n").length);
