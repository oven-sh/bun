// Three classes that only their own evaluation can define: below null, below an expression, and with a computed member name.
// Each is linked above the prototype of a function, and a class below that function is defined and used first.
function report(label, early, Interface, Base) {
  console.log(label, early.greet(), new Interface() instanceof Base, Base.prototype.constructor === Base);
}

function FirstEmitter() {}
globalThis.first = FirstEmitter;
class FirstInterface extends FirstEmitter {}
globalThis.firstEarly = new FirstInterface();
class BelowNull extends null {
  greet() {
    return "greet";
  }
}
Object.setPrototypeOf(FirstEmitter.prototype, BelowNull.prototype);
report("below null", globalThis.firstEarly, FirstInterface, BelowNull);

function SecondEmitter() {}
globalThis.second = SecondEmitter;
class SecondInterface extends SecondEmitter {}
globalThis.secondEarly = new SecondInterface();
const pick = () => Map;
class BelowExpression extends pick() {
  greet() {
    return "greet";
  }
}
Object.setPrototypeOf(SecondEmitter.prototype, BelowExpression.prototype);
report("below an expression", globalThis.secondEarly, SecondInterface, BelowExpression);

function ThirdEmitter() {}
globalThis.third = ThirdEmitter;
class ThirdInterface extends ThirdEmitter {}
globalThis.thirdEarly = new ThirdInterface();
const name = ["gr", "eet"].join("");
class WithComputedName {
  [name]() {
    return "greet";
  }
}
Object.setPrototypeOf(ThirdEmitter.prototype, WithComputedName.prototype);
report("a computed name", globalThis.thirdEarly, ThirdInterface, WithComputedName);
