// What the text of a direct eval sees as this, super and new.target.
export {};

function show(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, "throws", error.name);
  }
}

const receiver = {
  id: "receiver",
  method() {
    return eval("this.id");
  },
  arrow() {
    return (() => eval("this.id"))();
  },
};
show("this in a method", () => receiver.method());
show("this in an arrow function", () => receiver.arrow());

class Fields {
  id = "field";
  seen = eval("this.id");
}
show("this in a field initializer", () => new Fields().seen);

class Base {
  constructor() {
    this.id = "base";
  }
  method() {
    return "base method";
  }
}
class Derived extends Base {
  constructor() {
    let before;
    try {
      eval("this");
    } catch (error) {
      before = error.name;
    }
    super();
    this.before = before;
    this.after = eval("this.id");
  }
  method() {
    return eval("super.method()");
  }
}
const derived = new Derived();
show("this before super()", () => derived.before);
show("this after super()", () => derived.after);
show("super in a class method", () => derived.method());

class MentionsThis extends Base {
  constructor() {
    const skipped = eval("false && this");
    const steps = [];
    try {
      eval("steps.push('ran'); this");
    } catch (error) {
      steps.push(error.name);
    }
    super();
    this.skipped = skipped;
    this.steps = steps;
  }
}
show("this mentioned but not read before super()", () => new MentionsThis().skipped);
show("this read after other code before super()", () => new MentionsThis().steps);

const parent = {
  method() {
    return "parent";
  },
};
const other = {
  method() {
    return "other";
  },
};
const home = {
  __proto__: parent,
  method() {
    return eval("super.method()");
  },
};
show("super in an object method", () => home.method());
Object.setPrototypeOf(home, other);
show("super after setPrototypeOf", () => home.method());

function readsNewTarget() {
  return eval("new.target");
}
function StoresNewTarget() {
  this.isSelf = eval("new.target") === StoresNewTarget;
  this.isSelfInArrow = (() => eval("new.target"))() === StoresNewTarget;
}
show("new.target in a call", () => readsNewTarget());
show("new.target in a construct", () => new StoresNewTarget().isSelf);
show("new.target in an arrow function", () => new StoresNewTarget().isSelfInArrow);

function readsSuperProperty() {
  return eval("super.x");
}
show("super in a plain function", readsSuperProperty);
show("new.target at top level", () => eval("new.target"));
