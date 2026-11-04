// An error that a constructor of the engine makes for another new.target leaves out the frames down to the function that is new.target.
// The function is called, and Reflect.construct() is its last call: native code stands on top of it, and its frame is still there.
function Old(text) {
  return Reflect.construct(Error, [text], new.target ?? Old);
}
Old.prototype = Object.create(Error.prototype);
const error = Old("a");
console.log(typeof error.stack, error instanceof Old, error.message);
