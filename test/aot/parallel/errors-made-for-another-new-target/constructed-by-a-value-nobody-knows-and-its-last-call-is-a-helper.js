// An error that a constructor of the engine makes for another new.target leaves out the frames down to the function that is new.target.
// The same, constructed through a value that the build cannot follow.
function helper(made, list) {
  const error = Reflect.construct(Error, list, Object.getPrototypeOf(made).constructor);
  console.log("helper goes on");
  return error;
}
function Mine() {
  return helper(this, arguments);
}
Mine.prototype = Object.create(Error.prototype, { constructor: { value: Mine, writable: true, configurable: true } });
function Other() {}
const classes = { Mine, Other };
const name = ["Mi", "ne"].join("");
console.log(typeof new classes[name]("a").stack, typeof Reflect.construct(classes[name], ["b"]).stack);
