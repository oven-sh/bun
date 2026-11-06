// Error.captureStackTrace defines an own `stack` on whatever it is handed. Each case reads `stack` 200 times, hands the object over at turn 100 and counts what the reads saw.
// The name is inherited until then: from a getter, a field or a method of a parent class, of the class, of an object or of a function. From turn 100 on the own property is in front of it.
function run(label, read, target) {
  let declared = 0, own = 0, other = 0;
  for (let turn = 0; turn < 200; turn++) {
    if (turn === 100) Error.captureStackTrace(target());
    const seen = read();
    if (seen === "declared") declared++;
    else if (typeof seen === "string") own++;
    else other++;
  }
  console.log(label, declared, own, other);
}
class A1 { static get stack() { return "declared"; } }
class B1 extends A1 {}
run("a leaf class, the getter is the parent's", () => B1.stack, () => B1);
class A2 { static get stack() { return "declared"; } }
class B2 extends A2 {}
class C2 extends B2 {}
run("a class in the middle", () => C2.stack, () => B2);
class A3 { get stack() { return "declared"; } }
const a3 = new A3();
run("an instance, the getter is its class's", () => a3.stack, () => a3);
class A4 { get stack() { return "declared"; } }
class B4 extends A4 { constructor() { super(); this.x = 1; } }
const b4 = new B4();
run("an instance of a subclass", () => b4.stack, () => b4);
const parent5 = { get stack() { return "declared"; } };
const child5 = Object.create(parent5);
run("an object made by Object.create", () => child5.stack, () => child5);
const parent6 = { get stack() { return "declared"; } };
const child6 = { __proto__: parent6, x: 1 };
run("a literal with __proto__", () => child6.stack, () => child6);
function base7() {}
Object.defineProperty(base7, "stack", { get() { return "declared"; }, configurable: true });
function f7() {}
Object.setPrototypeOf(f7, base7);
run("a function whose parent is a function with the getter", () => f7.stack, () => f7);
const arrow8 = () => 1;
Object.setPrototypeOf(arrow8, base7);
run("an arrow function with that parent", () => arrow8.stack, () => arrow8);
function Old9() {}
Old9.prototype = { get stack() { return "declared"; } };
const old9 = new Old9();
run("an instance of a constructor function", () => old9.stack, () => old9);
class A10 { static stack = "declared"; }
class B10 extends A10 {}
run("a leaf class, the parent has a static field", () => B10.stack, () => B10);
class A11 { static stack() { return "declared"; } }
class B11 extends A11 {}
run("a leaf class, the parent has a static method", () => (typeof B11.stack === "function" ? B11.stack() : B11.stack), () => B11);
