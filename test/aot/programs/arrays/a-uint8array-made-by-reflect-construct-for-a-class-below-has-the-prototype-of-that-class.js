// One typed array is made by Reflect.construct for a new target that is not the constructor that is called, and nothing else in the program makes one: every callee and every new target is in sight of the compiler.
// What is made has the prototype of the new target: its constructor, its methods, what instanceof says.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Below1 extends Uint8Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("Uint8Array: Reflect.construct for a class below:", () => {
  const one = Reflect.construct(Uint8Array, [2], Below1);
  return [one.length, one instanceof Below1, one instanceof Uint8Array, one.method(), one.constructor === Below1, one.constructor === Uint8Array, Object.getPrototypeOf(one) === Below1.prototype].join(" ");
});
