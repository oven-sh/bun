// The values of a class's fields are evaluated in a function of their own, which no stack trace lists. A call or a `new` that fails there is quoted as it is written
// there, with its arguments, and not by what stands in the frame below: the constructor, or the `super(...args)` of a constructor that nobody wrote.
let callee = 5,
  Callee = 5,
  a = 1,
  b = 2,
  holder = { member: 5, inner: {} };
class Base {}
// prettier-ignore
const cases = {
  "a call in a field": () => { class Gauge { level = callee(a, b); } return new Gauge(); },
  "a new in a private field": () => { class Gauge { #level = new Callee(a); } return new Gauge(); },
  "a call in a field below a parent": () => { class Gauge extends Base { level = callee(a, b); } return new Gauge(); },
  "a new in a field below a parent": () => { class Gauge extends Base { level = new Callee(a); } return new Gauge(); },
  "a call in a static field": () => { class Gauge { static level = callee(a, b); } return Gauge; },
  "a call in a static block": () => { class Gauge { static { callee(a, b); } } return Gauge; },
  "a method called in a field": () => { class Gauge { level = holder.member(a); } return new Gauge(); },
  "the second field": () => { class Gauge { first = a; level = callee(b, a); } return new Gauge(); },
  "a field below a written constructor": () => { class Gauge extends Base { level = callee(a, b); constructor() { super(); } } return new Gauge(); },
  "an arrow in a field, called later": () => { class Gauge { level = () => callee(a, b); } return new Gauge().level(); },
  "a key in brackets": () => { class Gauge { [callee(a)] = 1; } return new Gauge(); },
  "the control: a call in the constructor": () => { class Gauge { constructor() { this.level = callee(a, b); } } return new Gauge(); },
  "the control: the parent is no constructor": () => { class Gauge extends holder.inner {} return new Gauge(); },
};
for (const name in cases) {
  try {
    cases[name]();
    console.log(name + ": no throw");
  } catch (error) {
    console.log(name + ": " + error.name + ": " + error.message);
  }
}
