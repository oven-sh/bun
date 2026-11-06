// A class whose chain ends in a built-in class of the engine, with constant member names and nothing that runs at its definition, is made from its record when somebody first touches it.
// Each class here is touched first in another way: by new, by instanceof, through a class below it, by a static member, by a look at its prototype chain, by being handed to a function.
// What runs at a definition by the language runs there: static blocks, static initializers, computed names, a call that takes the class expression. The output is that of plain Bun.
const log: string[] = [];
function say(...parts: unknown[]) {
  log.push(parts.map(part => String(part)).join(" "));
}

class ByNew extends Error {
  code = 1;
  constructor(message: string) {
    super(message);
    this.name = "ByNew";
  }
  describe() {
    return this.name + ":" + this.message + ":" + this.code;
  }
}
class ByInstanceOf extends Error {}
class Above extends TypeError {
  where() {
    return "above";
  }
}
class Below extends Above {
  where() {
    return "below " + super.where();
  }
}
class ByStatic extends Map<string, number> {
  static make() {
    return new ByStatic([["a", 1]]);
  }
  total() {
    let sum = 0;
    for (const value of this.values()) sum += value;
    return sum;
  }
}
class ByChain extends Set<number> {}
class HandedOn extends Array<number> {
  sum() {
    return this.reduce((a, b) => a + b, 0);
  }
}
class NeverTouched extends RangeError {
  never() {
    return 1;
  }
}
class OfPromise extends Promise<number> {}
class OfRegExp extends RegExp {
  twice(text: string) {
    return this.test(text) && this.test(text);
  }
}
class OfBytes extends Uint8Array {
  first() {
    return this[0];
  }
}
class OfObject extends Object {
  own = 5;
}
class OfDate extends Date {
  year() {
    return this.getUTCFullYear();
  }
}

function touchEach() {
say("start");
const made = new ByNew("m");
say(made.describe(), made instanceof ByNew, made instanceof Error, Object.getPrototypeOf(ByNew) === Error, made.stack!.split("\n")[0]);
say(({}) instanceof ByInstanceOf, new Error("x") instanceof ByInstanceOf, new ByInstanceOf("y") instanceof ByInstanceOf, ByInstanceOf.name, ByInstanceOf.length);
const below = new Below("b");
say(below.where(), below instanceof Above, below instanceof TypeError, below instanceof Error, Object.getPrototypeOf(Below) === Above, Object.getPrototypeOf(Above) === TypeError);
say(ByStatic.make().total(), ByStatic.make() instanceof Map, Object.getPrototypeOf(ByStatic.prototype) === Map.prototype);
say(Object.getPrototypeOf(ByChain) === Set, Object.getPrototypeOf(ByChain.prototype) === Set.prototype, Object.getOwnPropertyNames(ByChain.prototype).join(), Object.getOwnPropertyNames(ByChain).sort().join());
function take(constructor: new (...items: number[]) => HandedOn) {
  const list = new constructor(1, 2, 3);
  return [list.sum(), list.length, list.map(x => x * 2) instanceof HandedOn, Array.isArray(list)].join();
}
say(take(HandedOn));
say(OfPromise.resolve(1) instanceof OfPromise, OfPromise.resolve(1).then(x => x) instanceof OfPromise);
say(new OfRegExp("a+").twice("caat"), new OfRegExp("a", "g").flags, "xay".replace(new OfRegExp("a"), "-"));
say(new OfBytes([7, 8]).first(), new OfBytes(2).length, new OfBytes([1]).subarray(0) instanceof OfBytes);
say(new OfObject().own, new OfObject() instanceof Object, Object.getPrototypeOf(OfObject) === Object);
say(new OfDate(0).year(), new OfDate(0) instanceof Date);
}
touchEach();

// The global is replaced between a definition and the first touch of the class: the class extends what the name held at the definition.
class BeforeReplacement extends EvalError {}
const realEvalError = EvalError;
(globalThis as any).EvalError = class Fake {};
function touchBeforeReplacement() {
  say(Object.getPrototypeOf(BeforeReplacement) === realEvalError, new BeforeReplacement("e") instanceof realEvalError, new BeforeReplacement("e") instanceof (globalThis as any).EvalError);
}
touchBeforeReplacement();
class AfterReplacement extends (globalThis as any).EvalError {}
say(Object.getPrototypeOf(AfterReplacement) === realEvalError, Object.getPrototypeOf(AfterReplacement).name);
(globalThis as any).EvalError = realEvalError;

// The parent's prototype object gains and loses members before the first touch.
class SeesLaterMembers extends URIError {}
(URIError.prototype as any).added = function () {
  return "added " + this.message;
};
function touchSeesLaterMembers() {
  return (new SeesLaterMembers("u") as any).added;
}
say(touchSeesLaterMembers().call(new SeesLaterMembers("u")));
delete (URIError.prototype as any).added;
say(touchSeesLaterMembers());

// The dead zone.
function tooEarly() {
  return new Late("early").message;
}
try {
  say(tooEarly());
} catch (error) {
  say((error as Error).constructor === ReferenceError);
}
class Late extends Error {}
say(new Late("late").message);

// What runs at the definition.
class WithStaticBlock extends Error {
  static {
    say("static block of", this.name);
  }
}
class WithStaticInitializer extends Error {
  static made = (say("static initializer"), 1);
}
const key = (say("computed name"), "computed");
class WithComputedName extends Error {
  [key]() {
    return 2;
  }
}
function register<T>(constructor: T): T {
  say("registered", (constructor as any).name);
  return constructor;
}
const Registered = register(class Inner extends Error {});
say("after the definitions", WithStaticInitializer.made, new WithComputedName().computed(), new Registered("r").message, new WithStaticBlock("s").message);

// A class in a function is another class each time.
function factory(tag: string) {
  return class Made extends Error {
    tag() {
      return tag;
    }
  };
}
const one = factory("one"), two = factory("two");
say(one === two, new one().tag(), new two().tag(), new one() instanceof two);

// Members of the class itself are changed before anything else touches it.
class ChangedFirst extends Error {
  value() {
    return 1;
  }
}
function changeFirst() {
  ChangedFirst.prototype.value = function () {
    return 2;
  };
  say(new ChangedFirst().value());
}
changeFirst();
class ParentChangedFirst extends Error {}
function changeParentFirst() {
  Object.setPrototypeOf(ParentChangedFirst, Function.prototype);
  Object.setPrototypeOf(ParentChangedFirst.prototype, Object.prototype);
  say(Object.getPrototypeOf(ParentChangedFirst) === Function.prototype, ParentChangedFirst.prototype instanceof Error);
}
changeParentFirst();

function neverCalled() {
  return new NeverTouched("n").never();
}
say(log.length > 1000 ? neverCalled() : "end");
OfPromise.resolve(4).then(value => {
  say(value);
  console.log(log.join("\n"));
});
