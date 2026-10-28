// The function that returns a class is called once where classes are declared, and again by ways that are hard to see.
const lines = [];
class Base { id = 1; who() { return "base"; } }
class Other { id = 2; who() { return "other"; } }
const Timed = (Parent) => class extends Parent { started = 5; #ticks = 0; static is(value) { return #ticks in value; } tick() { return ++this.#ticks + this.started + this.id; } };
class A extends Timed(Base) {}
const holder = { make: Timed };
const spelled = ["ma", "ke"].join("");
const Late = holder[spelled](Other);
const Again = Reflect.apply(Timed, undefined, [Base]);
const a = new A(), late = new Late(), again = new Again();
lines.push(a.tick(), late.tick(), again.tick(), a.who(), late.who(), again.who());
lines.push(A.is(a), A.is(late), A.is(again), Late.is(a), Late.is(late), Again.is(again), Again.is(a));
lines.push(a instanceof Base, late instanceof Base, late instanceof Other, again instanceof Base, a instanceof Again, again instanceof A);
for (const [receiver, method] of [[late, a.tick], [a, late.tick], [again, a.tick], [{}, a.tick]]) {
  try { lines.push(method.call(receiver)); } catch (error) { lines.push(error.constructor.name); }
}
lines.push(Object.getPrototypeOf(A) === Object.getPrototypeOf(Again), Object.getPrototypeOf(Object.getPrototypeOf(A)) === Base, Object.getPrototypeOf(Late) === Other);
console.log(lines.join(" "));
