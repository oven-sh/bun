// A method that is read as a value is the object that the prototype holds, whichever road leads to it, before and after the first call, the first construction and the first look at the prototype.
class Base {
  constructor() {
    this.state = 1;
  }
  step() {
    return ++this.state;
  }
  static make() {
    return new this();
  }
  get size() {
    return this.state;
  }
}
class Derived extends Base {
  twice() {
    return this.state * 2;
  }
  step() {
    return super.step() + 1;
  }
}
const lines = [];
function say(name, answer) {
  lines.push(name + " " + answer);
}
function stepOf(o) {
  return o.step;
}
function twiceOf(o) {
  return o.twice;
}
const first = new Derived();
const early = stepOf(first);
say("before any look at the prototype", early === stepOf(new Derived()));
say("the prototype's own", early === Derived.prototype.step);
say("not the base's", early === Base.prototype.step);
say("base's by an object of the base", stepOf(new Base()) === Base.prototype.step);
say("inherited", twiceOf(first) === Derived.prototype.twice);
say("descriptor", Object.getOwnPropertyDescriptor(Derived.prototype, "step").value === early);
say("Reflect.get", Reflect.get(first, "step") === early);
say("computed", first["st" + "ep"] === early);
say("destructured", (({ step }) => step)(first) === early);
say("static", Base.make === Derived.make);
say("static by the class", Base.make === Object.getOwnPropertyDescriptor(Base, "make").value);
say("typeof", typeof first.step + " " + typeof first.twice + " " + typeof first.nothing + " " + typeof first.size);
say("truth", (first.step ? "yes" : "no") + " " + (first.nothing ? "yes" : "no"));
say("name and length", first.step.name + " " + first.step.length + " " + first.twice.name);
say("called by value", early.call(first) + " " + twiceOf(first).call(first) + " " + early.apply(new Derived(), []));
const bound = first.step.bind(first);
say("bound", bound() + " " + (bound === first.step.bind(first)) + " " + bound.name);
first.step.mark = 7;
say("a property on the function", Derived.prototype.step.mark + " " + stepOf(new Derived()).mark);
const kept = new Map([[first.step, "derived"], [new Base().step, "base"]]);
say("as a key", kept.get(Derived.prototype.step) + " " + kept.get(Base.prototype.step));
say("in an array", [first.step, first.twice].indexOf(Derived.prototype.twice));
say("prototype property", "prototype" in first.step);
try {
  new first.step();
} catch (error) {
  say("constructed", error.constructor.name);
}
console.log(lines.join("\n"));
