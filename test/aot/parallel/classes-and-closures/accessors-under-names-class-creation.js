// A class has `constructor` on its prototype object and `name` and `length` on itself from its creation. An accessor that the class body defines under such a name takes the place of that property: with a setter alone a read answers undefined, and nothing from above shows through.
function tell(what, run) {
  try {
    const answer = run();
    console.log(what, typeof answer, typeof answer === "object" && answer !== null ? Object.getPrototypeOf(answer) === Object.prototype : String(answer));
  } catch (error) {
    console.log(what, "threw", error.name);
  }
}

class OnlySetter { set ["constructor"](value) {} }
const onlySetter = new OnlySetter();
tell("setter alone, read", () => onlySetter.constructor);
tell("setter alone, constructed", () => new onlySetter.constructor());
tell("setter alone, called", () => onlySetter.constructor());
tell("setter alone, compared", () => onlySetter.constructor === undefined);
tell("setter alone, name of it", () => onlySetter.constructor.name);

class OnlyGetter { get ["constructor"]() { return Array; } }
const onlyGetter = new OnlyGetter();
tell("getter, read", () => onlyGetter.constructor === Array);
tell("getter, constructed", () => Array.isArray(new onlyGetter.constructor()));

class Below extends OnlySetter {}
const below = new Below();
tell("its own below the setter", () => below.constructor === Below);
delete Below.prototype.constructor;
tell("the setter from below", () => below.constructor);
tell("the setter from below, constructed", () => new below.constructor());

class NameSetter { static set name(value) {} }
tell("static setter of name", () => NameSetter.name);
tell("static setter of name, its length", () => NameSetter.name.length);
class LengthSetter { static set length(value) {} constructor(a, b) {} }
tell("static setter of length", () => LengthSetter.length);
tell("static setter of length, added to", () => LengthSetter.length + 1);
class NameGetter { static get name() { return 7; } }
tell("static getter of name", () => NameGetter.name);

function again(value) {
  return new value.constructor();
}
tell("through a parameter", () => again(onlySetter));
tell("through a parameter, a plain class", () => again(new (class Plain {})()).constructor.name);
