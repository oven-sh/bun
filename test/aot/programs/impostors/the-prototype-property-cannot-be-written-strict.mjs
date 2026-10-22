function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " -> threw " + error.constructor.name);
  }
}

console.log("strict code:", (function () { return this === undefined; })());

function Parent() {
  this.fromParent = true;
}
Parent.prototype.who = function () {
  return "parent";
};

function makeLocked() {
  return new Locked();
}

function makeFrozenPrototype() {
  return new FrozenPrototype();
}

function makeFrozenMaker() {
  return new FrozenMaker();
}

function makeModern() {
  return new Modern();
}

function whoIs(thing) {
  return thing.who();
}

function Locked() {
  Parent.call(this);
}
Locked.prototype.who = function () {
  return "the first prototype of Locked";
};
Object.defineProperty(Locked, "prototype", { writable: false });
attempt("a store to a prototype property that cannot be written", () => {
  Locked.prototype = Object.create(Parent.prototype);
  return "no error";
});
attempt("an instance after the failed store", () => whoIs(makeLocked()));
attempt("instanceof Parent", () => makeLocked() instanceof Parent);
attempt("members of the locked prototype can still be stored", () => {
  Locked.prototype.who = function () { return "patched"; };
  return whoIs(makeLocked());
});
attempt("and it can still be moved under Parent", () => {
  Object.setPrototypeOf(Locked.prototype, Parent.prototype);
  delete Locked.prototype.who;
  return [whoIs(makeLocked()), makeLocked() instanceof Parent];
});

class Modern {
  who() {
    return "modern";
  }
}
attempt("a store to the prototype property of a class", () => {
  Modern.prototype = Object.create(Parent.prototype);
  return "no error";
});
attempt("an instance of the class after that", () => whoIs(makeModern()));

function FrozenMaker() {
  this.made = true;
}
FrozenMaker.prototype.who = function () {
  return "frozen maker";
};
Object.freeze(FrozenMaker);
attempt("a store to the prototype property of a frozen function", () => {
  FrozenMaker.prototype = { who: () => "replaced" };
  return "no error";
});
attempt("a static member stored on a frozen function", () => {
  FrozenMaker.extra = 1;
  return FrozenMaker.extra;
});
attempt("an instance of it", () => whoIs(makeFrozenMaker()));

function FrozenPrototype() {
  this.made = true;
}
FrozenPrototype.prototype.who = function () {
  return "frozen prototype";
};
Object.freeze(FrozenPrototype.prototype);
attempt("a method stored on a frozen prototype", () => {
  FrozenPrototype.prototype.who = function () { return "patched"; };
  return whoIs(makeFrozenPrototype());
});
attempt("a new method stored on a frozen prototype", () => {
  FrozenPrototype.prototype.more = function () { return "more"; };
  return typeof makeFrozenPrototype().more;
});
attempt("an instance shadows a method of a frozen prototype", () => {
  const instance = makeFrozenPrototype();
  instance.who = function () { return "shadow"; };
  return [whoIs(instance), Object.hasOwn(instance, "who")];
});
attempt("a frozen prototype moved under Parent", () => {
  Object.setPrototypeOf(FrozenPrototype.prototype, Parent.prototype);
  return "no error";
});
attempt("the prototype property itself can still be replaced", () => {
  FrozenPrototype.prototype = Object.create(Parent.prototype);
  return whoIs(makeFrozenPrototype());
});

const arrow = () => {};
attempt("a prototype stored on an arrow function", () => {
  arrow.prototype = Parent.prototype;
  return [Object.create(Parent.prototype) instanceof arrow, typeof arrow.prototype];
});
attempt("new of that arrow function", () => new arrow());

const bound = Parent.bind(null);
attempt("a prototype stored on a bound function", () => {
  bound.prototype = { who: () => "the bound function's prototype" };
  return whoIs(new bound());
});

let length = 0;
for (let i = 0; i < 2000; i++) length += whoIs(makeLocked()).length + whoIs(makeModern()).length + whoIs(makeFrozenMaker()).length;
console.log("2000 rounds at the end", length);

export {};
