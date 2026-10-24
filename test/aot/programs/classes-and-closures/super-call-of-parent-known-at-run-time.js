// `super(..)` in a class whose parent is known only at run time: classes and functions of the program, built-in classes, proxies, bound functions and values that are no constructors, with few and with many arguments.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
function outcome(run) {
  try {
    return run();
  } catch (error) {
    return error instanceof RangeError ? "RangeError: " + error.message : error.constructor.name;
  }
}

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.target = new.target.name;
    this.count = arguments.length;
  }
}
class Labeled extends Point {
  constructor(x, y, label) {
    super(x, y);
    this.label = label;
  }
}
function Legacy(x, y) {
  this.x = x;
  this.y = y;
  this.target = new.target && new.target.name;
  this.count = arguments.length;
}
Legacy.prototype.kind = "legacy";
function WithoutTarget(x, y) {
  this.x = x;
  this.y = y;
  this.count = arguments.length;
}
class Replaces {
  constructor(x) {
    return { replaced: x, target: new.target.name };
  }
}
class Throws {
  constructor(x) {
    throw new RangeError("parent refuses " + x);
  }
}
function ReturnsPrimitive(x) {
  this.x = x;
  return 5;
}
class Sums {
  constructor(a, b, c, d, e, f, g, h, i, j) {
    this.sum = [a, b, c, d, e, f, g, h, i, j].join("");
    this.count = arguments.length;
  }
}

const withTwo = Base => class WithTwo extends Base {
  constructor(x, y) {
    super(x, y);
    this.own = "two";
  }
};
const withNone = Base => class WithNone extends Base {
  constructor() {
    super();
    this.own = "none";
  }
};
const withTen = Base => class WithTen extends Base {
  constructor() {
    super(0, 1, 2, 3, 4, 5, 6, 7, 8, 9);
    this.own = "ten";
  }
};
const withImplicit = Base => class WithImplicit extends Base {
  get marker() {
    return "all";
  }
};
const withRest = Base => class WithRest extends Base {
  constructor(...rest) {
    super(...rest);
    this.own = "rest";
  }
};

const parents = [Point, Labeled, Legacy, WithoutTarget, Replaces, Throws, ReturnsPrimitive, Sums, withTwo(Point), withTwo(Legacy), Object, Array, Map, Error, TypeError, Promise, Legacy.bind(null, "bound"), new Proxy(Point, {}), new Proxy(Legacy, { construct(target, list, newTarget) { return Reflect.construct(target, ["trap", ...list], newTarget); } })];
for (const parent of parents) {
  for (const derive of [withTwo, withNone, withTen, withImplicit, withRest]) {
    console.log(parent.name || "proxy", derive.name, outcome(() => {
      const Derived = derive(parent);
      const made = new Derived(1, 2);
      return JSON.stringify(made) + " " + Object.keys(made).join() + " " + (made instanceof Derived) + " " + (made instanceof parent) + " " + (made.length ?? made.size ?? made.message ?? made.kind);
    }));
  }
}

function reparent(to) {
  const Derived = withTwo(Point);
  Object.setPrototypeOf(Derived, to);
  return new Derived(3, 4);
}
for (const parent of [null, () => {}, { method() {} }.method, async function () {}, function* () {}, Math.max, Symbol.iterator, 5, "text", {}, Function.prototype])
  console.log(typeof parent, outcome(() => (typeof parent === "object" && parent !== null) || typeof parent === "function" || parent === null ? JSON.stringify(reparent(parent)) : "no prototype"));

class Twice extends Point {
  constructor() {
    super(1, 2);
    super(3, 4);
  }
}
console.log(outcome(() => JSON.stringify(new Twice())));
console.log(JSON.stringify(Reflect.construct(withTwo(Point), [5, 6], Labeled)), Reflect.construct(withTwo(Point), [5, 6], Labeled) instanceof Labeled);

const digits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
for (const derive of [withImplicit, withRest]) {
  const Forwarding = derive(derive(Sums)), ForwardingToFunction = derive(derive(WithoutTarget));
  for (let length = 0; length <= digits.length; length++)
    console.log(derive.name, length, JSON.stringify(new Forwarding(...digits.slice(0, length))), new ForwardingToFunction(...digits.slice(0, length)).count);
}

const derived = [withTwo(Point), withTwo(WithoutTarget), withTwo(withTwo(Point)), withTen(Sums)];
const before = count("operationAOTSuperConstruct");
let total = 0;
for (let turn = 0; turn < 4000; turn++) {
  const made = new derived[turn & 3](turn, 1);
  total += made.count + made.own.length;
}
console.log(total, count("operationAOTSuperConstruct") - before < 100 ? "few entries" : "MANY ENTRIES");

const forwarding = [withImplicit(withImplicit(Point)), withImplicit(withImplicit(WithoutTarget)), withImplicit(withTwo(Point)), withImplicit(withImplicit(withImplicit(Sums)))];
const beforeForwarding = count("operationAOTSuperConstruct");
total = 0;
for (let turn = 0; turn < 4000; turn++) {
  const made = new forwarding[turn & 3](turn, 1);
  total += made.count + made.marker.length;
}
console.log(total, count("operationAOTSuperConstruct") - beforeForwarding < 100 ? "few entries" : "MANY ENTRIES");
