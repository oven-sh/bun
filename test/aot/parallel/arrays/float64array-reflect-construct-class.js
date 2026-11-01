// One typed array is made by Reflect.construct for a new target that is not the constructor that is called, and nothing else in the program makes one: every callee and every new target is in sight of the compiler.
// What is made has the prototype of the new target: its constructor, its methods, what instanceof says.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Below11 extends Float64Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("Float64Array: Reflect.construct for a class below:", () => {
  const one = Reflect.construct(Float64Array, [2], Below11);
  return [one.length, one instanceof Below11, one instanceof Float64Array, one.method(), one.constructor === Below11, one.constructor === Float64Array, Object.getPrototypeOf(one) === Below11.prototype].join(" ");
});
