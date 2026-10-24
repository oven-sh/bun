// Classes whose fields hold closures are extended, constructed for another new.target, constructed through values, and their constructors return other objects.
const lines = [];
function say(...values) {
  lines.push(values.map(String).join(" "));
}
function attempt(action) {
  try {
    return String(action());
  } catch (error) {
    return error.constructor.name;
  }
}

class Base {
  #secret;
  name = "base";
  who = () => this.name + ":" + this.#secret;
  kind = () => this.constructor.name;
  constructor(secret) {
    this.#secret = secret;
  }
  static reveal(object) {
    return #secret in object;
  }
}
class Below extends Base {
  extra = () => this.who() + "!";
  name = "below";
}
class Deeper extends Below {
  who = () => "deeper " + this.name;
  constructor() {
    super("d");
    this.late = () => this.extra();
  }
}
class Unrelated {
  other = () => "other";
}
function Ordinary() {}
Ordinary.prototype.marker = "ordinary";

const all = [];
for (let i = 0; i < 6; i++) all.push(new Base("s" + i), new Below("t" + i), new Deeper());
say("who", all.map(object => object.who()).join());
say("kind", all.slice(0, 3).map(object => object.kind()).join(), all[1].extra(), all[2].extra(), all[2].late());
say("keys", all.slice(0, 3).map(object => Object.keys(object).join("+")).join());
say("identity", all[0].who === all[0].who, all[0].who !== all[3].who, all[1].who === all[1].who, all[1].who !== all[4].who, all[2].who === all[2].who, all[2].late === all[2].late);

// Another new.target.
const targets = [Base, Below, Deeper, Unrelated, Ordinary, Object, function () {}, class extends Base {}, Base.bind(null), new Proxy(Base, {}), new Proxy(Unrelated, {})];
for (const target of targets) {
  const made = Reflect.construct(Base, ["r"], target);
  say("for " + (target.name || "anonymous"), made.who(), attempt(() => made.kind()), Object.keys(made).join("+"), made instanceof Base, Object.getPrototypeOf(made) === target.prototype, made.who === made.who, Base.reveal(made), made.marker, typeof made.extra, typeof made.other);
}
const forBelow = Reflect.construct(Below, ["q"], Base);
say("Below for Base", forBelow.who(), forBelow.extra(), Object.keys(forBelow).join("+"), forBelow instanceof Below, forBelow instanceof Base);
const forUnrelated = Reflect.construct(Unrelated, [], Base);
say("Unrelated for Base", forUnrelated.other(), Object.keys(forUnrelated).join("+"), forUnrelated instanceof Base, typeof forUnrelated.who, Base.reveal(forUnrelated));

// new.target whose prototype changes or is no object.
function Changing() {}
const first = Reflect.construct(Base, ["c1"], Changing);
Changing.prototype = { changed: true };
const second = Reflect.construct(Base, ["c2"], Changing);
Changing.prototype = 5;
const third = Reflect.construct(Base, ["c3"], Changing);
say("changing", first.who(), first.changed, second.who(), second.changed, third.who(), Object.getPrototypeOf(third) === Object.prototype);

// The prototype of the class itself is changed afterwards.
class Moved {
  run = () => this.up();
  up() {
    return "first";
  }
}
const movedBefore = new Moved();
Object.setPrototypeOf(Moved.prototype, { inherited: () => "inherited" });
Moved.prototype.up = function () {
  return "second";
};
const movedAfter = new Moved();
say("moved", movedBefore.run(), movedAfter.run(), movedAfter.inherited(), movedBefore.run !== movedAfter.run);
const reparented = new Moved();
Object.setPrototypeOf(reparented, { up: () => "reparented", run: "shadowed" });
say("reparented", reparented.run(), Object.keys(reparented).join(), delete reparented.run, reparented.run);

// Constructed through values.
function construct(Class, ...args) {
  return new Class(...args);
}
const classes = [Base, Below, Deeper, Unrelated];
say("through values", classes.map(Class => Object.keys(construct(Class, "v")).join("+")).join(), construct(classes[1], "w").extra());

// A constructor that returns another object: the fields go to what super() answers.
class ReturnsOther {
  constructor(target) {
    return target;
  }
}
class Stamps extends ReturnsOther {
  stamp = () => this.label + " stamped";
}
const target = { label: "target" };
const stamped = new Stamps(target);
say("stamped", stamped === target, target.stamp(), Object.keys(target).join(), target.stamp === target.stamp);
const stampedAgain = new Stamps(target);
say("stamped again", stampedAgain === target, Object.keys(target).join(), target.stamp());
const stampedBase = new Stamps(new Base("sb"));
say("stamped an instance", stampedBase.who(), Object.keys(stampedBase).join("+"), attempt(() => stampedBase.stamp()));
say("stamped a frozen object", attempt(() => new Stamps(Object.freeze({ label: "frozen" }))));
const stampedArray = new Stamps([1, 2]);
say("stamped an array", Object.keys(stampedArray).join(), stampedArray.stamp());

// A base constructor that calls what the subclass overrides, before the fields of the subclass exist.
class CallsDown {
  seen = this.describe();
  describe() {
    return "base";
  }
}
class Overrides extends CallsDown {
  tell = () => "told";
  describe() {
    return typeof this.tell + ":" + Object.keys(this).join("+");
  }
}
say("calls down", new Overrides().seen, new Overrides().describe(), new CallsDown().seen);

// A class evaluated several times.
function classOf(label) {
  return class {
    label = () => label;
    self = () => this;
  };
}
const evaluated = [classOf("x"), classOf("y")];
const instances = evaluated.flatMap(Class => [new Class(), new Class()]);
say("evaluated twice", instances.map(instance => instance.label()).join(), instances.every(instance => instance.self() === instance), instances[0].label !== instances[1].label, instances[0] instanceof evaluated[1]);

console.log(lines.join("\n"));
