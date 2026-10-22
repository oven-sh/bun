// Above a class that extends null lies Function.prototype, which is no constructor: super() throws a TypeError. Nothing lies above its prototype object. A constructor that answers an object of its own works.
function said(f) { try { return f(); } catch (e) { return e.constructor.name; } }
class Implicit extends null {}
class Explicit extends null { constructor() { super(); } }
class Answers extends null { constructor() { return Object.create(new.target.prototype); } hello() { return "hello"; } static made() { return new Answers(); } }
class Below extends Answers { more() { return this.hello() + " more"; } }
console.log(said(() => new Implicit()), said(() => new Explicit()), said(() => new Answers().hello()), said(() => Answers.made().hello()), said(() => new Below().more()));
console.log(Object.getPrototypeOf(Implicit) === Function.prototype, Object.getPrototypeOf(Implicit.prototype), Object.getPrototypeOf(Below) === Answers, typeof Implicit.call, said(() => Implicit.name));
for (const base of [null, Object, Answers]) {
  class Chosen extends base { constructor() { if (base === null) return Object.create(new.target.prototype); super(); } which() { return base === null ? "null" : base.name; } }
  console.log(said(() => new Chosen().which()), Object.getPrototypeOf(Chosen) === (base ?? Function.prototype));
}
