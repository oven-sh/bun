// One typed array is made by Reflect.construct for a new target that is not the constructor that is called, and nothing else in the program makes one: every callee and every new target is in sight of the compiler.
// What is made has the prototype of the new target: its constructor, its methods, what instanceof says.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
function Plain10() {}
Plain10.prototype = { kind: "a plain prototype" };
tell("Uint8Array: Reflect.construct for a plain function:", () => {
  const one = Reflect.construct(Uint8Array, [2], Plain10);
  return [one.length, one.kind, one instanceof Uint8Array, one.constructor === Uint8Array, one.constructor === Object, Object.getPrototypeOf(one) === Plain10.prototype].join(" ");
});
tell("Uint8Array: made by itself beside all those:", () => {
  const one = Reflect.construct(Uint8Array, [2]);
  const other = Uint8Array.from([1, 2]);
  return [one.length, one.constructor === Uint8Array, other.constructor === Uint8Array, Object.getPrototypeOf(other) === Uint8Array.prototype, String(other[1])].join(" ");
});
