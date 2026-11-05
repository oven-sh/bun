function describe(error) {
  const frames = [];
  for (const text of String(error.stack).split("\n")) {
    const frame = /^\s*at (?:(.*?) \()?([^()]*?):(\d+):(\d+)\)?$/.exec(text);
    if (!frame) continue;
    const name = frame[1] === "module code" || frame[1] === "<anonymous>" ? "" : (frame[1] ?? "");
    // A built-in function written in JavaScript keeps its `native:`. A Bun built with assertions counts other lines and columns in one, and run-parallel.ts knows them by that word.
    const place = (frame[2] === "native" ? "native:" : "") + frame[3] + ":" + frame[4];
    frames.push(frames.length ? name + ":" + place : name);
  }
  return error.name + ": " + error.message + ", stack " + frames.slice(0, 3).join(" | ");
}

function callWithoutNew(label, call) {
  try {
    call();
    console.log(label, "did not throw");
  } catch (error) {
    console.log(label, describe(error));
  }
}

class Empty {}
class AlsoEmpty {}
class WithConstructor {
  constructor(first, second) {
    this.first = first;
    this.second = second;
  }
}
class SameConstructor {
  constructor(first, second) {
    this.first = first;
    this.second = second;
  }
}
class Derived extends WithConstructor {}
class DerivedWithConstructor extends WithConstructor {
  constructor(first) {
    super(first, 1);
  }
}
const Expression = class {};
const Named = class Inner {
  constructor() {
    this.value = 1;
  }
};
class NeverConstructed {
  constructor(value) {
    this.value = value;
  }
}
class ConstructedHere {
  constructor(value) {
    this.value = value;
  }
}

function mixin(Base) {
  return class Mixed extends Base {
    constructor(...values) {
      super(...values);
      this.mixed = true;
    }
  };
}
const MixedOnce = mixin(WithConstructor);
const MixedTwice = mixin(MixedOnce);

function createClass(tag) {
  return class Created {
    constructor() {
      this.tag = tag;
    }
  };
}
const created = [createClass("a"), createClass("b")];

const holder = {
  Held: class {
    constructor() {
      this.held = true;
    }
  },
};

console.log(
  new ConstructedHere(1).value,
  new WithConstructor(1, 2).second,
  new SameConstructor(3, 4).first,
  new DerivedWithConstructor(5).first,
  new Derived(6, 7).second,
  new MixedTwice(8, 9).mixed,
  new created[0]().tag,
  new created[1]().tag,
  new Named().value,
  new holder.Held().held,
  typeof new Empty(),
  typeof new AlsoEmpty(),
  typeof new Expression(),
);

callWithoutNew("empty", () => Empty());
callWithoutNew("another empty one", () => AlsoEmpty());
callWithoutNew("constructor", () => WithConstructor(1, 2));
callWithoutNew("the same constructor", () => SameConstructor(1, 2));
callWithoutNew("derived", () => Derived(1, 2));
callWithoutNew("derived with a constructor", () => DerivedWithConstructor(1));
callWithoutNew("expression", () => Expression());
callWithoutNew("named expression", () => Named());
callWithoutNew("never constructed", () => NeverConstructed(1));
callWithoutNew("constructed at one place", () => ConstructedHere(1));
callWithoutNew("mixin", () => MixedOnce(1, 2));
callWithoutNew("mixin of a mixin", () => MixedTwice(1, 2));
for (const Created of created) callWithoutNew("created by a function", () => Created());
callWithoutNew("member", () => holder.Held());
callWithoutNew("call", () => WithConstructor.call({}, 1, 2));
callWithoutNew("apply", () => SameConstructor.apply({}, [1, 2]));
callWithoutNew("Reflect.apply", () => Reflect.apply(NeverConstructed, undefined, [1]));
callWithoutNew("bound", () => ConstructedHere.bind(null, 1)());
callWithoutNew("callback", () => [1].map(DerivedWithConstructor));
for (const Class of [WithConstructor, SameConstructor, DerivedWithConstructor, Named, NeverConstructed, ConstructedHere, MixedOnce, MixedTwice, holder.Held]) callWithoutNew("out of a list", () => Class());
