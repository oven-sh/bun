// A class that is called without `new` throws before its constructor runs: its frame stands at the start of the parameters, whatever the body does.
// An error out of making `this` is reported at the first expression of the body instead, so each class is asked for both.
const listFrames = error =>
  error.stack
    .split("\n")
    .slice(1, 4)
    .map(line => line.trim().replace(/\(?[^\s()]*[\\/]/, "("))
    .join(" | ");
function show(label, call) {
  try {
    call();
    console.log(label, "did not throw");
  } catch (error) {
    console.log(label, "|", error.message, "|", listFrames(error), "|", error.line, error.column);
  }
}
function log() {}
const outer = { value: 1 };

class StoresParameter { constructor(x) { this.x = x; } }
class StoresTwo {
  constructor(first, second) {
    this.first = first;
    this.second = second;
  }
}
class ParametersOverLines {
  constructor(
    first,
    second,
  ) {
    this.sum = first + second;
  }
}
class BraceOnNextLine {
  constructor(first)
  {
    this.first = first;
  }
}
class Calls { constructor() { log(); } }
class ReadsOuter { constructor() { this.value = outer.value; } }
class Declares { constructor(a) { const b = a; this.b = log(b); } }
class Branches { constructor(a) { if (a) { log(a); } } }
class Throws { constructor() { throw new Error("the body ran"); } }
class HasFields {
  field = log();
  constructor(x) {
    this.x = x;
  }
}
class BehindMethods {
  method() { return this.x; }
  get x() { return 1; }
  constructor(y) { this.y = y; }
}
class HasDefaults { constructor(a = 1, { b } = {}) { this.a = a; this.b = b; } }
class TakesRest { constructor(...values) { this.values = values; } }
class SpacedOut { constructor   (x) { this.x = x; } }
class QuotedName { "constructor"(x) { this.x = x; } }
class Derived extends StoresParameter { constructor(x) { super(x); this.y = x; } }
class DerivedStoresLate extends StoresParameter { constructor(x) { log(x); super(x); } }
const Expression = class { constructor(x) { this.x = x; } };
const Named = class Inner { constructor() { this.value = 1; } };
const holder = { Held: class { constructor() { this.held = true; } } };
function createClass(tag) {
  return class Created {
    constructor() {
      this.tag = tag;
    }
  };
}
class NeverConstructed { constructor(x) { this.x = x; } }

const classes = {
  StoresParameter, StoresTwo, ParametersOverLines, BraceOnNextLine, Calls, ReadsOuter, Declares, Branches, Throws, HasFields, BehindMethods,
  HasDefaults, TakesRest, SpacedOut, QuotedName, Derived, DerivedStoresLate, Expression, Named, Held: holder.Held, Created: createClass("a"),
};

show("written call", () => { StoresParameter(1); });
show("written call of one that is never constructed", () => { NeverConstructed(1); });
show("member", () => { holder.Held(); });
show("call", () => { StoresTwo.call({}, 1, 2); });
show("apply", () => { ParametersOverLines.apply({}, [1, 2]); });
show("Reflect.apply", () => { Reflect.apply(BraceOnNextLine, undefined, [1]); });
show("bound", () => { HasFields.bind(null, 1)(); });
show("callback", () => { [1].map(BehindMethods); });

for (const [name, Class] of Object.entries(classes)) {
  show(name + " without new", () => { Class(1, 2); });
  if (Class !== Throws) new Class(1, 2);
  show(name + " without new, once constructed", () => { Class(1, 2); });
  const prototypeThrows = new Proxy(Class, {
    get(target, key) {
      if (key === "prototype") throw new Error("the prototype was read");
      return target[key];
    },
  });
  show(name + " making this", () => { new prototypeThrows(1, 2); });
}
