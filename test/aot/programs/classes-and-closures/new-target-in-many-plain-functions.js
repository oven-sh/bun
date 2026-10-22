// Many plain functions that read new.target, constructed and called from native code: each reaches its own body, with its own arguments, and sees new.target only when constructed.
function Other() {}
Other.prototype = { marker: "Other.prototype" };

function describe(target, self) {
  if (target === undefined) return "undefined";
  if (target === Other) return "Other";
  return target === self ? "itself" : target.name;
}

function record(receiver, name, target, values) {
  receiver.seen = name + " " + target + " [" + values.join(",") + "]";
}

function Zero() { record(this, "Zero", describe(new.target, Zero), [arguments.length]); }
function IgnoresTargetA(a) { record(this, "IgnoresTargetA", "unread", [a]); }
function One(a) { record(this, "One", describe(new.target, One), [a]); }
function Two(a, b) { record(this, "Two", describe(new.target, Two), [a, b]); }
class ClassBetween {
  constructor(a) {
    record(this, "ClassBetween", describe(new.target, ClassBetween), [a]);
  }
}
function Three(a, b, c) { record(this, "Three", describe(new.target, Three), [a, b, c]); }
function Four(a, b, c, d) { record(this, "Four", describe(new.target, Four), [a, b, c, d]); }
function IgnoresTargetB(a, b) { record(this, "IgnoresTargetB", "unread", [a, b]); }
function Five(a, b, c, d, e) { record(this, "Five", describe(new.target, Five), [a, b, c, d, e]); }
function Six(a, b, c, d, e, f) { record(this, "Six", describe(new.target, Six), [a, b, c, d, e, f]); }
function Seven(a, b, c, d, e, f, g) { record(this, "Seven", describe(new.target, Seven), [a, b, c, d, e, f, g]); }
function Eight(a, b, c, d, e, f, g, h) { record(this, "Eight", describe(new.target, Eight), [a, b, c, d, e, f, g, h]); }
function Twelve(a, b, c, d, e, f, g, h, i, j, k, l) { record(this, "Twelve", describe(new.target, Twelve), [a, b, c, d, e, f, g, h, i, j, k, l]); }
function Rest(...values) { record(this, "Rest", describe(new.target, Rest), values); }
function CallsItself(a) {
  if (!new.target) return new CallsItself(a);
  record(this, "CallsItself", describe(new.target, CallsItself), [a]);
}

const plainFunctions = [Zero, IgnoresTargetA, One, Two, Three, Four, IgnoresTargetB, Five, Six, Seven, Eight, Twelve, Rest, CallsItself];
const argumentLists = [[], [1], [1, 2, 3], [1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]];

function prototypeName(object) {
  const prototype = Object.getPrototypeOf(object);
  return prototype === Other.prototype ? "Other.prototype" : prototype.constructor.name + ".prototype";
}

for (let round = 0; round < 2; round++) {
  for (const F of [...plainFunctions, ClassBetween]) {
    for (const list of argumentLists) {
      const withItself = Reflect.construct(F, list);
      const withOther = Reflect.construct(F, list, Other);
      console.log(withItself.seen, prototypeName(withItself), "|", withOther.seen, prototypeName(withOther));
    }
    const bound = new (F.bind(null, "bound"))("passed");
    console.log(bound.seen, prototypeName(bound));
  }
}

for (const F of plainFunctions) {
  const receiver = {};
  const result = Reflect.apply(F, receiver, [1, 2]);
  console.log(F.name, "called:", receiver.seen, result === undefined ? "undefined" : result.seen);
}

console.log([1, 2].map(CallsItself).map(object => object.seen).join(" | "));
