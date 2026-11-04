// An error that a constructor of the engine makes for another new.target leaves out the frames down to the function that is new.target.
// The function is constructed, and its last call is a function of the program that makes the error: a function that is constructed waits for what its last call returns.
function helper(list) {
  const made = Reflect.construct(Error, list, Mine);
  console.log("helper goes on");
  return made;
}
function Mine() {
  return helper(arguments);
}
Mine.prototype = Object.create(Error.prototype, { constructor: { value: Mine, writable: true, configurable: true } });
console.log(typeof new Mine("a").stack);
