// The class that is handed and the function that returns a class come out of other files; one class is in a binding that changes.
import Main, { Base, Swapped, swap } from "./base.js";
import * as mixins from "./mixins.js";
import { Timed, Tagged } from "./mixins.js";
const lines = [];
class A extends Timed(Base) {}
class B extends Tagged(Timed(Main)) {}
class C extends mixins.Timed(mixins.Tagged(Base)) {}
class D extends Timed(Swapped) {}
swap();
class E extends Timed(Swapped) {}
for (const K of [A, B, C, D, E]) { const made = new K(); lines.push(K.name, made.tick(), made.who(), made.size ? made.size() : "-", Object.keys(made).join(""), [A, B, C, D, E].map((O) => (O.is(made) ? 1 : 0)).join("")); }
let sum = 0; for (let i = 0; i < 500; i++) { const a = new A(), b = new B(), plain = new Base(), main = new Main(); sum += a.tick() + b.tick() + b.size() + plain.id + main.main; } lines.push(sum);
console.log(lines.join(" "));
