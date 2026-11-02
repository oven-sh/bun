// What `new` answers is not what a call of the same function answers, and who is constructed is not decided by the function alone: new.target is a value that can be kept, Reflect.construct gives the object another prototype (with setters under the constructor's stores), and a constructor may answer an object of its own choice.
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
// A function that returns a constant, a parameter, or nothing: called and constructed.
function answersSeven() {
  return 7;
}
function answersItsParameter(x) {
  this.seen = true;
  return x;
}
function answersNothing(x) {
  this.x = x;
}
function answersText() {
  return "text";
}
let line = "";
for (let i = 0; i < 200; i++) {
  const object = { tag: "object" + i };
  const a = new answersSeven();
  const b = new answersItsParameter(5);
  const c = new answersItsParameter(object);
  const d = new answersItsParameter(null);
  const e = new answersNothing(i);
  const f = new answersText();
  const holder = { seen: false, answersItsParameter };
  line = [answersSeven(), typeof a, a instanceof answersSeven, typeof b, b.seen, c === object, c.seen, typeof d, d.seen, e.x, typeof f, holder.answersItsParameter(5), holder.seen].join();
}
console.log(line);

// new.target is kept, compared and read.
const targets = [];
class Base {
  constructor(tag) {
    this.tag = tag;
    this.madeAs = new.target.name;
    if (tag.endsWith("9")) targets.push(new.target);
  }
}
class Heir extends Base {}
function makeLocalClass(i) {
  const secret = { tag: "secret" + i };
  return class Local extends Base {
    static reveal() {
      return secret.tag;
    }
  };
}
function construct(C, tag) {
  return new C(tag);
}
let made = "";
for (let i = 0; i < 100; i++) made = construct(Base, "b" + i).madeAs + construct(Heir, "h" + i).madeAs + construct(makeLocalClass(i), "l" + i).madeAs;
console.log(made, churn(60), targets.length, targets.filter(t => t.reveal).map(t => t.reveal()).join());
function calledOrConstructed() {
  return new.target === undefined ? "called" : new.target === calledOrConstructed ? "constructed" : "constructed for " + new.target.name;
}
function wrapper(how) {
  if (how === 0) return calledOrConstructed();
  if (how === 1) return typeof new calledOrConstructed();
  return typeof Reflect.construct(calledOrConstructed, [], Heir);
}
console.log(wrapper(0), wrapper(1), wrapper(2));

// Reflect.construct with another new.target: the constructor's stores meet that prototype's setters, which keep `this` and the values.
const keptThis = [];
const keptValues = [];
class Point {
  constructor(x, label) {
    this.x = x;
    this.label = label;
  }
}
function Trap() {}
Trap.prototype = {
  set label(value) {
    keptThis.push(this);
    keptValues.push(value);
  },
  get label() {
    return { text: "from the trap" };
  },
};
function build(i) {
  const label = { text: "label" + i };
  return i % 60 === 59 ? Reflect.construct(Point, [i, label], Trap) : i % 60 === 58 ? Reflect.construct(Point, [i, label]) : new Point(i, label);
}
let labels = "";
for (let i = 0; i < 180; i++) {
  const p = build(i);
  if (i % 60 >= 57) labels += p.label.text + ":" + (p instanceof Point) + ":" + Object.keys(p).join("+") + " ";
}
console.log(labels, churn(60));
console.log(keptThis.map(t => t.x).join(), keptValues.map(v => v.text).join());

// An heir whose base answers another object: the heir's fields land on that object.
const handedOut = [];
class AnswersAnother {
  constructor(other) {
    return other;
  }
}
class Stamps extends AnswersAnother {
  stamp = "stamped";
  #secret = 1;
  static has(o) {
    return #secret in o;
  }
}
function stampIt(o) {
  return new Stamps(o);
}
let stamped = "";
for (let i = 0; i < 100; i++) {
  const mine = { tag: "mine" + i };
  const back = stampIt(mine);
  if (i % 40 === 39) handedOut.push(back);
  stamped = [back === mine, mine.stamp, Stamps.has(mine), Stamps.has({ tag: "x" }), back instanceof Stamps].join();
}
console.log(stamped, churn(40), handedOut.map(o => o.tag + o.stamp).join());

// A bound function, a Proxy and a class expression as what is constructed.
const BoundPoint = Point.bind(null, 42);
const log = [];
const ProxiedPoint = new Proxy(Point, {
  construct(target, args, newTarget) {
    log.push(args.length + ":" + (newTarget === ProxiedPoint));
    keptValues.push(args[1]);
    return Reflect.construct(target, args, newTarget);
  },
});
for (let i = 0; i < 3; i++) {
  const p = construct2(BoundPoint, { text: "bound" + i });
  const q = new ProxiedPoint(i, { text: "proxied" + i });
  log.push(p.x + p.label.text + (p instanceof Point) + q.label.text + (q instanceof ProxiedPoint));
}
function construct2(C, a) {
  return new C(a);
}
console.log(log.join(" "), churn(40), keptValues.slice(-3).map(v => v.text).join());
