// An error that a constructor of the engine makes for another new.target leaves out the frames down to the function that is new.target.
// The function that is new.target waits for the function that makes the error.
function inner() {
  return Reflect.construct(Error, ["a"], outer);
}
function outer() {
  const made = inner();
  console.log("outer goes on");
  return made;
}
function above() {
  const made = outer();
  console.log("above goes on");
  return made;
}
console.log(typeof above().stack);
