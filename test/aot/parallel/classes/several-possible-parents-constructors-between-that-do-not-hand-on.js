class Root {
  #secret = "root secret";
  shown = "root shown";
  get secret() {
    return this.#secret;
  }
  static stamp(object) {
    return new (class extends Returns(object) {})();
  }
}
function Returns(object) {
  return function () {
    return object;
  };
}
function ReturnsAnother(Base) {
  return class extends Base {
    constructor(another) {
      super();
      if (another) return another;
    }
  };
}
function SometimesNoSuper(Base) {
  return class extends Base {
    constructor(skips) {
      if (!skips) super();
    }
  };
}
function attempt(run) {
  try {
    return run();
  } catch (error) {
    return error.constructor.name;
  }
}
function show(label, made) {
  console.log(label, typeof made === "object" ? [attempt(() => made.secret), made.shown, made instanceof Root, Object.keys(made).join(",")].join(" | ") : made);
}
const classes = [];
for (let i = 0; i < 4; i++) {
  let base = Root;
  if (i & 1) base = ReturnsAnother(base);
  if (i & 2) base = SometimesNoSuper(base);
  classes.push(class extends base {
    late = "late " + i;
  });
}
for (let round = 0; round < 2; round++) {
  classes.forEach((each, i) => {
    show(i + " plain", attempt(() => new each()));
    show(i + " with an argument", attempt(() => new each({ given: true })));
    show(i + " new.target is Object", attempt(() => Reflect.construct(each, [], Object)));
    show(i + " the root for this class", attempt(() => Reflect.construct(Root, [], each)));
    show(i + " new.target is the root", attempt(() => Reflect.construct(each, [], Root)));
  });
}
