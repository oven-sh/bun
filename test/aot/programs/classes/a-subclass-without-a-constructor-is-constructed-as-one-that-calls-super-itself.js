// A class below another that writes no constructor hands every argument on. What its parent sees, returns, throws and reads of new.target is what it sees under `constructor(...args) { super(...args) }`,
// whichever parent the class object inherits from at that moment, and whatever the program has done to the way arrays are iterated.
const lines = [];
const say = (...parts) => lines.push(parts.join(" "));
const kept = [];

class Plain {
  id = 1;
}
class Stamped extends Plain {
  stamp = 7;
}
for (let i = 0; i < 3; i++) kept.push(new Stamped());
say("fields", kept.map(value => Object.keys(value).join() + ":" + value.id + value.stamp + (value instanceof Stamped) + (Object.getPrototypeOf(value) === Stamped.prototype)).join(" "));

class Pair {
  constructor(first, second) {
    this.first = first;
    this.second = second;
  }
}
class NamedPair extends Pair {
  name = "pair";
}
for (const made of [new NamedPair(), new NamedPair(1), new NamedPair(1, 2), new NamedPair(1, 2, 3), new NamedPair(undefined, null), new NamedPair(...[, 4])])
  say("positions", Object.keys(made).join(), String(made.first), String(made.second), made.name);

class WithDefaults {
  constructor(size = 5, unit = "px" + size) {
    this.text = size + unit;
  }
}
class BelowDefaults extends WithDefaults {}
say("defaults", new BelowDefaults().text, new BelowDefaults(undefined).text, new BelowDefaults(2).text, new BelowDefaults(2, "em").text);

class Counts {
  constructor(first) {
    this.count = arguments.length;
    this.last = arguments[arguments.length - 1];
  }
}
class BelowCounts extends Counts {
  extra = true;
}
say("counted", new BelowCounts().count, new BelowCounts(1, 2, 3).count, new BelowCounts(1, 2, 3).last);

class Gathers {
  constructor(...all) {
    all.push("end");
    this.all = all;
  }
}
class BelowGathers extends Gathers {}
class FarBelowGathers extends BelowGathers {
  depth = 2;
}
say("gathered", new BelowGathers(1, 2).all.join(), new FarBelowGathers().all.join(), new FarBelowGathers("a").all.join(), new FarBelowGathers("a").depth);

class Level0 {
  constructor(value) {
    this.value = value;
  }
}
class Level1 extends Level0 {
  one = 1;
}
class Level2 extends Level1 {
  two = 2;
}
class Level3 extends Level2 {}
for (let i = 0; i < 3; i++) kept.push(new Level3(i));
say("chain", kept.slice(-3).map(made => Object.keys(made).join() + made.value + made.one + made.two + made.constructor.name).join(" "));

class Replaces {
  constructor(other) {
    if (other) return other;
  }
}
class BelowReplaces extends Replaces {
  mark = "set";
}
const stranger = { own: 1 };
const handedBack = new BelowReplaces(stranger);
say("returned", handedBack === stranger, Object.keys(stranger).join(), handedBack instanceof BelowReplaces, new BelowReplaces() instanceof BelowReplaces, new BelowReplaces(0).mark);

class AsksTarget {
  constructor() {
    this.target = new.target.name;
    this.isOwn = new.target === AsksTarget;
  }
}
class BelowAsksTarget extends AsksTarget {}
class FarBelowAsksTarget extends BelowAsksTarget {}
say("target", new BelowAsksTarget().target, new FarBelowAsksTarget().target, new AsksTarget().isOwn, new BelowAsksTarget().isOwn);
const reflected = Reflect.construct(BelowAsksTarget, [], Stamped);
say("reflected", reflected.target, reflected instanceof Stamped, reflected instanceof BelowAsksTarget, Object.keys(reflected).join());
const reflectedFields = Reflect.construct(Stamped, [], Pair);
say("reflected fields", reflectedFields instanceof Pair, reflectedFields instanceof Stamped, Object.keys(reflectedFields).join(), reflectedFields.id, reflectedFields.stamp);

class Throws {
  constructor(when) {
    if (when) throw new RangeError("no " + when);
    this.fine = true;
  }
}
class BelowThrows extends Throws {
  after = say("initializer ran");
}
try {
  new BelowThrows("luck");
} catch (error) {
  say("thrown", error.name, error.message);
}
say("not thrown", new BelowThrows().fine);

class FirstParent {
  constructor(value) {
    this.from = "first" + value;
  }
}
class SecondParent {
  constructor(value, other) {
    this.from = "second" + value + other;
  }
}
class Moves extends FirstParent {
  moved = 1;
}
function makeMoves(value) {
  return new Moves(value, "!");
}
say("parent", makeMoves(1).from, makeMoves(1) instanceof FirstParent);
Object.setPrototypeOf(Moves, SecondParent);
say("parent", makeMoves(2).from, makeMoves(2) instanceof FirstParent, Object.keys(makeMoves(2)).join());
Object.setPrototypeOf(Moves, function (value) { this.from = "plain" + value; });
say("parent", makeMoves(3).from, Object.keys(makeMoves(3)).join());
Object.setPrototypeOf(Moves, FirstParent);
say("parent", makeMoves(4).from);

const mix = Base => class extends Base {
  mixed = "in";
};
const MixedPair = mix(Pair), MixedPlain = mix(Plain), MixedTwice = mix(mix(Level0));
for (let i = 0; i < 2; i++)
  say("mixed", Object.keys(new MixedPair(i, 2)).join(), new MixedPair(i, 2).first, Object.keys(new MixedPlain()).join(), Object.keys(new MixedTwice(i)).join(), new MixedTwice(i).value, new MixedPlain() instanceof Plain);

class Spreads extends Pair {
  constructor(...args) {
    super(...args);
    this.given = args.length;
    args.length = 0;
  }
}
say("spread", new Spreads(1, 2, 3).given, new Spreads(1).first, String(new Spreads(1).second));

let steps = 0;
const iterate = Array.prototype[Symbol.iterator];
try {
  Array.prototype[Symbol.iterator] = function () {
    steps++;
    return iterate.call(this);
  };
} catch {}
say("iteration", new NamedPair(8, 9).second, steps);

console.log(lines.join("\n"));
