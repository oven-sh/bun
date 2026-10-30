// One typed array is made by Reflect.construct for a new target that is not the constructor that is called, and nothing else in the program makes one: every callee and every new target is in sight of the compiler.
// What is made has the prototype of the new target: its constructor, its methods, what instanceof says.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Below21 extends BigInt64Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("BigInt64Array: Reflect.construct for a class below:", () => {
  const one = Reflect.construct(BigInt64Array, [2], Below21);
  return [one.length, one instanceof Below21, one instanceof BigInt64Array, one.method(), one.constructor === Below21, one.constructor === BigInt64Array, Object.getPrototypeOf(one) === Below21.prototype].join(" ");
});
