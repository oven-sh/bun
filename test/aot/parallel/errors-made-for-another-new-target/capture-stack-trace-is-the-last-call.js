// An error that a constructor of the engine makes for another new.target leaves out the frames down to the function that is new.target.
// Error.captureStackTrace(object, f) leaves out the frames down to f in the same way, and is the last call of f here.
function mark(object) {
  return Error.captureStackTrace(object, mark);
}
function outer(object) {
  mark(object);
  return object;
}
console.log(typeof outer({}).stack);
