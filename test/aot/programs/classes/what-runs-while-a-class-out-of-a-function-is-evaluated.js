// What runs while a class is evaluated runs once a call, in the order of the text, and sees the call's own arguments and the counters around the function.
const log = [];
let evaluations = 0;
class Base { static inherited = "base"; }
class Other { static inherited = "other"; }
const Counted = (Parent, label) => { const index = ++evaluations; log.push("enter " + label);
  return class extends Parent {
    static index = index; static label = label; static before = log.length;
    static { log.push("block " + label + " " + index + " " + (this.index === index) + " " + this.inherited + " " + super.inherited); evaluations += 10; }
    static after = evaluations; static self = this; static arrow = () => this;
    static { try { log.push("second " + this.after + " " + (this.self === this) + " " + this.name.length); } finally { log.push("finally " + label); } }
    which() { return index + label + evaluations; }
    field = (log.push("field " + label), index);
  }; };
log.push("start");
const A = Counted(Base, "a");
log.push("between " + evaluations);
class B extends Counted(Other, "b") { static { log.push("B block " + this.index + super.label + Object.hasOwn(this, "index")); } }
const C = Counted(Base, "c"), D = Counted(A, "d");
log.push([A.index, B.index, C.index, D.index, A.after, B.after, C.after, D.after, A.before, C.before].join());
log.push([A.self === A, C.self === C, A.arrow() === A, D.arrow() === D, D.self === D, B.self === Object.getPrototypeOf(B), B.arrow() === B].join());
log.push([new A().which(), new B().which(), new C().which(), new D().which(), new D().field].join());
// A counter that only the function and its classes see.
const Numbered = (() => { let next = 0; return (Parent) => class extends Parent { static number = next++; take() { return next++; } static peek() { return next; } }; })();
const N1 = Numbered(Base), N2 = Numbered(Base), N3 = Numbered(N1);
log.push([N1.number, N2.number, N3.number, new N1().take(), new N2().take(), new N3().take(), N1.peek(), N2.peek()].join());
let shared = 0;
const Sharing = (Parent) => class extends Parent { static id = ++shared; bump() { return ++shared; } static get now() { return shared; } };
const S1 = Sharing(Base), S2 = Sharing(Other);
log.push([S1.id, S2.id, new S1().bump(), new S2().bump(), S1.now, S2.now, shared].join());
// A static block that throws: the call throws, the next call is none the worse.
let mayThrow = true;
const Throwing = (Parent) => class extends Parent { static first = log.push("first of throwing"); static { if (mayThrow) throw new RangeError("in a block"); } static last = "reached"; };
let T1; try { T1 = Throwing(Base); } catch (error) { log.push("caught " + error.message); }
mayThrow = false; const T2 = Throwing(Base);
log.push(String(T1), T2.last);
console.log(log.join("\n"));
