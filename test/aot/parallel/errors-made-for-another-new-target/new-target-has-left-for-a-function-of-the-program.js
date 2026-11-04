// An error that a constructor of the engine makes for another new.target leaves out the frames down to the function that is new.target.
// The function that is new.target has left by a tail call for another function of the program: it is gone, nobody finds it, and the error has no stack. So it is under `bun <file>`.
function inner() {
  return Reflect.construct(Error, ["a"], outer);
}
function outer() {
  return inner();
}
function above() {
  const made = outer();
  console.log("above goes on");
  return made;
}
console.log(typeof above().stack);
