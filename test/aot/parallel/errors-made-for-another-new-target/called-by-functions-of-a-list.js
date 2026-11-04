// An error that a constructor of the engine makes for another new.target leaves out the frames down to the function that is new.target.
// Arrow functions of a list call and construct it.
function Old(text) {
  return Reflect.construct(Error, [text], new.target ?? Old);
}
Old.prototype = Object.create(Error.prototype);
for (const work of [() => Old("a"), () => new Old("b"), () => Reflect.construct(Old, ["c"]), () => Old.call(undefined, "d"), () => Reflect.apply(Old, undefined, ["e"])]) {
  const error = work();
  console.log(typeof error.stack, error.message);
}
