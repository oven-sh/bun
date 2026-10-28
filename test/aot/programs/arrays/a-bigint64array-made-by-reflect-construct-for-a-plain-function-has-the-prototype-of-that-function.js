// One typed array is made by Reflect.construct for a new target that is not the constructor that is called, and nothing else in the program makes one: every callee and every new target is in sight of the compiler.
// What is made has the prototype of the new target: its constructor, its methods, what instanceof says.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
function Plain30() {}
Plain30.prototype = { kind: "a plain prototype" };
tell("BigInt64Array: Reflect.construct for a plain function:", () => {
  const one = Reflect.construct(BigInt64Array, [2], Plain30);
  return [one.length, one.kind, one instanceof BigInt64Array, one.constructor === BigInt64Array, one.constructor === Object, Object.getPrototypeOf(one) === Plain30.prototype].join(" ");
});
tell("BigInt64Array: made by itself beside all those:", () => {
  const one = Reflect.construct(BigInt64Array, [2]);
  const other = BigInt64Array.from([1n, 2n]);
  return [one.length, one.constructor === BigInt64Array, other.constructor === BigInt64Array, Object.getPrototypeOf(other) === BigInt64Array.prototype, String(other[1])].join(" ");
});
