// An error that a constructor of the engine makes for another new.target leaves out the frames down to the function that is new.target.
// The function is constructed.
function Old(text) {
  return Reflect.construct(Error, [text], new.target ?? Old);
}
Old.prototype = Object.create(Error.prototype);
const error = new Old("a");
console.log(typeof error.stack, error instanceof Old, error.message);
