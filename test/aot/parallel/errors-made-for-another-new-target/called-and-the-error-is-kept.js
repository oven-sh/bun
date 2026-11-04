// An error that a constructor of the engine makes for another new.target leaves out the frames down to the function that is new.target.
// The function is called and returns the variable that holds the error.
function Kept(text) {
  const made = Reflect.construct(Error, [text], new.target ?? Kept);
  return made;
}
Kept.prototype = Object.create(Error.prototype);
const error = Kept("a");
console.log(typeof error.stack, error instanceof Kept, error.message);
