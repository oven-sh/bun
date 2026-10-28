const lines = [];
function say(label, value) {
  lines.push(label + ": " + String(value));
}
function attempt(run) {
  try {
    return String(run());
  } catch (error) {
    return error.constructor.name;
  }
}

class UnderItsOwnName {
  base = 3;
  constructor(base) {
    if (base !== undefined)
      this.base = base;
    this.add = this.add.bind(this);
  }
  add(n) {
    return this.base + n;
  }
}

class UnderAnotherName {
  base = 5;
  bound;
  constructor() {
    this.bound = this.add.bind(this);
  }
  add(n) {
    return this.base + n;
  }
}

class WithAnArgument {
  base = 7;
  constructor() {
    this.add = this.add.bind(this, 100);
  }
  add(first, second = 1) {
    return this.base + first * 2 + second;
  }
}

class Parent {
  base = 11;
  constructor() {
    this.add = this.add.bind(this);
  }
  add(n) {
    return this.base + n;
  }
}

class HeirThatOverrides extends Parent {
  add(n) {
    return this.base * 2 + n;
  }
}

class HeirThatInherits extends Parent {
  extra = 1;
}

class BoundTwice {
  base = 13;
  constructor() {
    this.add = this.add.bind(this);
    this.add = this.add.bind({ base: 1000 });
  }
  add(n) {
    return this.base + n;
  }
}

class BoundToAnother {
  base = 17;
  constructor(other) {
    this.add = this.add.bind(other);
  }
  add(n) {
    return this.base + n;
  }
}

class BoundInAField {
  base = 19;
  add = this.plain.bind(this);
  plain(n) {
    return this.base + n;
  }
}

class BoundOnlySometimes {
  base = 23;
  constructor(binds) {
    if (binds)
      this.add = this.add.bind(this);
  }
  add(n) {
    return (this === undefined ? -1000 : this.base) + n;
  }
}

class ReadsItsArguments {
  base = 29;
  constructor() {
    this.add = this.add.bind(this);
  }
  add(..._values) {
    let sum = this.base;
    for (let k = 0;k < arguments.length; k++)
      sum += arguments[k];
    return sum;
  }
}
function Old(base) {
  this.base = base;
  this.add = this.add.bind(this);
}
Old.prototype.add = function(n) {
  return this.base + n;
};
const makers = [
  ["under its own name", () => new UnderItsOwnName],
  ["under its own name, another base", () => new UnderItsOwnName(4)],
  ["with an argument", () => new WithAnArgument],
  ["parent", () => new Parent],
  ["heir that overrides", () => new HeirThatOverrides],
  ["heir that inherits", () => new HeirThatInherits],
  ["bound twice", () => new BoundTwice],
  ["bound to another", () => new BoundToAnother({ base: 170 })],
  ["bound in a field", () => new BoundInAField],
  ["bound", () => new BoundOnlySometimes(true)],
  ["not bound", () => new BoundOnlySometimes(false)],
  ["reads its arguments", () => new ReadsItsArguments],
  ["constructor function", () => new Old(31)],
  ["the field is taken away", () => {
    const made = new UnderItsOwnName;
    delete made.add;
    return made;
  }],
  ["the field holds the method", () => {
    const made = new UnderItsOwnName;
    made.add = UnderItsOwnName.prototype.add;
    return made;
  }],
  ["the field holds an arrow", () => {
    const made = new UnderItsOwnName;
    made.add = (n) => n - 1;
    return made;
  }],
  ["the field holds what another has bound", () => {
    const made = new UnderItsOwnName;
    made.add = new UnderItsOwnName(400).add;
    return made;
  }],
  ["the field holds what another class has bound", () => {
    const made = new UnderItsOwnName;
    made.add = new Parent().add;
    return made;
  }],
  ["the field holds a number", () => {
    const made = new UnderItsOwnName;
    made.add = 5;
    return made;
  }],
  ["the field holds undefined", () => {
    const made = new UnderItsOwnName;
    made.add = undefined;
    return made;
  }],
  ["the field is an accessor", () => {
    const made = new UnderItsOwnName;
    Object.defineProperty(made, "add", { get() {
      return (n) => n * 3;
    }, configurable: true });
    return made;
  }],
  ["frozen", () => Object.freeze(new UnderItsOwnName)],
  ["the base changes", () => {
    const made = new UnderItsOwnName;
    made.base = 33;
    return made;
  }]
];
const uses = [
  ["as a member", (made, n) => made.add(n)],
  ["as a value", (made, n) => {
    const add = made.add;
    return add(n);
  }],
  ["taken apart", (made, n) => {
    const { add } = made;
    return add(n);
  }],
  ["by call", (made, n) => made.add.call({ base: 9000 }, n)],
  ["by apply", (made, n) => made.add.apply({ base: 9000 }, [n])],
  ["by Reflect.apply", (made, n) => Reflect.apply(made.add, { base: 9000 }, [n])],
  ["on another object", (made, n) => {
    const other = { base: 7000, add: made.add };
    return other.add(n);
  }],
  ["handed to map", (made, n) => [n, n + 1].map(made.add).join()],
  ["handed to a function", (made, n) => twice(made.add, n)],
  ["with no argument", (made) => made.add()],
  ["with three arguments", (made, n) => made.add(n, 1, 2)],
  ["with a text", (made) => made.add("x")],
  ["spread", (made, n) => made.add(...[n, 2])],
  ["bound again", (made, n) => made.add.bind({ base: 5000 })(n)],
  ["bound again with an argument", (made, n) => made.add.bind(null, n)()],
  ["optional", (made, n) => made.add?.(n)]
];
function twice(f, n) {
  return f(f(n));
}
for (const [how, make] of makers) {
  for (const [use, run] of uses) {
    const kept = make();
    const once = attempt(() => run(kept, 1));
    let often = 0;
    let failures = 0;
    for (let i = 0;i < 3000; i++) {
      try {
        const answer = run(kept, i & 7);
        often = often + (typeof answer === "number" ? answer : String(answer).length) | 0;
      } catch {
        failures++;
      }
    }
    let onNewObjects = 0;
    for (let i = 0;i < 300; i++) {
      try {
        const answer = run(make(), i & 7);
        onNewObjects = onNewObjects + (typeof answer === "number" ? answer : String(answer).length) | 0;
      } catch {
        failures++;
      }
    }
    say(how + ", " + use, [once, often, onNewObjects, failures, attempt(() => run(kept, 2))].join(" "));
  }
}
for (const [how, make] of makers) {
  const made = make();
  const add = made.add;
  say(how + ", asked", [
    typeof add,
    attempt(() => add.name),
    attempt(() => add.length),
    attempt(() => Object.hasOwn(add, "prototype")),
    attempt(() => Object.getOwnPropertyNames(add).sort().join()),
    attempt(() => add === made.add),
    attempt(() => add === Object.getPrototypeOf(made).add),
    attempt(() => Object.hasOwn(made, "add")),
    attempt(() => Object.keys(made).join()),
    attempt(() => /native code/.test(String(add))),
    attempt(() => typeof new add(1)),
    attempt(() => Object.getPrototypeOf(add) === Function.prototype)
  ].join(" | "));
}
function constructsAndCalls(label) {
  const made = new UnderItsOwnName;
  const other = new UnderAnotherName;
  say(label, [made.add(1), made.add.name, made.add.length, other.bound(1), other.bound.name, other.bound.length].join(" "));
}
for (let i = 0;i < 3000; i++)
  new UnderItsOwnName().add(i);
constructsAndCalls("as written");
const written = UnderItsOwnName.prototype.add;
UnderItsOwnName.prototype.add = function(n) {
  return this.base - n;
};
constructsAndCalls("another method");
UnderItsOwnName.prototype.add = written;
constructsAndCalls("the first again");
Object.defineProperty(written, "name", { value: "renamed" });
Object.defineProperty(written, "length", { value: 4 });
Object.defineProperty(UnderAnotherName.prototype.add, "name", { value: "renamedToo" });
constructsAndCalls("renamed");
UnderItsOwnName.prototype.add = 5;
say("a number on the prototype", attempt(() => new UnderItsOwnName().add(1)));
UnderItsOwnName.prototype.add = { bind: (receiver) => (n) => receiver.base * 100 + n };
say("an object with a bind of its own", attempt(() => new UnderItsOwnName().add(1)));
UnderItsOwnName.prototype.add = written;
written.bind = function() {
  return () => "its own bind";
};
say("the method has a bind of its own", attempt(() => new UnderItsOwnName().add(1)));
delete written.bind;
constructsAndCalls("all as it was, but for the names");
console.log(lines.join(`
`));
