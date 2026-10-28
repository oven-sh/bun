// One typed array is made by Reflect.construct for a new target that is not the constructor that is called, and nothing else in the program makes one: every callee and every new target is in sight of the compiler.
// What is made has the prototype of the new target: its constructor, its methods, what instanceof says.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
function Plain20() {}
Plain20.prototype = { kind: "a plain prototype" };
tell("Float64Array: Reflect.construct for a plain function:", () => {
  const one = Reflect.construct(Float64Array, [2], Plain20);
  return [one.length, one.kind, one instanceof Float64Array, one.constructor === Float64Array, one.constructor === Object, Object.getPrototypeOf(one) === Plain20.prototype].join(" ");
});
tell("Float64Array: made by itself beside all those:", () => {
  const one = Reflect.construct(Float64Array, [2]);
  const other = Float64Array.from([1.5, 2.5]);
  return [one.length, one.constructor === Float64Array, other.constructor === Float64Array, Object.getPrototypeOf(other) === Float64Array.prototype, String(other[1])].join(" ");
});
