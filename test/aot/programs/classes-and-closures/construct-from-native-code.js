function NT() {}
NT.prototype = { marker: "NT.prototype" };

function targetName(target) {
  if (target === undefined) return "undefined";
  return target === NT ? "NT" : target.name;
}

function prototypeName(object) {
  const prototype = Object.getPrototypeOf(object);
  if (prototype === NT.prototype) return "NT.prototype";
  return prototype.constructor.name + ".prototype";
}

function show(label, object) {
  console.log(label, typeof object, prototypeName(object), JSON.stringify(object));
}

class Base {
  field = "base field";
  constructor(...args) {
    this.args = args;
    this.target = targetName(new.target);
  }
}

class Derived extends Base {
  derivedField = "derived field";
  constructor(...a) {
    super(...a);
  }
}

class NoParameters {
  field = 0;
  constructor() {
    this.count = arguments.length;
    this.target = targetName(new.target);
  }
}

class ThreeParameters {
  constructor(a, b, c) {
    this.values = [a, b, c];
    this.target = targetName(new.target);
  }
}

class TwelveParameters {
  constructor(a, b, c, d, e, f, g, h, i, j, k, l) {
    this.values = [a, b, c, d, e, f, g, h, i, j, k, l];
    this.target = targetName(new.target);
  }
}

function PlainFunction(a, b) {
  console.log("plain function", new.target === NT, targetName(new.target));
  this.values = [a, b];
}

function ReturnsObject(a) {
  this.ignored = true;
  return { returned: a };
}

function ReturnsNumber(a) {
  this.kept = a;
  return 1;
}

const constructors = [Base, Derived, NoParameters, ThreeParameters, TwelveParameters, PlainFunction, ReturnsObject, ReturnsNumber];
const argumentLists = [[], [1, 2], [1, 2, 3, 4], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]];

for (const F of constructors) {
  for (const list of argumentLists) {
    show(F.name + " with NT, " + list.length + ":", Reflect.construct(F, list, NT));
    show(F.name + " with itself, " + list.length + ":", Reflect.construct(F, list));
  }
  show(F.name + " bound:", new (F.bind(null, 1))(2));
}

Reflect.apply(PlainFunction, {}, [1, 2]);

function throwsTypeError(label, action) {
  try {
    action();
    console.log(label, "did not throw");
  } catch (error) {
    console.log(label, error instanceof TypeError);
  }
}

const object = {
  method() {
    console.log("method body ran");
  },
};
const arrow = () => console.log("arrow body ran");

throwsTypeError("arrow function:", () => Reflect.construct(arrow, []));
throwsTypeError("method:", () => Reflect.construct(object.method, []));

let prototypeReads = 0;
const throwingTarget = function () {}.bind();
Object.defineProperty(throwingTarget, "prototype", {
  get() {
    prototypeReads++;
    throw new RangeError("prototype getter");
  },
});

class RecordsBody {
  constructor() {
    console.log("class body ran");
  }
}

function RecordsPlainBody() {
  console.log("function body ran");
}

for (const F of [RecordsBody, RecordsPlainBody]) {
  prototypeReads = 0;
  try {
    Reflect.construct(F, [], throwingTarget);
    console.log(F.name, "did not throw");
  } catch (error) {
    console.log(F.name, error.name, error.message, prototypeReads);
  }
}
