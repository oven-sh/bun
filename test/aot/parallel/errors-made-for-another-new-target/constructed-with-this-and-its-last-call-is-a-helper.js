// An error that a constructor of the engine makes for another new.target leaves out the frames down to the function that is new.target.
// The same, and the function hands `this` on.
function helper(made, list) {
  const error = Reflect.construct(Error, list, Object.getPrototypeOf(made).constructor);
  console.log("helper goes on");
  return error;
}
function Mine() {
  return helper(this, arguments);
}
Mine.prototype = Object.create(Error.prototype, { constructor: { value: Mine, writable: true, configurable: true } });
console.log(typeof new Mine("a").stack);
