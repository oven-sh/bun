// Under: --aot-testing=WritesBodiesStraight: the function left by a tail call there, and the error had no stack
// An error that a constructor of the engine makes for another new.target leaves out the frames down to the function that is new.target.
// The function is called, not constructed, and Reflect.construct, by its name, is its last call: its frame stays while Reflect.construct constructs.
function Old(text) {
  return Reflect.construct(Error, [text], new.target ?? Old);
}
Old.prototype = Object.create(Error.prototype);
function Strict(text) {
  "use strict";
  return Reflect.construct(Error, [text], Strict);
}
Strict.prototype = Object.create(Error.prototype);
function once() { return new Old("c"); }
const first = Old("a"), second = Strict("b"), third = once();
console.log(typeof first.stack, typeof second.stack, typeof third.stack, first instanceof Old, second instanceof Strict, first.message + second.message + third.message);
